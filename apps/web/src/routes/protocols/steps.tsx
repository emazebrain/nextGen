/**
 * The step list and step editor shared by the template builder and the
 * assign flow (design doc §5.4). The settings shown follow the mode (Timed:
 * time; Lives: hearts; both: both), only the game's supported modes are
 * offered, and the game's own settings come from its manifest schema.
 */
import { useId, useState } from "react";
import { timerPositionFor, timerShown } from "@emb/session-rules";
import { useIntl } from "react-intl";
import { ArrowDown, ArrowUp, ChevronDown, Gamepad2, Pencil, PlayCircle, Plus, Trash2 } from "lucide-react";
import { DEFAULT_PROGRESSION, isVideoStep, stepInput, type GameStepInput, type SessionMode, type StepInput } from "@emb/contracts";
import type { GameManifest } from "@emb/game-sdk";
import { Alert, Button, CheckboxField, Chip, IconButton, Segmented, SelectField } from "@emb/ui";
import { GAMES, findGame, localText } from "../../games/registry.ts";
import { useT, usePrefs } from "../../i18n/index.tsx";
import { useVideo } from "../../api/queries.ts";
import { formatDuration, VideoSourceChip } from "../admin/videos.tsx";
import { VideoPicker } from "./VideoPicker.tsx";

export function defaultStep(m: GameManifest): GameStepInput {
  const mode = m.recommendedMode ?? m.capabilities.modes[0] ?? "timed_lives";
  const game_params = Object.fromEntries(
    Object.entries(m.paramsSchema.properties)
      .filter(([, d]) => d.default !== undefined)
      .map(([k, d]) => [k, d.default as boolean | number | string]),
  );
  return {
    game_id: m.id,
    session_mode: mode,
    duration_s: mode === "lives" ? null : (m.recommendedDurationS ?? 300),
    // Games with their own board budget start on it: the manifest recommends it (§8.4 Peek Peek).
    lives: mode === "timed" || m.capabilities.livesAuto ? null : 3,
    lives_auto: mode !== "timed" && m.capabilities.livesAuto,
    difficulty_start: 3,
    hemisphere: "left",
    timer_position: timerPositionFor("left", true),
    practice: "auto",
    trial_window_ms: null,
    game_params,
    progression: DEFAULT_PROGRESSION,
  };
}

/** Per-step problems in plain language, using the same schema as the API. */
export function stepProblems(steps: StepInput[]): Array<{ n: number; code: string }> {
  const out: Array<{ n: number; code: string }> = [];
  steps.forEach((s, i) => {
    const r = stepInput.safeParse(s);
    if (!r.success) for (const issue of r.error.issues) out.push({ n: i + 1, code: issue.message });
    if (isVideoStep(s)) return;
    const m = findGame(s.game_id)?.manifest;
    if (m && !m.capabilities.modes.includes(s.session_mode)) out.push({ n: i + 1, code: "mode_not_supported" });
  });
  return out;
}

export function useStepSummary() {
  const t = useT();
  return (s: GameStepInput) =>
    [
      t("game.mode", { mode: s.session_mode }),
      s.duration_s !== null ? (s.duration_s < 60 ? t("stepEditor.seconds", { n: s.duration_s }) : t("step.minutes", { n: Math.round((s.duration_s / 60) * 10) / 10 })) : null,
      s.lives_auto ? t("step.heartsAuto") : s.lives !== null ? t("step.hearts", { n: s.lives }) : null,
      t("step.difficulty", { n: s.difficulty_start }),
      t("step.palette", { h: s.hemisphere }),
      s.duration_s !== null && timerShown(s.timer_position) ? t("step.timer", { h: s.hemisphere }) : null,
      s.monochrome ? t("step.monochrome") : null,
    ]
      .filter(Boolean)
      .join(" · ");
}

export function StepList({ steps, onChange, editable = true }: { steps: StepInput[]; onChange: (s: StepInput[]) => void; editable?: boolean }) {
  const t = useT();
  const { locale } = usePrefs();
  const summary = useStepSummary();
  const [open, setOpen] = useState<number | null>(null);
  const [picking, setPicking] = useState<"game" | "video" | null>(null);
  const problems = stepProblems(steps);

  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s!);
    onChange(next);
    if (open === i) setOpen(i + d);
  };

  return (
    <div className="steps">
      {problems.length > 0 && (
        <Alert tone="danger">
          <ul className="steps__problems">
            {problems.map((p) => (
              <li key={`${p.n}-${p.code}`}>{t("builder.stepError", { n: p.n, problem: t("builder.problem", { code: p.code }) })}</li>
            ))}
          </ul>
        </Alert>
      )}
      {steps.length === 0 && <p className="app-muted">{t("builder.noSteps")}</p>}
      <ol className="steps__list">
        {steps.map((s, i) => {
          const m = isVideoStep(s) ? undefined : findGame(s.game_id)?.manifest;
          const name = isVideoStep(s) ? null : m ? localText(m.name, locale) : s.game_id;
          return (
            <li key={`${i}-${isVideoStep(s) ? s.video_id : s.game_id}`} className={open === i ? "step is-open" : "step"}>
              <div className="step__row">
                <span className="step__num" aria-hidden="true">
                  {i + 1}
                </span>
                {isVideoStep(s) ? (
                  <VideoStepText videoId={s.video_id} />
                ) : (
                  <div className="step__text">
                    <p className="step__name">{name}</p>
                    <p className="app-muted">{summary(s)}</p>
                    {s.progression && <Chip tone="brand">{t("step.autoProgress")}</Chip>}
                  </div>
                )}
                {editable && (
                  <div className="step__actions">
                    <IconButton label={t("builder.moveUp", { n: i + 1 })} icon={<ArrowUp size={18} />} disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton label={t("builder.moveDown", { n: i + 1 })} icon={<ArrowDown size={18} />} disabled={i === steps.length - 1} onClick={() => move(i, 1)} />
                    <IconButton label={t("builder.remove", { n: i + 1 })} icon={<Trash2 size={18} />} onClick={() => {
                      onChange(steps.filter((_, j) => j !== i));
                      setOpen(null);
                    }} />
                    {!isVideoStep(s) && <Button
                      variant={open === i ? "primary" : "secondary"}
                      icon={open === i ? <ChevronDown size={18} aria-hidden="true" /> : <Pencil size={18} aria-hidden="true" />}
                      aria-expanded={open === i}
                      onClick={() => setOpen(open === i ? null : i)}
                    >
                      {open === i ? t("common.done") : t("common.edit")}
                      <span className="emb-vh"> {t("builder.stepN", { n: i + 1 })}</span>
                    </Button>}
                  </div>
                )}
              </div>
              {open === i && m && !isVideoStep(s) && <StepEditor step={s} manifest={m} onChange={(next) => onChange(steps.map((x, j) => (j === i ? next : x)))} />}
            </li>
          );
        })}
      </ol>
      {editable && picking === "video" && (
        <VideoPicker
          onCancel={() => setPicking(null)}
          onPick={(v) => {
            onChange([...steps, { step_type: "video", video_id: v.id }]);
            setPicking(null);
          }}
        />
      )}
      {editable &&
        picking !== "video" &&
        (picking === "game" ? (
          <div className="gamepick" role="group" aria-label={t("gamePicker.title")}>
            <p className="emb-field__label">{t("gamePicker.title")}</p>
            <ul className="plainlist">
              {GAMES.map(({ manifest: gm }) => (
                <li key={gm.id}>
                  <button
                    type="button"
                    className="gamepick__item"
                    onClick={() => {
                      onChange([...steps, defaultStep(gm)]);
                      setPicking(null);
                      setOpen(steps.length);
                    }}
                  >
                    <Gamepad2 size={20} aria-hidden="true" />
                    <span>
                      <span className="step__name">{localText(gm.name, locale)}</span>
                      <span className="app-muted gamepick__summary">{localText(gm.summary, locale)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Button variant="ghost" onClick={() => setPicking(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        ) : (
          <div className="steps__add">
            <Button variant="secondary" icon={<Plus size={18} aria-hidden="true" />} onClick={() => setPicking("game")}>
              {t("builder.addGame")}
            </Button>
            <Button variant="secondary" icon={<PlayCircle size={18} aria-hidden="true" />} onClick={() => setPicking("video")}>
              {t("builder.addVideo")}
            </Button>
          </div>
        ))}
    </div>
  );
}

/** A video step's title, length and where it plays from (ADR 0018). */
function VideoStepText({ videoId }: { videoId: string }) {
  const t = useT();
  const { locale } = usePrefs();
  const v = useVideo(videoId, locale);
  return (
    <div className="step__text">
      <p className="step__name">{v.data?.title ?? t("common.loading")}</p>
      <p className="app-muted">{[t("step.video"), v.data ? formatDuration(v.data.duration_s) : null].filter(Boolean).join(" · ")}</p>
      {v.data && <VideoSourceChip video={v.data} />}
    </div>
  );
}

const DURATIONS = [30, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1800];
const WINDOWS_S = [2, 3, 4, 5, 6, 8, 10, 15, 20, 30];
const PCTS_UP = [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1];
const PCTS_DOWN = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

function StepEditor({ step: s, manifest: m, onChange }: { step: GameStepInput; manifest: GameManifest; onChange: (s: GameStepInput) => void }) {
  const t = useT();
  const intl = useIntl();
  const { locale } = usePrefs();
  const id = useId();
  const set = <K extends keyof GameStepInput>(k: K, v: GameStepInput[K]) => onChange({ ...s, [k]: v });
  const pct = (n: number) => intl.formatNumber(n, { style: "percent" });

  const setMode = (mode: SessionMode) =>
    onChange({
      ...s,
      session_mode: mode,
      duration_s: mode === "lives" ? null : (s.duration_s ?? m.recommendedDurationS ?? 300),
      lives: mode === "timed" || s.lives_auto ? null : (s.lives ?? 3),
      lives_auto: mode !== "timed" && s.lives_auto === true,
    });
  // The timer's corner and look follow the hemisphere (ADR 0008); the therapist only chooses whether it shows.
  const showTimer = timerShown(s.timer_position);
  const setHemisphere = (h: "left" | "right") => onChange({ ...s, hemisphere: h, timer_position: timerPositionFor(h, showTimer) });

  const tw = m.capabilities.trialWindow;
  const windows = tw ? WINDOWS_S.filter((x) => x * 1000 >= tw.minMs && x * 1000 <= tw.maxMs) : [];
  const params = Object.entries(m.paramsSchema.properties);

  return (
    <div className="stepedit">
      <div className="stepedit__group">
        <Segmented<SessionMode>
          legend={t("stepEditor.mode")}
          name={`${id}-mode`}
          value={s.session_mode}
          onChange={setMode}
          options={m.capabilities.modes.map((md) => ({ value: md, label: t("game.mode", { mode: md }) }))}
        />
        <p className="emb-field__hint">{t("stepEditor.modeHelp", { mode: s.session_mode })}</p>
      </div>
      <div className="pform__row">
        {s.duration_s !== null && (
          <SelectField label={t("stepEditor.duration")} value={String(s.duration_s)} onChange={(e) => set("duration_s", Number(e.target.value))}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d < 60 ? t("stepEditor.seconds", { n: d }) : t("preview.durationValue", { n: d / 60 })}
              </option>
            ))}
          </SelectField>
        )}
        {(s.lives !== null || s.lives_auto) && (
          <div className="emb-field">
            <SelectField
              label={t("stepEditor.lives")}
              value={s.lives_auto ? "auto" : String(s.lives)}
              onChange={(e) => onChange({ ...s, ...(e.target.value === "auto" ? { lives: null, lives_auto: true } : { lives: Number(e.target.value), lives_auto: false }) })}
            >
              {m.capabilities.livesAuto && <option value="auto">{t("stepEditor.livesAuto")}</option>}
              {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </SelectField>
            <p className="emb-field__hint">
              {s.lives_auto ? t("stepEditor.livesAutoHelp") : t("stepEditor.livesHelp", { events: m.lifeLossEvents.map((e) => localText(e.label, locale)).join(", ") })}
            </p>
          </div>
        )}
      </div>
      <Segmented
        legend={t("stepEditor.difficulty")}
        name={`${id}-difficulty`}
        value={String(s.difficulty_start)}
        onChange={(v) => set("difficulty_start", Number(v))}
        options={["1", "2", "3", "4", "5"].map((d) => ({ value: d, label: d }))}
      />
      <Segmented<"left" | "right">
        legend={t("stepEditor.hemisphere")}
        name={`${id}-hemi`}
        value={s.hemisphere}
        onChange={setHemisphere}
        options={[
          { value: "left", label: <span className="swatchlabel"><span className="swatch swatch--warm" aria-hidden="true" />{t("stepEditor.hemiLeft")}</span> },
          { value: "right", label: <span className="swatchlabel"><span className="swatch swatch--cold" aria-hidden="true" />{t("stepEditor.hemiRight")}</span> },
        ]}
      />
      {m.hemisphereNote && <p className="emb-field__hint">{localText(m.hemisphereNote[s.hemisphere], locale)}</p>}
      {m.capabilities.monochrome && (
        <CheckboxField
          label={t("stepEditor.monochrome")}
          hint={t("stepEditor.monochromeHelp")}
          checked={s.monochrome === true}
          onChange={(e) => set("monochrome", e.target.checked)}
        />
      )}
      {s.duration_s !== null && (
        <div className="stepedit__group">
          <Segmented<"shown" | "hidden">
            legend={t("stepEditor.timer")}
            name={`${id}-timer`}
            value={showTimer ? "shown" : "hidden"}
            onChange={(v) => set("timer_position", timerPositionFor(s.hemisphere, v === "shown"))}
            options={(["shown", "hidden"] as const).map((v) => ({ value: v, label: t("stepEditor.timerValue", { v }) }))}
          />
          <p className="emb-field__hint">{showTimer ? t("stepEditor.timerHelp", { h: s.hemisphere, mono: s.monochrome ? "yes" : "no" }) : t("stepEditor.timerHidden")}</p>
        </div>
      )}
      <div className="pform__row">
        {m.capabilities.practice && (
          <SelectField label={t("stepEditor.practice")} value={s.practice} onChange={(e) => set("practice", e.target.value as GameStepInput["practice"])}>
            {(["auto", "on", "off"] as const).map((p) => (
              <option key={p} value={p}>
                {t("stepEditor.practiceValue", { p })}
              </option>
            ))}
          </SelectField>
        )}
        {tw && (
          <SelectField
            label={t("stepEditor.trialWindow")}
            value={s.trial_window_ms === null ? "" : String(s.trial_window_ms / 1000)}
            onChange={(e) => set("trial_window_ms", e.target.value ? Number(e.target.value) * 1000 : null)}
          >
            <option value="">{t("stepEditor.noLimit")}</option>
            {windows.map((w) => (
              <option key={w} value={w}>
                {t("stepEditor.seconds", { n: w })}
              </option>
            ))}
          </SelectField>
        )}
      </div>
      {params.length > 0 && (
        <fieldset className="stepedit__fieldset">
          <legend className="emb-field__label">{t("stepEditor.gameSettings")}</legend>
          {params.map(([key, def]) => {
            // A setting can depend on another (e.g. movement only for a textured background).
            const when = def["x-ui"]?.visibleWhen;
            const valueOf = (k: string) => s.game_params[k] ?? (m.paramsSchema.properties[k]?.default as boolean | number | string | undefined);
            if (when && Object.entries(when).some(([k, v]) => valueOf(k) !== v)) return null;
            const label = def["x-ui"] ? localText(def["x-ui"].label, locale) : key;
            const help = def["x-ui"]?.help ? localText(def["x-ui"].help, locale) : undefined;
            const value = s.game_params[key] ?? (def.default as boolean | number | string | undefined);
            if (def.type === "boolean") {
              return (
                <CheckboxField
                  key={key}
                  label={label}
                  {...(help ? { hint: help } : {})}
                  checked={value === true}
                  onChange={(e) => set("game_params", { ...s.game_params, [key]: e.target.checked })}
                />
              );
            }
            const step = def["x-ui"]?.step ?? 1;
            const options = def.enum ?? (def.minimum !== undefined && def.maximum !== undefined ? Array.from({ length: Math.floor((def.maximum - def.minimum) / step) + 1 }, (_, i) => def.minimum! + i * step) : []);
            const optionLabel = (o: string | number) => {
              const l = def["x-ui"]?.options?.[String(o)];
              return l ? localText(l, locale) : String(o);
            };
            const setValue = (v: string) => set("game_params", { ...s.game_params, [key]: def.type === "string" ? v : Number(v) });
            if (def["x-ui"]?.widget === "segmented") {
              return (
                <div key={key} className="stepedit__group">
                  <Segmented legend={label} name={`${id}-${key}`} value={String(value ?? "")} onChange={setValue} options={options.map((o) => ({ value: String(o), label: optionLabel(o) }))} />
                  {help && <p className="emb-field__hint">{help}</p>}
                </div>
              );
            }
            return (
              <div key={key} className="emb-field">
                <SelectField label={label} value={String(value ?? "")} onChange={(e) => setValue(e.target.value)}>
                  {options.map((o) => (
                    <option key={String(o)} value={String(o)}>
                      {optionLabel(o)}
                    </option>
                  ))}
                </SelectField>
                {help && <p className="emb-field__hint">{help}</p>}
              </div>
            );
          })}
        </fieldset>
      )}
      <div className="stepedit__fieldset">
        <CheckboxField label={t("stepEditor.progression")} checked={s.progression !== null} onChange={(e) => set("progression", e.target.checked ? DEFAULT_PROGRESSION : null)} />
        {s.progression ? (
          <>
            <div className="sentence">
              <span>{t("progression.upLabel")}</span>
              <SelectField label={t("progression.upLabel")} hideLabel value={String(s.progression.up_at)} onChange={(e) => set("progression", { ...s.progression!, up_at: Number(e.target.value) })}>
                {PCTS_UP.filter((p) => p > s.progression!.down_below).map((p) => (
                  <option key={p} value={p}>
                    {pct(p)}
                  </option>
                ))}
              </SelectField>
              <span>{t("progression.forLabel")}</span>
              <SelectField label={t("progression.forLabel")} hideLabel value={String(s.progression.up_after)} onChange={(e) => set("progression", { ...s.progression!, up_after: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {t("progression.sessions", { n })}
                  </option>
                ))}
              </SelectField>
            </div>
            <div className="sentence">
              <span>{t("progression.downLabel")}</span>
              <SelectField label={t("progression.downLabel")} hideLabel value={String(s.progression.down_below)} onChange={(e) => set("progression", { ...s.progression!, down_below: Number(e.target.value) })}>
                {PCTS_DOWN.filter((p) => p < s.progression!.up_at).map((p) => (
                  <option key={p} value={p}>
                    {pct(p)}
                  </option>
                ))}
              </SelectField>
              <span>{t("progression.forLabel")}</span>
              <SelectField label={t("progression.forLabel")} hideLabel value={String(s.progression.down_after)} onChange={(e) => set("progression", { ...s.progression!, down_after: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {t("progression.sessions", { n })}
                  </option>
                ))}
              </SelectField>
            </div>
            <p className="sentence__preview">
              {t("progression.preview", { up: pct(s.progression.up_at), upN: s.progression.up_after, down: pct(s.progression.down_below), downN: s.progression.down_after })}
            </p>
          </>
        ) : (
          <p className="emb-field__hint">{t("progression.off")}</p>
        )}
      </div>
    </div>
  );
}
