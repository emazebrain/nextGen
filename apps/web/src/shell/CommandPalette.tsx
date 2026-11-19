/**
 * Command palette / search overlay (design doc §4.3).
 *
 * Ctrl/Cmd+K opens on desktop; a search icon opens on mobile.
 * Searches patients, protocols, staff and shows quick actions.
 * Results grouped by category with keyboard navigation.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  MessageSquare,
  Route as RouteIcon,
  Search,
  Settings as SettingsIcon,
  UserPlus,
  Users,
  User,
  X,
} from "lucide-react";
import { useT, type MessageId } from "../i18n/index.tsx";
import { useClinic } from "../lib/clinic.tsx";
import { useSearch, type SearchResult } from "../api/search.ts";

const ICON_MAP: Record<string, typeof Search> = {
  user: User,
  "user-plus": UserPlus,
  users: Users,
  route: RouteIcon,
  calendar: CalendarDays,
  "message-square": MessageSquare,
  "bar-chart": BarChart3,
  settings: SettingsIcon,
  "book-open": BookOpen,
};

const KIND_LABELS: Record<SearchResult["kind"], MessageId> = {
  patient: "search.group.patients",
  protocol: "search.group.protocols",
  staff: "search.group.staff",
  action: "search.group.actions",
  page: "search.group.pages",
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { clinicId } = useClinic();
  const inputRef = useRef<HTMLInputElement | undefined>(undefined);
  const listRef = useRef<HTMLDivElement | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const { data: results = [], isFetching } = useSearch(clinicId ?? "", query);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      // Focus input after render
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Clamp active index when results change
  useEffect(() => {
    setActiveIdx((i) => Math.min(i, Math.max(0, results.length - 1)));
  }, [results.length]);

  const go = useCallback(
    (result: SearchResult) => {
      onClose();
      navigate(result.url);
    },
    [onClose, navigate],
  );

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
      scrollActiveIntoView(activeIdx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      scrollActiveIntoView(activeIdx - 1);
    } else if (e.key === "Enter" && results[activeIdx]) {
      e.preventDefault();
      go(results[activeIdx]);
    }
  };

  const scrollActiveIntoView = (idx: number) => {
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-idx="${idx}"]`);
      el?.scrollIntoView({ block: "nearest" });
    });
  };

  if (!open) return null;

  // Group results by kind, preserving order
  const groups: Array<{ kind: SearchResult["kind"]; items: Array<{ result: SearchResult; globalIdx: number }> }> = [];
  let globalIdx = 0;
  const kindOrder: SearchResult["kind"][] = ["patient", "protocol", "staff", "action", "page"];
  for (const kind of kindOrder) {
    const items = results
      .map((r, i) => ({ result: r, originalIdx: i }))
      .filter(({ result }) => result.kind === kind);
    if (items.length) {
      groups.push({
        kind,
        items: items.map(({ result }) => {
          const entry = { result, globalIdx };
          globalIdx++;
          return entry;
        }),
      });
    }
  }

  return (
    <div className="cmdpal-overlay" onClick={onClose} role="presentation">
      <div
        className="cmdpal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("search.title")}
      >
        <div className="cmdpal-header">
          <Search size={20} className="cmdpal-header__icon" aria-hidden="true" />
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            className="cmdpal-input"
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              className="cmdpal-clear"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label={t("common.clear")}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="cmdpal-close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <kbd className="cmdpal-kbd">Esc</kbd>
          </button>
        </div>

        <div className="cmdpal-results" ref={listRef as React.RefObject<HTMLDivElement>}>
          {isFetching && !results.length && (
            <div className="cmdpal-empty">{t("common.loading")}</div>
          )}
          {!isFetching && query && !results.length && (
            <div className="cmdpal-empty">{t("search.noResults")}</div>
          )}
          {!query && !results.length && (
            <div className="cmdpal-hint">{t("search.hint")}</div>
          )}
          {groups.map((group) => (
            <div key={group.kind} className="cmdpal-group">
              <div className="cmdpal-group__label">{t(KIND_LABELS[group.kind])}</div>
              {group.items.map(({ result, globalIdx: gIdx }) => {
                const Icon = ICON_MAP[result.icon ?? ""] ?? Search;
                return (
                  <button
                    key={result.id}
                    type="button"
                    className={`cmdpal-item${gIdx === activeIdx ? " cmdpal-item--active" : ""}`}
                    data-idx={gIdx}
                    onClick={() => go(result)}
                    onMouseEnter={() => setActiveIdx(gIdx)}
                    role="option"
                    aria-selected={gIdx === activeIdx}
                  >
                    <Icon size={18} className="cmdpal-item__icon" aria-hidden="true" />
                    <div className="cmdpal-item__text">
                      <span className="cmdpal-item__title">{result.title}</span>
                      {result.subtitle && (
                        <span className="cmdpal-item__sub">{result.subtitle}</span>
                      )}
                    </div>
                    <span className="cmdpal-item__kind">{t(KIND_LABELS[result.kind])}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="cmdpal-footer">
          <span className="cmdpal-footer__hint">
            <kbd className="cmdpal-kbd">↑↓</kbd> {t("search.navigate")}
          </span>
          <span className="cmdpal-footer__hint">
            <kbd className="cmdpal-kbd">↵</kbd> {t("search.select")}
          </span>
          <span className="cmdpal-footer__hint">
            <kbd className="cmdpal-kbd">Esc</kbd> {t("search.close")}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook: global Ctrl/Cmd+K listener to open the palette.
 */
export function useCommandPaletteShortcut(onOpen: () => void) {
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpen();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onOpen]);
}
