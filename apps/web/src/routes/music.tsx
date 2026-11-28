/**
 * Settings → Session music. Staff upload recorded music, say which side of the brain it is for and who gets it.
 * What each role may upload to — their own patients, the clinic, the organization, the platform — comes from the
 * API (row-level security decides); this screen only offers those levels. Every upload carries the uploader's
 * confirmation that they hold the rights to the music.
 */
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Alert, Button, Card, CheckboxField, Chip, ConfirmDialog, MazeLoader, PageHeader, Segmented, SelectField, TextField } from "@emb/ui";
import { ArrowLeft, Music, Trash2, Upload } from "lucide-react";
import { useT, type MessageId } from "../i18n/index.tsx";
import { useTitle } from "../lib/title.ts";
import { useClinic } from "../lib/clinic.tsx";
import { ApiError } from "../api/http.ts";
import { useFilesStatus } from "../api/upload.ts";
import { musicFileUrl, useMusic, useRemoveMusic, useUpdateMusic, useUploadMusic, type MusicScope, type MusicSide, type MusicTrack } from "../api/music.ts";

const MAX_BYTES = 20 * 1024 * 1024;
const SIDES: MusicSide[] = ["right", "left"];
/** Narrowest first: the default is the level that reaches the fewest people. */
const NARROW_FIRST: MusicScope[] = ["personal", "clinic", "organization", "platform"];

export function MusicSettingsPage() {
  const t = useT();
  const { clinicId } = useClinic();
  const list = useMusic(clinicId);
  useTitle(t("music.title"));
  const scopes = NARROW_FIRST.filter((s) => list.data?.upload_scopes.includes(s));

  return (
    <div className="app-page app-page--narrow">
      <Link to="/settings" className="parent-back">
        <ArrowLeft size={16} aria-hidden="true" className="parent-back__icon" />
        {t("settings.title")}
      </Link>
      <PageHeader title={t("music.title")} description={t("music.intro")} />

      <div className="settings">
      <TemporaryFilesNotice />
      {list.isPending && <MazeLoader label={t("common.loading")} />}
      {list.isError && <Alert tone="danger">{t("music.loadFailed")}</Alert>}

      {list.data && (scopes.length > 0 ? <UploadCard scopes={scopes} clinicId={clinicId} /> : <Alert tone="info">{t("music.noUpload")}</Alert>)}

      {list.data && (
        <Card as="section" labelledBy="music-list">
          <h2 id="music-list" className="app-cardtitle">{t("music.listTitle")}</h2>
          <p className="app-muted music-note">{t("music.order")}</p>
          {SIDES.map((side) => (
            <SideList key={side} side={side} tracks={list.data.tracks.filter((x) => x.hemisphere === side)} />
          ))}
        </Card>
      )}
      </div>
    </div>
  );
}

/** While the server has no permanent file storage, say so before anyone uploads something they want to keep. */
export function TemporaryFilesNotice() {
  const t = useT();
  const status = useFilesStatus();
  if (status.data?.durable !== false) return null;
  return <Alert tone="warning" title={t("files.temporaryTitle")}>{t("files.temporaryBody")}</Alert>;
}

function UploadCard({ scopes, clinicId }: { scopes: MusicScope[]; clinicId: string | null }) {
  const t = useT();
  const [progress, setProgress] = useState(0);
  const upload = useUploadMusic(setProgress);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [side, setSide] = useState<MusicSide>("right");
  const [scope, setScope] = useState<MusicScope>(scopes[0]!);
  const [rights, setRights] = useState(false);
  const [problem, setProblem] = useState<MessageId | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const level = scopes.includes(scope) ? scope : scopes[0]!;

  const pick = (f: File | null) => {
    setDone(null);
    setProblem(f && f.size > MAX_BYTES ? "music.error.tooLarge" : f && f.type && !f.type.startsWith("audio/") ? "music.error.type" : null);
    setFile(f);
    // The file's own name, without its extension, is a fair first title.
    if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, "").slice(0, 120));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !title.trim() || !rights || problem) return;
    setDone(null);
    setProgress(0);
    try {
      const track = await upload.mutateAsync({ file, title: title.trim(), hemisphere: side, scope: level, clinicId });
      setDone(track.title);
      setFile(null);
      setTitle("");
      setRights(false); // each upload is confirmed on its own
      if (input.current) input.current.value = "";
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setProblem(status === 413 ? "music.error.tooLarge" : status === 415 ? "music.error.type" : status === 403 ? "music.error.forbidden" : "music.error.generic");
    }
  };

  return (
    <Card as="section" labelledBy="music-upload">
      <h2 id="music-upload" className="app-cardtitle">{t("music.uploadTitle")}</h2>
      <form className="music-form" onSubmit={(e) => void submit(e)}>
        <div className="music-form__file">
          <label htmlFor="music-file" className="music-form__label">{t("music.file")}</label>
          <input ref={input} id="music-file" type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg" aria-describedby="music-file-hint" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          <p id="music-file-hint" className="app-muted music-note">{t("music.fileHint")}</p>
        </div>
        <TextField label={t("music.name")} name="title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} required />
        <div>
          <Segmented<MusicSide> legend={t("music.side")} name="side" value={side} onChange={setSide} options={SIDES.map((s) => ({ value: s, label: t(`music.side.${s}`) }))} />
          <p className="app-muted music-note">{t(`music.sideHint.${side}`)}</p>
        </div>
        {scopes.length > 1 ? (
          <SelectField label={t("music.scope")} name="scope" value={level} onChange={(e) => setScope(e.target.value as MusicScope)}>
            {scopes.map((s) => (
              <option key={s} value={s}>{t(`music.scope.${s}`)}</option>
            ))}
          </SelectField>
        ) : (
          <p className="music-form__only">
            <span className="music-form__label">{t("music.scope")}</span> {t(`music.scope.${level}`)}
          </p>
        )}
        <Alert tone="warning" title={t("music.rightsTitle")}>{t("music.rightsBody")}</Alert>
        <CheckboxField label={t("music.rightsConfirm")} checked={rights} onChange={(e) => setRights(e.target.checked)} required />
        {problem && <Alert tone="danger">{t(problem)}</Alert>}
        {done && <Alert tone="success">{t("music.uploaded", { title: done })}</Alert>}
        <div className="pform__actions">
          <Button type="submit" icon={<Upload size={18} aria-hidden="true" />} loading={upload.isPending} disabled={!file || !title.trim() || !rights || !!problem}>
            {upload.isPending ? t("music.progress", { pct: Math.round(progress * 100) }) : t("music.upload")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SideList({ side, tracks }: { side: MusicSide; tracks: MusicTrack[] }) {
  const t = useT();
  const update = useUpdateMusic();
  const remove = useRemoveMusic();
  const [removing, setRemoving] = useState<MusicTrack | null>(null);
  const other: MusicSide = side === "right" ? "left" : "right";
  return (
    <section className="music-side" aria-labelledby={`music-${side}`}>
      <h3 id={`music-${side}`} className="music-side__title">
        <Music size={18} aria-hidden="true" />
        {t(`music.side.${side}`)}
      </h3>
      {tracks.length === 0 ? (
        <p className="app-muted">{t("music.empty")}</p>
      ) : (
        <ul className="plainlist music-list">
          {tracks.map((track) => (
            <li key={track.id} className="music-track">
              <div className="music-track__head">
                <span className="music-track__title"><bdi>{track.title}</bdi></span>
                <Chip tone="neutral">{t(`music.scope.${track.scope}`)}</Chip>
              </div>
              {track.uploaded_by && <span className="app-muted music-note">{t("music.by", { name: track.uploaded_by })}</span>}
              {/* Loaded only when someone presses play. */}
              <audio className="music-track__player" controls preload="none" src={musicFileUrl(track.id)} aria-label={track.title} />
              {track.can_manage && (
                <div className="music-track__actions">
                  <Button variant="secondary" disabled={update.isPending} onClick={() => update.mutate({ id: track.id, hemisphere: other })}>
                    {t("music.moveTo", { side: t(`music.side.${other}`) })}
                  </Button>
                  <Button variant="ghost" icon={<Trash2 size={18} aria-hidden="true" />} onClick={() => setRemoving(track)}>
                    {t("music.remove")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!removing}
        title={t("music.removeTitle", { title: removing?.title ?? "" })}
        confirmLabel={t("music.remove")}
        cancelLabel={t("common.cancel")}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id, { onSettled: () => setRemoving(null) })}
        onCancel={() => setRemoving(null)}
      >
        {t("music.removeBody")}
      </ConfirmDialog>
    </section>
  );
}
