/** Messaging — therapist-side thread list and conversation (§5.11). */
import { useState, useRef, useEffect, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { ArrowLeft, MessageSquare, Send } from "lucide-react";
import { Button, Card, EmptyState, MazeLoader, PageHeader } from "@emb/ui";
import {
  useThreads,
  useMessages,
  useSendMessage,
  markRead,
  type MessageThread,
  type Message,
} from "../api/messaging.ts";
import { useT } from "../i18n/index.tsx";
import { useTitle } from "../lib/title.ts";
import { useMe } from "../api/queries.ts";
import { useIntl } from "react-intl";
import { LoadError } from "./shared.tsx";

export function MessagesPage() {
  const t = useT();
  const intl = useIntl();
  const [params] = useSearchParams();
  const patientFilter = params.get("patient") ?? undefined;
  const threads = useThreads(patientFilter ? { patient_id: patientFilter } : undefined);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const me = useMe();
  useTitle(t("messages.title"));

  if (threads.isPending) return <MazeLoader label={t("common.loading")} />;
  // A failed load must not look like an empty inbox.
  if (threads.isError) {
    return (
      <div className="app-page">
        <PageHeader title={t("messages.title")} />
        <LoadError error={threads.error} retry={() => void threads.refetch()} />
      </div>
    );
  }

  const threadList = threads.data ?? [];
  const activeThread = threadList.find((t) => t.id === activeThreadId) ?? null;

  return (
    <div className={`messages-layout${activeThread ? " messages-layout--open" : ""}`}>
      {/* Thread list */}
      <aside className="messages-sidebar">
        <PageHeader title={t("messages.title")} />
        {threadList.length === 0 ? (
          <EmptyState icon={<MessageSquare size={32} aria-hidden="true" />} title={t("messages.empty")}>
            {t("messages.emptyHint")}
          </EmptyState>
        ) : (
          <ul className="messages-list">
            {threadList.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  className={`messages-item ${thread.id === activeThreadId ? "messages-item--active" : ""}`}
                  onClick={() => {
                    setActiveThreadId(thread.id);
                    void markRead(thread.id);
                  }}
                >
                  <span className="messages-item__name">
                    <bdi>{thread.guardian_name}</bdi>
                    {thread.unread_count > 0 && (
                      <span className="messages-item__badge emb-tnum" aria-label={t("messages.unread", { count: thread.unread_count })}>{thread.unread_count}</span>
                    )}
                  </span>
                  <span className="messages-item__patient">
                    <bdi>{thread.patient_given_name} {thread.patient_family_name}</bdi>
                  </span>
                  {thread.last_message_at && (
                    <time className="messages-item__time">
                      {intl.formatDate(new Date(thread.last_message_at), { day: "numeric", month: "short" })}
                    </time>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Conversation */}
      <section className="messages-conversation" aria-label={t("messages.conversation")}>
        {activeThread ? (
          <ConversationView thread={activeThread} myUserId={me.data?.user.id ?? ""} onBack={() => setActiveThreadId("")} />
        ) : (
          <div className="messages-empty-state">
            <MessageSquare size={48} aria-hidden="true" />
            <p>{t("messages.selectThread")}</p>
          </div>
        )}
      </section>
    </div>
  );
}

function ConversationView({ thread, myUserId, onBack }: { thread: MessageThread; myUserId: string; onBack: () => void }) {
  const t = useT();
  const messages = useMessages(thread.id);
  const send = useSendMessage(thread.id);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.data?.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    send.mutate({ body: draft.trim() });
    setDraft("");
  };

  return (
    <div className="conversation">
      <header className="conversation__header">
        <button type="button" className="conversation__back" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" className="emb-flip-rtl" />
          {t("messages.all")}
        </button>
        <h2 className="conversation__name">
          <bdi>{thread.guardian_name}</bdi>
        </h2>
        <span className="conversation__patient">
          {t("messages.about", { name: `${thread.patient_given_name} ${thread.patient_family_name}` })}
        </span>
      </header>

      <div className="conversation__messages">
        {messages.isPending ? (
          <MazeLoader label={t("common.loading")} />
        ) : (
          <>
            {(messages.data ?? []).map((msg) => (
              <MessageBubble key={msg.id} msg={msg} isMine={msg.sender_id === myUserId} />
            ))}
            <div ref={endRef} />
          </>
        )}
      </div>

      <form className="conversation__compose" onSubmit={submit}>
        <input
          className="emb-input"
          name="message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoComplete="off"
          placeholder={t("messages.compose")}
          aria-label={t("messages.compose")}
        />
        <Button type="submit" icon={<Send size={18} aria-hidden="true" />} loading={send.isPending} disabled={!draft.trim()}>
          {t("messages.send")}
        </Button>
      </form>
    </div>
  );
}

function MessageBubble({ msg, isMine }: { msg: Message; isMine: boolean }) {
  const intl = useIntl();
  return (
    <div className={`msg-bubble ${isMine ? "msg-bubble--mine" : "msg-bubble--theirs"}`}>
      {!isMine && <span className="msg-bubble__sender">{msg.sender_name}</span>}
      <p className="msg-bubble__body">{msg.body}</p>
      {msg.attachment_url && (
        <a href={msg.attachment_url} target="_blank" rel="noopener noreferrer" className="msg-bubble__attachment">
          {msg.attachment_name ?? "Attachment"}
        </a>
      )}
      <time className="msg-bubble__time">
        {intl.formatTime(new Date(msg.created_at), { hour: "2-digit", minute: "2-digit" })}
      </time>
    </div>
  );
}
