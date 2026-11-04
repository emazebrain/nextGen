/**
 * Content library (design doc §5.7): every game with what it trains, which
 * modes it supports, and a preview that runs the real game in demo mode
 * (nothing saved).
 */
import { useState, type FormEvent } from "react";
import { timerPositionFor } from "@emb/session-rules";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useIntl } from "react-intl";
import { ArrowLeft, Clock, Gamepad2, Play, X } from "lucide-react";
import type { PlatformParams, SessionMode } from "@emb/game-sdk";
import type { ResultEnvelope } from "@emb/game-runtime/protocol";
import { Alert, Button, Card, CheckboxField, Chip, EmptyState, PageHeader, Segmented, SelectField } from "@emb/ui";
import { GAMES, UPCOMING, findGame, launchParams, localText } from "../games/registry.ts";
import { GameFrame } from "../games/GameFrame.tsx";
import { useT, usePrefs, locales, type Locale, type MessageId } from "../i18n/index.tsx";
import { useTitle } from "../lib/title.ts";
import { uuidv7 } from "../lib/ids.ts";

export function LibraryPage() {
  const t = useT();
  const { locale } = usePrefs();
  useTitle(t("library.title"));
  return (
    <div className="app-page">
      <PageHeader title={t("library.title")} description={t("library.intro")} />
      <h2 className="app-sectiontitle">{t("library.games")}</h2>
      <ul className="gamegrid">
        {GAMES.map(({ manifest: m }) => (
          <li key={m.id}>
            <Link to={`/library/${m.id}`} className="gamecard">
              <GameArt id={m.id} />
              <span className="gamecard__body">
                <span className="gamecard__name">{localText(m.name, locale)}</span>
                <span className="gamecard__summary">{localText(m.summary, locale)}</span>
                <span className="gamecard__meta">
                  <span>{t("library.ages", { from: m.ageRange[0], to: m.ageRange[1] })}</span>
                  <span aria-hidden="true">·</span>
                  <span>{t("library.minutes", { n: m.minutes })}</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
        {UPCOMING.map((g) => (
          <li key={g.id}>
            <div className="gamecard gamecard--soon" aria-disabled="true">
              <GameArt id={g.id} muted />
              <span className="gamecard__body">
                <span className="gamecard__name">{localText(g.name, locale)}</span>
                <Chip>{t("library.comingSoon")}</Chip>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A small warm/cold swatch until the game's illustrated card art arrives. */
function GameArt({ id, muted = false }: { id: string; muted?: boolean }) {
  const hue = [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 2 === 0;
  return (
    <span className={`gameart ${hue ? "gameart--warm" : "gameart--cold"} ${muted ? "gameart--muted" : ""}`} aria-hidden="true">
      <Gamepad2 size={28} />
    </span>
  );
}

export function GamePage() {
  const t = useT();
  const { locale } = usePrefs();
  const navigate = useNavigate();
  const { gameId = "" } = useParams();
  const game = findGame(gameId);
  const m = game?.manifest;
  const [palette, setPalette] = useState<"warm" | "cold">("warm");
  const [mode, setMode] = useState<SessionMode>(m?.recommendedMode ?? "timed_lives");
  const [minutes, setMinutes] = useState("2");
  const [lives, setLives] = useState(m?.capabilities.livesAuto ? "auto" : "3");
  const [difficulty, setDifficulty] = useState("3");
  const [practice, setPractice] = useState(true);
  const [lang, setLang] = useState<Locale>(locale);
  const [mono, setMono] = useState(false);
  const [background, setBackground] = useState("solid");
  const [motion, setMotion] = useState(false);
  const [temperature, setTemperature] = useState("auto");
  const packDef = m?.paramsSchema.properties.pack;
  const [pack, setPack] = useState(String(packDef?.default ?? ""));
  useTitle(m ? localText(m.name, locale) : t("library.title"));

  if (!m) {
    return (
      <div className="app-page">
        <Card>
          <EmptyState icon={<Gamepad2 size={28} aria-hidden="true" />} title={t("notFound.title")} />
        </Card>
      </div>
    );
  }

  const hasBackground = !!m.paramsSchema.properties.background;
  const start = (e: FormEvent) => {
    e.preventDefault();
    const q = new URLSearchParams({ palette, mode, minutes, lives, difficulty, practice: practice ? "on" : "off", lang });
    if (mono) q.set("mono", "1");
    if (packDef && pack) q.set("pack", pack);
    if (hasBackground) {
      q.set("bg", background);
      q.set("temp", temperature);
      if (background === "textured" && motion) q.set("motion", "1");
    }
    navigate(`/library/${m.id}/preview?${q}`);
  };

  return (
    <div className="app-page">
      <Link to="/library" className="app-textlink app-back">
        <ArrowLeft size={18} aria-hidden="true" className="emb-flip-rtl" />
        {t("library.title")}
      </Link>
      <PageHeader title={localText(m.name, locale)} description={localText(m.summary, locale)} />
      <div className="pgrid">
        <Card as="section" labelledBy="g-about">
          <h2 id="g-about" className="app-cardtitle">
            {t("patient.details")}
          </h2>
          <dl className="app-dl">
            <div>
              <dt>{t("game.skills")}</dt>
              <dd className="chips">
                {m.taxonomy.skills.map((s) => (
                  <Chip key={s} tone="brand">
                    {t(`skill.${s}` as MessageId)}
                  </Chip>
                ))}
              </dd>
            </div>
            <div>
              <dt>{t("game.regions")}</dt>
              <dd dir="ltr" className="emb-tnum">
                {m.taxonomy.regions.join(", ")}
              </dd>
            </div>
            <div>
              <dt>{t("game.modes")}</dt>
              <dd className="chips">
                {m.capabilities.modes.map((md) => (
                  <Chip key={md}>{t("game.mode", { mode: md })}</Chip>
                ))}
              </dd>
            </div>
            <div>
              <dt>{t("game.lifeLoss")}</dt>
              <dd>{m.lifeLossEvents.map((ev) => localText(ev.label, locale)).join(" · ")}</dd>
            </div>
            <div>
              <dt>
                <Clock size={16} aria-hidden="true" className="inline-icon" />
                {t("library.minutes", { n: m.minutes })}
              </dt>
              <dd>{t("library.ages", { from: m.ageRange[0], to: m.ageRange[1] })}</dd>
            </div>
          </dl>
        </Card>
        <Card as="section" labelledBy="g-try">
          <form className="pform" onSubmit={start}>
            <h2 id="g-try" className="app-cardtitle">
              {t("preview.title")}
            </h2>
            <Segmented
              legend={t("preview.palette")}
              name="palette"
              value={palette}
              onChange={setPalette}
              options={[
                { value: "warm", label: <span className="swatchlabel"><span className="swatch swatch--warm" aria-hidden="true" />{t("preview.warm")}</span> },
                { value: "cold", label: <span className="swatchlabel"><span className="swatch swatch--cold" aria-hidden="true" />{t("preview.cold")}</span> },
              ]}
            />
            <Segmented
              legend={t("preview.mode")}
              name="mode"
              value={mode}
              onChange={setMode}
              options={m.capabilities.modes.map((md) => ({ value: md, label: t("game.mode", { mode: md }) }))}
            />
            <div className="pform__row">
              {mode !== "lives" && (
                <SelectField label={t("preview.duration")} value={minutes} onChange={(e) => setMinutes(e.target.value)}>
                  {["1", "2", "3", "5", "10"].map((n) => (
                    <option key={n} value={n}>
                      {t("preview.durationValue", { n: Number(n) })}
                    </option>
                  ))}
                </SelectField>
              )}
              {mode !== "timed" && (
                <SelectField label={t("preview.lives")} value={lives} onChange={(e) => setLives(e.target.value)}>
                  {m.capabilities.livesAuto && <option value="auto">{t("stepEditor.livesAuto")}</option>}
                  {Array.from({ length: 9 }, (_, i) => String(i + 1)).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </SelectField>
              )}
              <SelectField label={t("preview.language")} value={lang} onChange={(e) => setLang(e.target.value as Locale)}>
                {locales.map((l) => (
                  <option key={l} value={l} lang={l}>
                    {t(`language.${l}`)}
                  </option>
                ))}
              </SelectField>
            </div>
            <Segmented
              legend={t("preview.difficulty")}
              name="difficulty"
              value={difficulty}
              onChange={setDifficulty}
              options={["1", "2", "3", "4", "5"].map((d) => ({ value: d, label: d }))}
            />
            {packDef?.enum && packDef["x-ui"] && (
              <SelectField label={localText(packDef["x-ui"].label, locale)} value={pack} onChange={(e) => setPack(e.target.value)}>
                {packDef.enum.map((v) => (
                  <option key={String(v)} value={String(v)}>
                    {packDef["x-ui"]?.options?.[String(v)] ? localText(packDef["x-ui"].options[String(v)]!, locale) : String(v)}
                  </option>
                ))}
              </SelectField>
            )}
            <CheckboxField label={t("preview.practice")} checked={practice} onChange={(e) => setPractice(e.target.checked)} />
            {m.capabilities.monochrome && <CheckboxField label={t("stepEditor.monochrome")} hint={t("stepEditor.monochromeHelp")} checked={mono} onChange={(e) => setMono(e.target.checked)} />}
            {hasBackground && (
              <>
                <Segmented
                  legend={t("preview.background")}
                  name="background"
                  value={background}
                  onChange={setBackground}
                  options={[
                    { value: "solid", label: t("preview.backgroundValue", { v: "solid" }) },
                    { value: "textured", label: t("preview.backgroundValue", { v: "textured" }) },
                  ]}
                />
                {background === "textured" && <CheckboxField label={t("preview.motion")} checked={motion} onChange={(e) => setMotion(e.target.checked)} />}
                <SelectField label={t("preview.temperature")} value={temperature} onChange={(e) => setTemperature(e.target.value)}>
                  {["auto", "warm", "cold"].map((v) => (
                    <option key={v} value={v}>
                      {t("preview.temperatureValue", { v })}
                    </option>
                  ))}
                </SelectField>
              </>
            )}
            <div className="pform__actions">
              <Button type="submit" size="lg" icon={<Play size={20} aria-hidden="true" />}>
                {t("preview.start")}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}

/** Full-screen preview: the real game in demo mode. Nothing is saved. */
export function GamePreviewPage() {
  const t = useT();
  const intl = useIntl();
  const { locale } = usePrefs();
  const navigate = useNavigate();
  const { gameId = "" } = useParams();
  const [q] = useSearchParams();
  const game = findGame(gameId);
  const [sessionId] = useState(uuidv7);
  const [result, setResult] = useState<ResultEnvelope | null>(null);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState(false);
  const name = game ? localText(game.manifest.name, locale) : "";
  useTitle(t("preview.frameTitle", { name }));

  const [params] = useState(() => {
    const hemisphere: PlatformParams["hemisphere"] = q.get("palette") === "cold" ? "right" : "left";
    const mode = (q.get("mode") as SessionMode) || "timed_lives";
    return launchParams({
      session_mode: mode,
      duration_s: Number(q.get("minutes") ?? 2) * 60,
      lives: q.get("lives") === "auto" ? "auto" : Number(q.get("lives") ?? 3),
      difficulty: Number(q.get("difficulty") ?? 3) as PlatformParams["difficulty"],
      hemisphere,
      timer_position: timerPositionFor(hemisphere, true),
      practice: q.get("practice") === "off" ? "off" : "on",
      lang: (q.get("lang") as PlatformParams["lang"]) || "he",
      monochrome: q.get("mono") === "1",
      ...(q.get("pack") && game ? { [`${game.manifest.id.replace(/-/g, "_")}.pack`]: q.get("pack") } : {}),
      ...(q.get("bg") && game
        ? {
            [`${game.manifest.id.replace(/-/g, "_")}.background`]: q.get("bg") === "textured" ? "textured" : "solid",
            [`${game.manifest.id.replace(/-/g, "_")}.bg_motion`]: q.get("motion") === "1",
            [`${game.manifest.id.replace(/-/g, "_")}.bg_temperature`]: ["warm", "cold"].includes(q.get("temp") ?? "") ? q.get("temp") : "auto",
          }
        : {}),
    });
  });

  const back = () => navigate(`/library/${gameId}`);
  if (!game) return null;

  if (closed || error) {
    return (
      <div className="handoff">
        <main id="main" className="handoff__main">
          <Card>
            <div className="handoff__form">
              {error ? <Alert tone="danger">{t("preview.error")}</Alert> : <Alert tone="info">{t("preview.done")}</Alert>}
              {result && <ResultSummary envelope={result} intl={intl} />}
              <div className="pform__actions">
                <Button onClick={back}>{t("common.done")}</Button>
              </div>
            </div>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="playscreen">
      <GameFrame
        game={game}
        sessionId={sessionId}
        params={params}
        demo
        title={t("preview.frameTitle", { name })}
        loadingLabel={t("common.loading")}
        onEnded={setResult}
        onClosed={() => setClosed(true)}
        onError={(message) => {
          console.warn("Game frame error:", message); // no patient data: messages come from the game code
          setError(true);
        }}
      />
      <button type="button" className="playscreen__close" onClick={back}>
        <X size={20} aria-hidden="true" />
        <span>{t("preview.close")}</span>
      </button>
    </div>
  );
}

export function ResultSummary({ envelope: e, intl }: { envelope: ResultEnvelope; intl: ReturnType<typeof useIntl> }) {
  const t = useT();
  const pct = e.std.accuracy !== null ? intl.formatNumber(e.std.accuracy, { style: "percent" }) : "—";
  const mins = Math.floor(e.active_ms / 60000);
  const secs = Math.round((e.active_ms % 60000) / 1000);
  const highest = typeof e.metrics.highest_level === "number" ? e.metrics.highest_level : null;
  return (
    <dl className="resultgrid">
      <div>
        <dt>{t("patient.status")}</dt>
        <dd>{t("result.status", { status: e.status })}</dd>
      </div>
      <div>
        <dt>{t("result.accuracy")}</dt>
        <dd className="emb-tnum">{pct}</dd>
      </div>
      <div>
        <dt>{t("result.time")}</dt>
        <dd className="emb-tnum" dir="ltr">{`${mins}:${String(secs).padStart(2, "0")}`}</dd>
      </div>
      <div>
        <dt>{t("result.rt")}</dt>
        <dd className="emb-tnum">{e.std.rt_median_ms !== null ? t("result.ms", { n: Math.round(e.std.rt_median_ms) }) : "—"}</dd>
      </div>
      {highest !== null && (
        <div>
          <dt>{t("result.level")}</dt>
          <dd className="emb-tnum">{highest}</dd>
        </div>
      )}
    </dl>
  );
}
