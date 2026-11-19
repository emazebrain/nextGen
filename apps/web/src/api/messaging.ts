/** Client for /v1/messages (staff messaging routes). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "./http.ts";

export interface MessageThread {
  id: string;
  patient_id: string;
  therapist_id: string;
  guardian_id: string;
  status: string;
  last_message_at: string | null;
  created_at: string;
  patient_given_name: string;
  patient_family_name: string;
  guardian_name: string;
  therapist_name: string;
  unread_count: number;
}

export interface Message {
  id: string;
  sender_id: string;
  sender_role: string;
  body: string;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
  read_at: string | null;
  created_at: string;
  sender_name: string;
}

const enc = encodeURIComponent;

export const listThreads = (params?: { patient_id?: string }, signal?: AbortSignal) => {
  const q = params?.patient_id ? `?patient_id=${enc(params.patient_id)}` : "";
  return apiGet<{ threads: MessageThread[] }>(`/v1/messages/threads${q}`, signal ? { signal } : {}).then((r) => r.threads);
};

export const createThread = (data: { patient_id: string; guardian_id: string }) =>
  apiSend<{ thread_id: string; created: boolean }>("POST", "/v1/messages/threads", data);

export const listMessages = (threadId: string, signal?: AbortSignal) =>
  apiGet<{ messages: Message[] }>(`/v1/messages/threads/${enc(threadId)}/messages`, signal ? { signal } : {}).then((r) => r.messages);

export const sendMessage = (threadId: string, data: { body: string }) =>
  apiSend<{ id: string }>("POST", `/v1/messages/threads/${enc(threadId)}/messages`, data);

export const markRead = (threadId: string) =>
  apiSend<{ ok: boolean }>("POST", `/v1/messages/threads/${enc(threadId)}/read`);

// Parent-side API
export const listParentThreads = (signal?: AbortSignal) =>
  apiGet<{ threads: MessageThread[] }>("/v1/parent/messages/threads", signal ? { signal } : {}).then((r) => r.threads);

export const listParentMessages = (threadId: string, signal?: AbortSignal) =>
  apiGet<{ messages: Message[] }>(`/v1/parent/messages/threads/${enc(threadId)}/messages`, signal ? { signal } : {}).then((r) => r.messages);

export const sendParentMessage = (threadId: string, data: { body: string }) =>
  apiSend<{ id: string }>("POST", `/v1/parent/messages/threads/${enc(threadId)}/messages`, data);

export const markParentRead = (threadId: string) =>
  apiSend<{ ok: boolean }>("POST", `/v1/parent/messages/threads/${enc(threadId)}/read`);

// ---- Hooks

const msgKey = ["messages"] as const;

export const useThreads = (params?: { patient_id?: string }) =>
  useQuery({ queryKey: [...msgKey, "threads", params], queryFn: ({ signal }) => listThreads(params, signal) });

export const useMessages = (threadId: string) =>
  useQuery({
    queryKey: [...msgKey, "thread", threadId],
    queryFn: ({ signal }) => listMessages(threadId, signal),
    enabled: !!threadId,
    refetchInterval: 15_000, // poll every 15s for new messages
  });

export function useSendMessage(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { body: string }) => sendMessage(threadId, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...msgKey, "thread", threadId] });
      void qc.invalidateQueries({ queryKey: [...msgKey, "threads"] });
    },
  });
}

export const useParentThreads = () =>
  useQuery({ queryKey: ["parent", "messages", "threads"], queryFn: ({ signal }) => listParentThreads(signal) });

export const useParentMessages = (threadId: string) =>
  useQuery({
    queryKey: ["parent", "messages", "thread", threadId],
    queryFn: ({ signal }) => listParentMessages(threadId, signal),
    enabled: !!threadId,
    refetchInterval: 15_000,
  });

export function useSendParentMessage(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { body: string }) => sendParentMessage(threadId, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["parent", "messages", "thread", threadId] });
      void qc.invalidateQueries({ queryKey: ["parent", "messages", "threads"] });
    },
  });
}
