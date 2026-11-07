/** The patient's running protocol (design doc §5.5): progress, next session, steps, pause/stop. */
import { useState } from "react";
import { Link } from "react-router";
import { useIntl } from "react-intl";
import { Pause, Play, Square } from "lucide-react";
import { Button, Card, Chip, ConfirmDialog, MazeLoader } from "@emb/ui";
import { useAssignment, useUpdateAssignment, useVideo } from "../../api/queries.ts";
import { isVideoStep } from "@emb/contracts";
import { formatDuration } from "../admin/videos.tsx";
import { findGame, localText } from "../../games/registry.ts";
import { useT, usePrefs } from "../../i18n/index.tsx";
import { calendarDate } from "../../lib/format.ts";
import { LoadError } from "../shared.tsx";
import { NoProtocolCard } from "../protocols/pages.tsx";
import { useStepSummary } from "../protocols/steps.tsx";

export function ProtocolCard({ patientId, archived, canPlay }: { patientId: string; archived: boolean; canPlay: boolean }) {
  const t = useT();
  const intl = useIntl();
  const { locale } = usePrefs();
  const summary = useStepSummary();
  const assignment = useAssignment(patientId);
  const update = useUpdateAssignment(patientId);
  const [stopping, setStopping] = useState(false);

  if (assignment.isPending) return <MazeLoader label={t("common.loading")} />;
  if (assignment.isError) return <LoadError error={assignment.error} retry={() => void assignment.refetch()} />;
  const a = assignment.data;
  if (!a) return archived ? null : <NoProtocolCard patientId={patientId} />;

  const live = a.sessions.filter((s) => s.status !== "cancelled");
  const done = live.filter((s) => s.status === "done").length;
  const next = live.find((s) => s.status === "planned" || s.status === "in_progress");
  const week = next?.week ?? a.weeks;

  return (
    <Card as="section" labelledBy="p-protocol">
      <div className="app-cardrow">
        <div>
          <p className="app-muted">{t("protocol.title")}</p>
          <h2 id="p-protocol" className="app-cardtitle">
            {a.name}
          </h2>
        </div>
        {a.status === "paused" && <Chip tone="warning">{t("protocol.paused")}</Chip>}
      </div>
      <p>{t("protocol.progress", { week, weeks: a.weeks, done, total: live.length })}</p>
      <div className="meter" aria-hidden="true">
        <span style={{ inlineSize: `${live.length ? (done / live.length) * 100 : 0}%` }} />
      </div>
      <p className="app-muted">
        {next ? t("protocol.next", { date: intl.formatDate(calendarDate(next.planned_date), { weekday: "long", day: "numeric", month: "long" }) }) : t("protocol.noneLeft")}
      </p>
      <ol className="psteps">
        {a.steps.map((s) => (
          <li key={s.id}>
            {isVideoStep(s) ? (
              <VideoStepName videoId={s.video_id} />
            ) : (
              <>
                <span className="step__name">{findGame(s.game_id) ? localText(findGame(s.game_id)!.manifest.name, locale) : s.game_id}</span>
                <span className="app-muted">{summary({ ...s, difficulty_start: s.current_difficulty })}</span>
              </>
            )}
          </li>
        ))}
      </ol>
      {!archived && (
        <div className="pform__actions">
          {a.status === "active" && next && canPlay && (
            <Link to={`/session/${next.id}`} className="emb-btn emb-btn--primary">
              <Play size={18} aria-hidden="true" />
              <span>{t("run.startSession", { seq: next.seq })}</span>
            </Link>
          )}
          {a.status === "active" ? (
            <Button variant="secondary" icon={<Pause size={18} aria-hidden="true" />} loading={update.isPending} onClick={() => update.mutate({ id: a.id, status: "paused" })}>
              {t("protocol.pause")}
            </Button>
          ) : (
            <Button variant="secondary" icon={<Play size={18} aria-hidden="true" />} loading={update.isPending} onClick={() => update.mutate({ id: a.id, status: "active" })}>
              {t("protocol.resume")}
            </Button>
          )}
          <Button variant="ghost" icon={<Square size={18} aria-hidden="true" />} onClick={() => setStopping(true)}>
            {t("protocol.stop")}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={stopping}
        title={t("protocol.stop.title", { name: a.name })}
        confirmLabel={t("protocol.stop")}
        cancelLabel={t("common.cancel")}
        tone="danger"
        busy={update.isPending}
        onCancel={() => setStopping(false)}
        onConfirm={() => update.mutate({ id: a.id, status: "cancelled" }, { onSuccess: () => setStopping(false) })}
      >
        {t("protocol.stop.body")}
      </ConfirmDialog>
    </Card>
  );
}

function VideoStepName({ videoId }: { videoId: string }) {
  const t = useT();
  const { locale } = usePrefs();
  const v = useVideo(videoId, locale);
  return (
    <>
      <span className="step__name">▶ {v.data?.title ?? t("common.loading")}</span>
      <span className="app-muted">{[t("step.video"), v.data ? formatDuration(v.data.duration_s) : null].filter(Boolean).join(" · ")}</span>
    </>
  );
}
