/**
 * The video library for platform admins (ADR 0018): add a YouTube link or upload a file, give it titles, tag the
 * brain regions it works on, publish. Therapists pick published videos into protocols.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Film } from "lucide-react";
import { Alert, Button, Card, Chip, DataList, EmptyState, MazeLoader, PageHeader, SelectField, TextAreaField, TextField, type Column } from "@emb/ui";
import { youtubeId, type VideoInput, type VideoSummary } from "@emb/contracts";
import { ApiError } from "../../api/http.ts";
import { uploadVideoFile, useBrainRegions, useMe, useSaveVideo, useVideo, useVideos } from "../../api/queries.ts";
import { usePrefs, useT, type MessageId } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { LoadError } from "../shared.tsx";
import { RegionTagPicker, useRegionChip, useRegionTree } from "./RegionPicker.tsx";

const AGES = Array.from({ length: 16 }, (_, i) => i + 3);

function NotAllowed() {
  const t = useT();
  return (
    <div className="app-page">
      <EmptyState icon={<Film size={32} aria-hidden="true" />} title={t("videos.notAllowed")}>
        {t("videos.notAllowedHint")}
      </EmptyState>
    </div>
  );
}

export function VideoSourceChip({ video }: { video: Pick<VideoSummary, "needs_internet"> }) {
  const t = useT();
  return video.needs_internet ? <Chip tone="warning">{t("videos.needsInternet")}</Chip> : <Chip tone="success">{t("videos.onDevice")}</Chip>;
}

export function VideoRegionChips({ video, max = 2 }: { video: Pick<VideoSummary, "regions">; max?: number }) {
  const t = useT();
  const { locale } = usePrefs();
  const regions = useBrainRegions(locale);
  const tree = useRegionTree(regions.data);
  const chip = useRegionChip();
  if (!video.regions.length) return <span className="app-muted">{t("videos.noRegions")}</span>;
  return (
    <span className="chips">
      {video.regions.slice(0, max).map((r) => (
        <Chip key={r.id}>{chip(r, tree)}</Chip>
      ))}
      {video.regions.length > max && <Chip>{t("videos.moreRegions", { count: video.regions.length - max })}</Chip>}
    </span>
  );
}

export function formatDuration(s: number | null) {
  if (!s) return "";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VideosAdminPage() {
  const t = useT();
  const me = useMe();
  const { locale } = usePrefs();
  const navigate = useNavigate();
  const videos = useVideos({ lang: locale, all: true }, !!me.data?.is_platform_admin);
  useTitle(t("videos.title"));
  if (!me.data?.is_platform_admin) return <NotAllowed />;
  const statusTone = { published: "success", draft: "neutral", archived: "warning" } as const;
  const columns: Column<VideoSummary>[] = [
    { id: "title", header: t("videos.col.title"), primary: true, cell: (v) => v.title },
    { id: "source", header: t("videos.col.source"), cell: (v) => <VideoSourceChip video={v} /> },
    { id: "regions", header: t("videos.col.regions"), cell: (v) => <VideoRegionChips video={v} /> },
    { id: "length", header: t("videos.col.length"), numeric: true, cell: (v) => formatDuration(v.duration_s) },
    { id: "status", header: t("videos.col.status"), cell: (v) => <Chip tone={statusTone[v.status]}>{t(`videos.status.${v.status}`)}</Chip> },
  ];
  return (
    <div className="app-page">
      <PageHeader
        title={t("videos.title")}
        description={t("videos.description")}
        actions={
          <Button onClick={() => navigate("/admin/videos/new")} icon={<Film size={18} aria-hidden="true" />}>
            {t("videos.add")}
          </Button>
        }
      />
      {videos.isPending ? (
        <MazeLoader label={t("common.loading")} />
      ) : videos.isError ? (
        <LoadError error={videos.error} retry={() => void videos.refetch()} />
      ) : videos.data.length === 0 ? (
        <EmptyState icon={<Film size={32} aria-hidden="true" />} title={t("videos.empty")} />
      ) : (
        <Card padded={false}>
          <DataList
            rows={videos.data}
            columns={columns}
            getRowKey={(v) => v.id}
            caption={t("videos.caption")}
            getRowHref={(v) => `/admin/videos/${v.id}`}
            renderLink={({ href, className, children }) => (
              <Link to={href} className={className}>
                {children}
              </Link>
            )}
          />
        </Card>
      )}
    </div>
  );
}

interface Draft {
  source: "upload" | "youtube";
  youtube_url: string;
  title_en: string;
  title_he: string;
  description_en: string;
  description_he: string;
  region_ids: string[];
  age_min: string;
  age_max: string;
  status: "draft" | "published" | "archived";
  duration_s: number | null;
  /** A YouTube video's length as typed (m:ss); the page can't read it from YouTube. */
  duration_text: string;
}

const empty: Draft = { source: "upload", youtube_url: "", title_en: "", title_he: "", description_en: "", description_he: "", region_ids: [], age_min: "", age_max: "", status: "draft", duration_s: null, duration_text: "" };

function fromVideo(v: VideoSummary): Draft {
  return {
    source: v.source,
    youtube_url: v.youtube_id ? `https://www.youtube.com/watch?v=${v.youtube_id}` : "",
    title_en: v.titles.en ?? "",
    title_he: v.titles.he ?? "",
    description_en: v.descriptions.en ?? "",
    description_he: v.descriptions.he ?? "",
    region_ids: v.regions.map((r) => r.id),
    age_min: v.age_min?.toString() ?? "",
    age_max: v.age_max?.toString() ?? "",
    status: v.status,
    duration_s: v.duration_s,
    duration_text: v.source === "youtube" && v.duration_s ? formatDuration(v.duration_s) : "",
  };
}

/** "1:30" or "90" → 90; empty → null (unknown); anything else → undefined (invalid). */
export function parseClock(text: string): number | null | undefined {
  const s = text.trim();
  if (!s) return null;
  const m = /^(?:(\d{1,3}):)?(\d{1,4})$/.exec(s);
  if (!m) return undefined;
  if (m[1] !== undefined && Number(m[2]) > 59) return undefined;
  const total = Number(m[1] ?? 0) * 60 + Number(m[2]);
  return total > 0 && total <= 86400 ? total : undefined;
}

/**
 * The server won't publish an upload that has no file yet. With a file waiting, save it as a draft first, upload,
 * then publish; the first save's id is kept so a failed upload retried from the same form doesn't add a second video.
 */
export function savePlan(o: { want: "draft" | "published" | "archived"; hasFile: boolean; pendingFile: boolean }): { first: "draft" | "published" | "archived"; publishAfter: boolean } {
  if (o.want === "published" && o.pendingFile && !o.hasFile) return { first: "draft", publishAfter: true };
  return { first: o.want, publishAfter: false };
}

/** Reads a local video file's length before it is uploaded. */
function fileDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration) : null);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    el.src = url;
  });
}

export function VideoEditorPage() {
  const t = useT();
  const me = useMe();
  const { locale } = usePrefs();
  const { id: rawId } = useParams();
  const id = rawId && rawId !== "new" ? rawId : null;
  const navigate = useNavigate();
  const existing = useVideo(id, locale);
  const regions = useBrainRegions(locale);
  const tree = useRegionTree(regions.data);
  const save = useSaveVideo();
  const [draft, setDraft] = useState<Draft>(empty);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const savedId = useRef<string | null>(null);
  const savedHasFile = useRef(false);
  useTitle(t(id ? "videos.edit" : "videos.add"));
  useEffect(() => {
    if (existing.data) setDraft(fromVideo(existing.data));
  }, [existing.data]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const ytInvalid = draft.source === "youtube" && draft.youtube_url.trim() !== "" && !youtubeId(draft.youtube_url);
  const busy = save.isPending || progress !== null;

  const input = useMemo<VideoInput>(
    () => ({
      source: draft.source,
      ...(draft.source === "youtube" ? { youtube_url: draft.youtube_url } : {}),
      titles: { ...(draft.title_en.trim() ? { en: draft.title_en } : {}), ...(draft.title_he.trim() ? { he: draft.title_he } : {}) },
      descriptions: { ...(draft.description_en.trim() ? { en: draft.description_en } : {}), ...(draft.description_he.trim() ? { he: draft.description_he } : {}) },
      region_ids: draft.region_ids,
      age_min: draft.age_min ? Number(draft.age_min) : null,
      age_max: draft.age_max ? Number(draft.age_max) : null,
      status: draft.status,
      duration_s: draft.source === "youtube" ? (parseClock(draft.duration_text) ?? null) : draft.duration_s,
    }),
    [draft],
  );

  if (!me.data?.is_platform_admin) return <NotAllowed />;
  if (id && existing.isPending) return <MazeLoader label={t("common.loading")} />;
  if (id && existing.isError) return <LoadError error={existing.error} retry={() => void existing.refetch()} />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIssues({});
    const vid = id ?? savedId.current;
    const hasFile = !!existing.data?.has_file || savedHasFile.current;
    if (draft.source === "upload" && !hasFile && !file) {
      setIssues({ file: t("videos.err.file") });
      return;
    }
    if (draft.source === "youtube" && parseClock(draft.duration_text) === undefined) {
      setIssues({ duration_s: t("videos.err.duration_s") });
      return;
    }
    const uploading = !!file && draft.source === "upload";
    const plan = savePlan({ want: draft.status, hasFile, pendingFile: uploading });
    try {
      const saved = await save.mutateAsync({ id: vid, input: { ...input, status: plan.first }, lang: locale });
      savedId.current = saved.id;
      if (uploading) {
        setProgress(0);
        await uploadVideoFile(saved.id, file, setProgress);
        savedHasFile.current = true;
        setFile(null);
      }
      if (plan.publishAfter) await save.mutateAsync({ id: saved.id, input, lang: locale });
      navigate("/admin/videos");
    } catch (err) {
      setProgress(null);
      if (err instanceof ApiError && err.issues.length) {
        const map: Record<string, string> = {};
        for (const i of err.issues) {
          const field = i.code === "needs_file" ? "file" : i.path.split(".")[0]!;
          map[field] = t(`videos.err.${field}` as MessageId);
        }
        setIssues(map);
      } else if (err instanceof ApiError && (err.status === 413 || err.status === 415)) setError(t(err.status === 413 ? "videos.err.tooLarge" : "videos.err.type"));
      else setError(t("videos.err.save"));
    }
  };

  return (
    <div className="app-page">
      <PageHeader title={t(id ? "videos.edit" : "videos.add")} eyebrow={<Link to="/admin/videos">{t("videos.title")}</Link>} />
      <form className="video-editor" onSubmit={onSubmit} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Card>
          <fieldset className="choice choice--row">
            <legend className="emb-field__label">{t("videos.source")}</legend>
            {(["upload", "youtube"] as const).map((s) => (
              <label key={s} className={draft.source === s ? "choice__option is-selected" : "choice__option"}>
                <input type="radio" name="source" value={s} checked={draft.source === s} onChange={() => set("source", s)} />
                <span>{t(`videos.source.${s}`)}</span>
              </label>
            ))}
          </fieldset>
          {draft.source === "youtube" ? (
            <TextField
              label={t("videos.youtubeUrl")}
              dir="ltr"
              inputMode="url"
              value={draft.youtube_url}
              onChange={(e) => set("youtube_url", e.target.value)}
              error={ytInvalid || issues.youtube_url ? t("videos.err.youtube_url") : undefined}
              hint={t("videos.youtubeHint")}
            />
          ) : null}
          {draft.source === "youtube" ? (
            <TextField
              label={t("videos.length")}
              dir="ltr"
              inputMode="numeric"
              value={draft.duration_text}
              onChange={(e) => set("duration_text", e.target.value)}
              error={issues.duration_s ?? (parseClock(draft.duration_text) === undefined ? t("videos.err.duration_s") : undefined)}
              hint={t("videos.lengthHint")}
            />
          ) : (
            <div className={issues.file ? "emb-field emb-field--invalid" : "emb-field"}>
              <label className="emb-field__label" htmlFor="video-file">
                {t("videos.file")}
              </label>
              <input
                id="video-file"
                type="file"
                accept="video/mp4,video/webm"
                aria-describedby="video-file-hint"
                onChange={async (e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f) set("duration_s", await fileDuration(f));
                }}
              />
              <p id="video-file-hint" className="emb-field__hint">
                {existing.data?.has_file ? t("videos.fileReplace") : t("videos.fileHint")}
              </p>
              {issues.file && <p className="emb-field__error">{issues.file}</p>}
              {progress !== null && (
                <div className="video-editor__progress">
                  <progress max={1} value={progress} aria-label={t("videos.uploading")} />
                  <span>{t("videos.uploadingPct", { pct: Math.round(progress * 100) })}</span>
                </div>
              )}
            </div>
          )}
        </Card>
        <Card>
          <div className="video-editor__pair">
            <TextField label={t("videos.titleEn")} dir="ltr" value={draft.title_en} onChange={(e) => set("title_en", e.target.value)} error={issues.titles} maxLength={160} />
            <TextField label={t("videos.titleHe")} dir="rtl" value={draft.title_he} onChange={(e) => set("title_he", e.target.value)} maxLength={160} />
            <TextAreaField label={t("videos.descEn")} dir="ltr" rows={3} value={draft.description_en} onChange={(e) => set("description_en", e.target.value)} maxLength={2000} />
            <TextAreaField label={t("videos.descHe")} dir="rtl" rows={3} value={draft.description_he} onChange={(e) => set("description_he", e.target.value)} maxLength={2000} />
          </div>
          <div className="video-editor__pair">
            <SelectField label={t("videos.ageMin")} value={draft.age_min} onChange={(e) => set("age_min", e.target.value)}>
              <option value="">{t("videos.anyAge")}</option>
              {AGES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("videos.ageMax")} value={draft.age_max} onChange={(e) => set("age_max", e.target.value)}>
              <option value="">{t("videos.anyAge")}</option>
              {AGES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </SelectField>
          </div>
          {issues.age_max && <p className="emb-field__error">{issues.age_max}</p>}
        </Card>
        <Card>{regions.isPending ? <MazeLoader label={t("common.loading")} /> : <RegionTagPicker tree={tree} value={draft.region_ids} onChange={(ids) => set("region_ids", ids)} />}</Card>
        <Card>
          <fieldset className="choice choice--row">
            <legend className="emb-field__label">{t("videos.col.status")}</legend>
            {(["draft", "published", "archived"] as const).map((s) => (
              <label key={s} className={draft.status === s ? "choice__option is-selected" : "choice__option"}>
                <input type="radio" name="status" value={s} checked={draft.status === s} onChange={() => set("status", s)} />
                <span>{t(`videos.status.${s}`)}</span>
              </label>
            ))}
          </fieldset>
        </Card>
        <div className="video-editor__actions">
          <Button type="submit" loading={busy} disabled={ytInvalid}>
            {t("videos.save")}
          </Button>
          <Button variant="secondary" onClick={() => navigate("/admin/videos")} disabled={busy}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </div>
  );
}
