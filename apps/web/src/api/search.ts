/** Client for /v1/search (command palette, design doc §4.3). */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./http.ts";

export interface SearchResult {
  id: string;
  kind: "patient" | "protocol" | "staff" | "action" | "page";
  title: string;
  subtitle?: string | undefined;
  url: string;
  icon?: string | undefined;
}

const enc = encodeURIComponent;

export const searchAll = (clinicId: string, q: string, signal?: AbortSignal) =>
  apiGet<{ results: SearchResult[] }>(
    `/v1/search?clinic=${enc(clinicId)}&q=${enc(q)}`,
    signal ? { signal } : {},
  ).then((r) => r.results);

export function useSearch(clinicId: string, q: string) {
  return useQuery({
    queryKey: ["search", clinicId, q],
    queryFn: ({ signal }) => searchAll(clinicId, q, signal),
    enabled: !!clinicId && q.length >= 1,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
