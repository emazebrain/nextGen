/** Parent messages — thread list and conversation (§5.11). */
import { useState, useRef, useEffect, type FormEvent } from "react";
import { ArrowLeft, MessageSquare, Send } from "lucide-react";
import { Alert, Button, Card, EmptyState, MazeLoader, PageHeader } from "@emb/ui";
import {
  useParentThreads,
  useParentMessages,
  useSendParentMessage,
  markParentRead,
  type MessageThread,
  type Message,
} from "../../api/messaging.ts";
import { useT } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";

export function ParentMessagesPage() {
  const t = useT();
  const threads = useParentThreads();
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  useTitle(t("parent.messages"));

  if (threads.isPending) return <MazeLoader label={t("common.loading")} />;
  if (threads.isError) {
    return (
      <div className="app-page">
        <PageHeader title={t("parent.messages")} />
        <Alert tone="danger">
          <p>{t("errors.generic")}</p>
          <Button variant="secondary" onClick={() => void threads.refetch()}>
            {t("common.retry")}
          </Button>
        </Alert>
      </div>
    );
  }

  const threadList = threads.data ?? [];
  const activeThread = threadList.find((th) => th.id === activeThreadId) ?? null;

  if (threadList.length === 0) {
    return (
      <div className="app-page">
        <PageHeader title={t("parent.messages")} />
        <Card>
          <EmptyState icon={<MessageSquare size={32} aria-hidden="true" />} title={t("parent.noMessages")}>
            {t("parent.noMessagesHint")}
          </EmptyState>
        </Card>
      </div>
    );
  }

  return (
    <div className={`messages-layout messages-layout--parent${activeThread ? " messages-layout--open" : ""}`}>
      <aside className="messages-sidebar">
        <PageHeader title={t("parent.messages")} />
        <ul className="messages-list">
          {threadList.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                className={`messages-item ${thread.id === activeThreadId ? "messages-item--active" : ""}`}
                onClick={() => {
                  setActiveThreadId(thread.id);
                  void markParentRead(thread.id);
                }}
              >
                <span className="messages-item__name">
                  <bdi>{thread.therapist_name}</bdi>
                  {thread.unread_count > 0 && (
                    <span className="messages-item__badge emb-tnum" aria-label={t("messages.unread", { count: thread.unread_count })}>{thread.unread_count}</span>
                  )}
                </span>
                <span className="messages-item__patient">
                  <bdi>{thread.patient_given_name}</bdi>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="messages-conversation" aria-label={t("messages.conversation")}>
        {activeThread ? (
          <ParentConversationView thread={activeThread} onBack={() => setActiveThreadId("")} />
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

function ParentConversationView({ thread, onBack }: { thread: MessageThread; onBack: () => void }) {
  const t = useT();
  const messages = useParentMessages(thread.id);
  const send = useSendParentMessage(thread.id);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

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
          <bdi>{thread.therapist_name}</bdi>
        </h2>
        <span className="conversation__patient">
          {t("messages.about", { name: thread.patient_given_name })}
        </span>
      </header>

      <div className="conversation__messages">
        {messages.isPending ? (
          <MazeLoader label={t("common.loading")} />
        ) : (
          <>
            {(messages.data ?? []).map((msg) => (
              <div
                key={msg.id}
                className={`msg-bubble ${msg.sender_role === "guardian" ? "msg-bubble--mine" : "msg-bubble--theirs"}`}
              >
                {msg.sender_role !== "guardian" && (
                  <span className="msg-bubble__sender">{msg.sender_name}</span>
                )}
                <p className="msg-bubble__body">{msg.body}</p>
                {msg.attachment_url && (
                  <a href={msg.attachment_url} target="_blank" rel="noopener noreferrer" className="msg-bubble__attachment">
                    {msg.attachment_name ?? "Attachment"}
                  </a>
                )}
                <time className="msg-bubble__time">
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </time>
              </div>
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
