/**
 * A video between games (ADR 0018). Uploaded videos play from the clinic's own server (and, with project 2, from
 * the device); YouTube videos play in a sandboxed, cookie-free embed and need the Internet. Continue appears when
 * the video ends (or after a few seconds for YouTube, which gives no end signal without its script API). The view
 * is reported once, with how long it was watched.
 */
import { useEffect, useRef, useState } from "react";
import { CloudOff, Play } from "lucide-react";
import type { LaunchVideoStep, VideoViewInput } from "@emb/contracts";
import { Alert, Button } from "@emb/ui";
import { useT } from "../i18n/index.tsx";
import { uuidv7 } from "../lib/ids.ts";
import { noteActivity } from "../lib/idle.ts";

const YOUTUBE_CONTINUE_AFTER_S = 3;

/**
 * What a view says: seconds watched, and whether it was watched to the end. An upload is complete when it played
 * to its end; a YouTube video after 80% of its length on the clock; unknown (null) when nobody entered a length.
 */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

/** The summary line for a view: watched to the end, watched for a time (completion unknown), part of it, or not at all. */
export function viewSummary(v: { completed: boolean | null; watched_s: number }): { id: "run.video.watched" | "run.video.watchedFor" | "run.video.partly" | "run.video.notPlayed"; time: string } {
  const time = clock(v.watched_s);
  if (v.completed === true) return { id: "run.video.watched", time };
  if (v.completed === null && v.watched_s > 0) return { id: "run.video.watchedFor", time };
  return { id: v.watched_s > 0 ? "run.video.partly" : "run.video.notPlayed", time };
}

export function viewOutcome(o: { source: "upload" | "youtube"; ended: boolean; watchedS: number; durationS: number | null }): { watched_s: number; completed: boolean | null } {
  const watched_s = Math.min(7200, Math.max(0, Math.round(o.watchedS)));
  if (o.source === "upload") return { watched_s, completed: o.ended };
  if (!o.durationS) return { watched_s, completed: null };
  return { watched_s, completed: o.watchedS >= o.durationS * 0.8 };
}

export function VideoStep({
  step,
  plannedSessionId,
  onDone,
  finishRef,
}: {
  step: LaunchVideoStep;
  plannedSessionId: string;
  onDone: (view: VideoViewInput) => void;
  /** Lets the therapist controls end the video early (recorded as not completed). */
  finishRef?: { current: (() => void) | null };
}) {
  const t = useT();
  const v = step.video;
  const [startedAt] = useState(() => new Date());
  const [ended, setEnded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [canContinue, setCanContinue] = useState(false);
  const watched = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const offline = v.source === "youtube" && typeof navigator !== "undefined" && navigator.onLine === false;
  // Nothing to play (an upload without a file): the child must still be able to go on.
  const playable = (v.source === "upload" && !!v.file_url) || (v.source === "youtube" && !!v.youtube_id);
  if (!playable && !canContinue) setCanContinue(true);

  // YouTube: count wall-clock seconds while the page is visible; offer Continue after a moment.
  useEffect(() => {
    if (v.source !== "youtube") return;
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible" && !offline) watched.current += 1;
      noteActivity();
      if (watched.current >= YOUTUBE_CONTINUE_AFTER_S || offline) setCanContinue(true);
    }, 1000);
    return () => window.clearInterval(tick);
  }, [v.source, offline]);

  const finish = () => {
    const outcome = viewOutcome({ source: v.source, ended, watchedS: watched.current, durationS: v.duration_s });
    onDone({
      client_view_id: uuidv7(),
      planned_session_id: plannedSessionId,
      assignment_step_id: step.assignment_step_id,
      video_id: v.id,
      video_version: v.version,
      started_at: startedAt.toISOString(),
      ended_at: new Date().toISOString(),
      ...outcome,
    });
  };

  if (finishRef) finishRef.current = finish;

  return (
    <div className="videostep">
      <h1 className="videostep__title">{v.title}</h1>
      <div className="videostep__stage">
        {v.source === "upload" && v.file_url ? (
          failed ? (
            <Alert tone="warning">{t("run.video.failed")}</Alert>
          ) : (
            <video
              ref={videoRef}
              className="videostep__video"
              src={v.file_url}
              controls
              autoPlay
              muted
              playsInline
              preload="auto"
              aria-label={v.title}
              onTimeUpdate={(e) => {
                watched.current = Math.max(watched.current, e.currentTarget.currentTime);
                noteActivity();
              }}
              onEnded={() => {
                setEnded(true);
                setCanContinue(true);
              }}
              onError={() => {
                setFailed(true);
                setCanContinue(true);
              }}
            />
          )
        ) : offline ? (
          <Alert tone="warning">
            <CloudOff size={18} aria-hidden="true" /> {t("run.video.offline")}
          </Alert>
        ) : v.youtube_id ? (
          <iframe
            className="videostep__frame"
            title={v.title}
            src={`https://www.youtube-nocookie.com/embed/${v.youtube_id}?rel=0&modestbranding=1&playsinline=1`}
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin"
            // No popups or top navigation: the child can't leave the session through the player.
            sandbox="allow-scripts allow-same-origin allow-presentation"
          />
        ) : (
          <Alert tone="warning">{t("run.video.failed")}</Alert>
        )}
      </div>
      <div className="videostep__actions">
        {canContinue ? (
          <Button size="lg" icon={<Play size={20} aria-hidden="true" className="emb-flip-rtl" />} onClick={finish}>
            {t("common.continue")}
          </Button>
        ) : (
          <p className="app-muted" aria-live="polite">
            {t("run.video.watch")}
          </p>
        )}
      </div>
    </div>
  );
}
