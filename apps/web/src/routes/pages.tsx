/**
 * Clinic pages for this slice: Today, Patients, one patient, Settings, More,
 * and honest "coming next" pages for destinations built in the MVP.
 */
import { useMemo, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useIntl } from "react-intl";
import {
  Building2,
  Film,
  Palette,
  ArrowLeft,
  BarChart3,
  BookOpen,
  CalendarDays,
  CircleCheck,
  Compass,
  MessageSquare,
  Route as RouteIcon,
  Search,
  Settings as SettingsIcon,
  SearchX,
  Users,
  X,
  LogOut,
  ChevronRight,
  Play,
} from "lucide-react";
import { Alert, Avatar, Button, Card, Chip, DataList, EmptyState, MazeLoader, PageHeader, Segmented, TextField, type ChipTone, type Column } from "@emb/ui";
import { useQueryClient } from "@tanstack/react-query";
import { meKey, useCaseload, useMe, usePatients, useToday, useReviewCount, useReviewQueue, useReviewFromQueue, type ReviewQueueItem } from "../api/queries.ts";
import { apiSend } from "../api/http.ts";
import { authClient } from "../api/auth.ts";
import { findGame, localText, GAMES } from "../games/registry.ts";
import { fullName, LoadError, StatusChip, useAge } from "./shared.tsx";
import { useT, usePrefs, locales, type Locale, type MessageId, type Motion, type Theme } from "../i18n/index.tsx";
import { useClinic } from "../lib/clinic.tsx";
import { ageParts, calendarDate, dayPart, firstName, matchesQuery } from "../lib/format.ts";
import { collapseRepeats, joinSteps } from "../lib/steps.ts";
import { LookList, TREND_LABEL, progressHref } from "./reports/look.tsx";
import { useOptionalDevice } from "../device/session.tsx";
import { useTitle } from "../lib/title.ts";
import { useSignOut } from "../shell/ClinicShell.tsx";
import { SetPinForm } from "../session/SessionPage.tsx";
import { hasPin } from "../session/kidmode.ts";


// ------------------------------------------------------------------ Today

export function TodayPage() {
  const t = useT();
  const intl = useIntl();
  const me = useMe();
  const { clinicId } = useClinic();
  const patients = usePatients(clinicId);
  const reviewCount = useReviewCount(clinicId);
  const age = useAge();
  useTitle(t("nav.today"));
  // Offline, the greeting uses the therapist as last seen online (offline devices spec §7.5).
  const offlineMe = useOptionalDevice()?.offlineMe;
  const name = firstName(me.data?.user.name ?? offlineMe?.user.name ?? "");
  const caseload = useCaseload(clinicId);
  // Kid-mode PIN: asked for here, at the desk, so the first Start of the day is not interrupted with a child waiting.
  const needsPin = !offlineMe && !hasPin();
  // The patients most worth a look come first (the server's caseload order); the rest follow as listed.
  const rows = useMemo(() => new Map((caseload.data ?? []).map((r, i) => [r.patient_id, { row: r, rank: i }])), [caseload.data]);
  const mine = (patients.data ?? [])
    .filter((p) => p.status !== "discharged")
    .map((p, i) => ({ p, at: rows.get(p.id), i }))
    .sort((x, y) => (x.at?.rank ?? 1e6 + x.i) - (y.at?.rank ?? 1e6 + y.i))
    .slice(0, 8);
  const relative = useMemo(() => new Intl.RelativeTimeFormat(intl.locale, { numeric: "auto" }), [intl.locale]);
  const lastSeen = (s: string) => relative.format(-Math.max(0, Math.floor((Date.now() - Date.parse(s)) / 86_400_000)), "day");
  const look = (caseload.data ?? []).filter((r) => r.reasons.length > 0);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow={intl.formatDate(new Date(), { weekday: "long", day: "numeric", month: "long" })}
        title={t("today.greeting", { part: dayPart(), name })}
      />
      {needsPin && (
        <div className="today-pin">
          <Alert tone="info">
            <p>
              {t("today.pin.body")}{" "}
              <Link to="/settings">{t("today.pin.action")}</Link>
            </p>
          </Alert>
        </div>
      )}
      {reviewCount > 0 && <ReviewQueue clinicId={clinicId} count={reviewCount} />}
      <div className="today-grid">
        <Card as="section" className="today-next" labelledBy="next-up">
          <h2 id="next-up" className="app-cardtitle">
            {t("today.nextUp.title")}
          </h2>
          <NextUp />
        </Card>
        <Card as="section" className="today-attention" labelledBy="attention">
          <h2 id="attention" className="app-cardtitle">
            {t("today.attention.title")}
            {look.length > 0 && <span className="reports__count emb-tnum">{look.length}</span>}
          </h2>
          {caseload.isPending ? (
            <MazeLoader label={t("common.loading")} />
          ) : caseload.isError ? (
            <p className="app-muted">{t("today.attention.unavailable")}</p>
          ) : look.length === 0 ? (
            <p className="today-clear">
              <CircleCheck size={20} aria-hidden="true" />
              {t("today.attention.empty")}
            </p>
          ) : (
            <>
              <LookList patients={look} limit={5} compact />
              {look.length > 5 && (
                <Link to="/reports" className="app-textlink today-more">
                  {t("today.attention.more", { count: look.length - 5 })}
                  <ChevronRight size={18} aria-hidden="true" className="emb-flip-rtl" />
                </Link>
              )}
            </>
          )}
        </Card>
        <Card as="section" className="today-patients" labelledBy="your-patients" padded={false}>
          <div className="app-cardhead">
            <h2 id="your-patients" className="app-cardtitle">
              {t("today.patients.title")}
            </h2>
            <Link to="/patients" className="app-textlink">
              {t("today.patients.all")}
              <ChevronRight size={18} aria-hidden="true" className="emb-flip-rtl" />
            </Link>
          </div>
          {patients.isPending ? (
            <MazeLoader label={t("common.loading")} />
          ) : patients.isError ? (
            <div className="app-cardpad">
              <LoadError error={patients.error} retry={() => void patients.refetch()} />
            </div>
          ) : mine.length === 0 ? (
            <p className="app-cardpad app-muted">{t("today.patients.empty")}</p>
          ) : (
            <ul className="today-plist">
              {mine.map(({ p, at }) => (
                <li key={p.id} className="today-pitem">
                  <Avatar name={fullName(p)} size={40} />
                  <span className="today-pitem__text">
                    <Link to={at ? progressHref(p.id) : `/patients/${p.id}`} className="emb-stretched">
                      <bdi>{fullName(p)}</bdi>
                    </Link>
                    {at ? (
                      // What a therapist decides with: how it is going, whether the plan is followed, when they last played.
                      <span className="app-muted today-pitem__facts emb-tnum">
                        {[
                          at.row.last_session_at ? t(TREND_LABEL[at.row.summary]) : t("reports.reason.inactiveNever"),
                          at.row.week.planned > 0 ? t("today.patients.week", { done: at.row.week.done, planned: at.row.week.planned }) : t("reports.caseload.weekNone"),
                          ...(at.row.last_session_at ? [t("today.patients.last", { when: lastSeen(at.row.last_session_at) })] : []),
                        ].join(" · ")}
                      </span>
                    ) : (
                      <span className="app-muted">{age(p.date_of_birth)}</span>
                    )}
                  </span>
                  {p.status !== "active" && <StatusChip status={p.status} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Cross-patient review queue for flagged sessions and video views (design doc §5.9.1). */
function ReviewQueue({ clinicId, count }: { clinicId: string | null; count: number }) {
  const t = useT();
  const intl = useIntl();
  const { locale } = usePrefs();
  const [expanded, setExpanded] = useState(false);
  const [filterPatient, setFilterPatient] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const queue = useReviewQueue(clinicId, filterPatient);
  const review = useReviewFromQueue(clinicId);
  const gameName = (id: string | null) => {
    if (!id) return "";
    const g = findGame(id);
    return g ? localText(g.manifest.name, locale) : id;
  };
  const date = (s: string) => intl.formatDate(new Date(s), { day: "numeric", month: "short" });

  // Unique patients in the queue for the filter dropdown.
  const patients = useMemo(() => {
    if (!queue.data) return [];
    const seen = new Map<string, { id: string; name: string }>();
    for (const item of queue.data) {
      if (!seen.has(item.patient_id)) seen.set(item.patient_id, { id: item.patient_id, name: `${item.given_name} ${item.family_name}` });
    }
    return [...seen.values()];
  }, [queue.data]);

  const doReview = (item: ReviewQueueItem, decision: "accept" | "exclude") => {
    const note = noteFor === item.id ? noteText.trim() : undefined;
    review.mutate({ id: item.id, kind: item.kind, decision, ...(note ? { note } : {}) });
    if (noteFor === item.id) {
      setNoteFor(null);
      setNoteText("");
    }
  };

  return (
    <Card as="section" className="today-reviewq" labelledBy="review-queue">
      <button
        type="button"
        className="today-reviewq__header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="review-queue-list"
      >
        <Chip tone="warning">{t("today.review", { count })}</Chip>
        <ChevronRight size={18} aria-hidden="true" className={`emb-flip-rtl today-reviewq__chevron${expanded ? " today-reviewq__chevron--open" : ""}`} />
      </button>
      {expanded && (
        <div id="review-queue-list">
          {patients.length > 1 && (
            <div className="reviewq-filter">
              <select
                value={filterPatient ?? ""}
                onChange={(e) => setFilterPatient(e.target.value || null)}
                className="reviewq-filter__select"
                aria-label={t("review.filterPatient")}
              >
                <option value="">{t("review.allPatients")}</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {queue.isPending ? (
            <MazeLoader label={t("common.loading")} />
          ) : queue.isError ? (
            <LoadError error={queue.error} retry={() => void queue.refetch()} />
          ) : queue.data.length === 0 ? (
            <p className="app-muted">{t("today.attention.empty")}</p>
          ) : (
            <ul className="reviewq-list">
              {queue.data.map((item) => (
                <li key={item.id} className="reviewq-item">
                  <Link to={`/patients/${item.patient_id}`} className="reviewq-item__info">
                    <Avatar name={`${item.given_name} ${item.family_name}`} size={36} />
                    <span className="reviewq-item__text">
                      <bdi className="reviewq-item__name">{item.given_name} {item.family_name}</bdi>
                      <span className="app-muted">
                        {item.kind === "video" ? t("review.videoView") : gameName(item.game_id)}
                        {" · "}
                        <span className="emb-tnum">{date(item.ended_at)}</span>
                      </span>
                    </span>
                  </Link>
                  <Chip tone="warning">{t("review.reason", { reason: item.review_reason })}</Chip>
                  <span className="reviewq-item__actions">
                    <Button
                      variant="ghost"
                      size="md"
                      onClick={() => {
                        setNoteFor(noteFor === item.id ? null : item.id);
                        setNoteText("");
                      }}
                      aria-label={t("review.addNote")}
                    >
                      {t("review.note")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      loading={review.isPending && review.variables?.id === item.id && review.variables?.decision === "accept"}
                      onClick={() => doReview(item, "accept")}
                    >
                      {t("review.accept")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="md"
                      loading={review.isPending && review.variables?.id === item.id && review.variables?.decision === "exclude"}
                      onClick={() => doReview(item, "exclude")}
                    >
                      {t("review.exclude")}
                    </Button>
                  </span>
                  {noteFor === item.id && (
                    <div className="reviewq-item__note">
                      <input
                        type="text"
                        className="emb-input reviewq-item__note-input"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder={t("review.notePlaceholder")}
                        aria-label={t("review.addNote")}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

/** Today's sessions (and any missed in the last week), one per patient (design doc §4.1, journey T1). */
function NextUp() {
  const t = useT();
  const intl = useIntl();
  const { locale } = usePrefs();
  const { clinicId } = useClinic();
  const today = useToday(clinicId);
  const age = useAge();
  const todayIso = new Date().toLocaleDateString("en-CA");
  if (today.isPending) return <MazeLoader label={t("common.loading")} />;
  if (today.isError) return <LoadError error={today.error} retry={() => void today.refetch()} />;
  const sessions = today.data.items;
  const appointments = today.data.appointments;
  if (sessions.length === 0 && appointments.length === 0) {
    return (
      <EmptyState icon={<CalendarDays size={28} aria-hidden="true" />} title={t("today.nextUp.empty")}>
        {t("today.nextUp.emptyBody")}
      </EmptyState>
    );
  }
  // One list in the order of the day: sessions left over from earlier days first, then by time of day, with anything
  // that has no time after the timed ones.
  const hhmm = (s: string | null | undefined) => (s ? s.slice(0, 5) : null);
  const clock = (s: string | null | undefined) => {
    const v = hhmm(s);
    if (!v) return null;
    const [h, m] = v.split(":").map(Number) as [number, number];
    return intl.formatTime(new Date(2000, 0, 1, h, m), { hour: "numeric", minute: "2-digit" });
  };
  type Entry = { key: string; overdue: boolean; time: string | null; node: ReactNode };
  const gameName = (g: string) => (findGame(g) ? localText(findGame(g)!.manifest.name, locale) : g);
  const entries: Entry[] = [
    ...sessions.map((it): Entry => {
      const games = it.items ? it.items.map((i) => (i.kind === "video" ? `▶ ${i.title}` : gameName(i.game_id))) : [...new Set(it.games)].map(gameName);
      const overdue = it.planned_date < todayIso;
      const time = overdue ? null : hhmm(it.planned_time);
      return {
        key: it.planned_session_id,
        overdue,
        time,
        node: (
          <li key={it.planned_session_id} className="nextup__item">
            <Avatar name={fullName(it.patient)} size={44} />
            <div className="nextup__text">
              <Link to={`/patients/${it.patient.id}`} className="nextup__name">
                <bdi>{fullName(it.patient)}</bdi>
              </Link>
              <p className="app-muted">
                {time && <strong className="nextup__time emb-tnum">{clock(time)}</strong>}
                {age(it.patient.date_of_birth)} · {t("today.session", { week: it.week, seq: it.seq, total: it.total })}
              </p>
              <p className="nextup__games">{joinSteps(collapseRepeats(games), locale)}</p>
              {overdue && <p className="nextup__late">{t("today.planned", { date: intl.formatDate(calendarDate(it.planned_date), { weekday: "long", day: "numeric", month: "short" }) })}</p>}
              {!it.patient.can_play && <Chip tone="warning">{t("patient.pending.title")}</Chip>}
            </div>
            {it.patient.can_play && (
              <Link to={`/session/${it.planned_session_id}`} className="emb-btn emb-btn--primary nextup__start" aria-label={t("run.startFor", { name: fullName(it.patient) })}>
                <Play size={18} aria-hidden="true" />
                <span aria-hidden="true">{t("run.startShort")}</span>
              </Link>
            )}
          </li>
        ),
      };
    }),
    ...appointments.map((appt): Entry => {
      const name = `${appt.patient_given_name} ${appt.patient_family_name}`;
      const start = hhmm(appt.start_time);
      const end = hhmm(appt.end_time);
      return {
        key: appt.id,
        overdue: false,
        time: start,
        node: (
          <li key={appt.id} className="nextup__item">
            <Avatar name={name} size={44} />
            <div className="nextup__text">
              <Link to={`/patients/${appt.patient_id}`} className="nextup__name">
                <bdi>{name}</bdi>
              </Link>
              <p className="app-muted">
                {start && (
                  <strong className="nextup__time emb-tnum" dir="ltr">
                    {clock(start)}
                    {end ? ` – ${clock(end)}` : ""}
                  </strong>
                )}
                {appt.title}
              </p>
              {appt.notes && <p className="nextup__games">{appt.notes}</p>}
            </div>
            <Link to="/calendar" className="emb-btn emb-btn--secondary nextup__start" aria-label={t("today.viewCalendar")}>
              <CalendarDays size={18} aria-hidden="true" />
            </Link>
          </li>
        ),
      };
    }),
  ].sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));

  return <ul className="nextup">{entries.map((e) => e.node)}</ul>;
}

// ------------------------------------------------------------------ Coming next

const soon: Record<string, { title: MessageId; body: MessageId; icon: ComponentType<{ size?: number; "aria-hidden"?: "true" }> }> = {
  calendar: { title: "nav.calendar", body: "soon.calendar", icon: CalendarDays },
  protocols: { title: "nav.protocols", body: "soon.protocols", icon: RouteIcon },
  library: { title: "nav.library", body: "soon.library", icon: BookOpen },
  messages: { title: "nav.messages", body: "soon.messages", icon: MessageSquare },
};

export function ComingSoonPage({ area }: { area: keyof typeof soon }) {
  const t = useT();
  const s = soon[area]!;
  useTitle(t(s.title));
  return (
    <div className="app-page">
      <PageHeader title={t(s.title)} />
      <Card>
        <EmptyState icon={<s.icon size={28} aria-hidden="true" />} title={t("soon.title")}>
          {t(s.body)}
        </EmptyState>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ More (phones)

export function MorePage() {
  const t = useT();
  const signOut = useSignOut();
  const { isManager } = useClinic();
  const me = useMe();
  useTitle(t("nav.more"));
  const links: Array<{ to: string; label: MessageId; icon: ComponentType<{ size?: number; "aria-hidden"?: "true" }> }> = [
    { to: "/protocols", label: "nav.protocols", icon: RouteIcon },
    { to: "/library", label: "nav.library", icon: BookOpen },
    { to: "/reports", label: "nav.reports", icon: BarChart3 },
    ...(isManager ? [{ to: "/team", label: "nav.team" as MessageId, icon: Users }] : []),
    // Platform admin areas aren't in the phone's tab bar, so they are listed here.
    ...(me.data?.is_platform_admin
      ? [
          { to: "/admin/organizations", label: "admin.nav.organizations" as MessageId, icon: Building2 },
          { to: "/admin/videos", label: "nav.videos" as MessageId, icon: Film },
          { to: "/admin/appearance", label: "admin.nav.appearance" as MessageId, icon: Palette },
        ]
      : []),
    { to: "/settings", label: "nav.settings", icon: SettingsIcon },
  ];
  return (
    <div className="app-page">
      <PageHeader title={t("nav.more")} />
      <Card padded={false}>
        <ul className="more-list">
          {links.map((l) => (
            <li key={l.to}>
              <Link to={l.to} className="more-item">
                <l.icon size={22} aria-hidden="true" />
                <span>{t(l.label)}</span>
                <ChevronRight size={20} aria-hidden="true" className="emb-flip-rtl more-item__chev" />
              </Link>
            </li>
          ))}
          <li>
            <button type="button" className="more-item" onClick={() => void signOut("signed_out")}>
              <LogOut size={22} aria-hidden="true" className="emb-flip-rtl" />
              <span>{t("common.signOut")}</span>
            </button>
          </li>
        </ul>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Settings

export function SettingsPage() {
  const t = useT();
  const { locale, setLocale, theme, setTheme, motion, setMotion } = usePrefs();
  const signOut = useSignOut();
  useTitle(t("settings.title"));
  return (
    <div className="app-page app-page--narrow">
      <PageHeader title={t("settings.title")} />
      <div className="settings">
        <ProfileCard />
        <Card as="section" labelledBy="prefs">
          <h2 id="prefs" className="app-cardtitle">
            {t("settings.preferences")}
          </h2>
          <div className="settings__group">
            <Segmented<Locale>
              legend={t("language.label")}
              name="language"
              value={locale}
              onChange={setLocale}
              options={locales.map((l) => ({ value: l, label: <span lang={l}>{t(`language.${l}`)}</span> }))}
            />
            <Segmented<Theme>
              legend={t("settings.theme")}
              name="theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: "light", label: t("settings.theme.light") },
                { value: "dark", label: t("settings.theme.dark") },
                { value: "system", label: t("settings.theme.system") },
              ]}
            />
            <Segmented<Motion>
              legend={t("settings.motion")}
              name="motion"
              value={motion}
              onChange={setMotion}
              options={[
                { value: "system", label: t("settings.motion.system") },
                { value: "reduce", label: t("settings.motion.reduce") },
              ]}
            />
          </div>
        </Card>
        <KidPinCard />
        <Card as="section" labelledBy="device-link">
          <h2 id="device-link" className="app-cardtitle">
            {t("device.title")}
          </h2>
          <Link to="/settings/device" className="emb-btn emb-btn--secondary">
            {t("device.settingsLink")}
          </Link>
        </Card>
        <Card as="section" labelledBy="music-link">
          <h2 id="music-link" className="app-cardtitle">
            {t("music.title")}
          </h2>
          <Link to="/settings/music" className="emb-btn emb-btn--secondary">
            {t("music.settingsLink")}
          </Link>
        </Card>
        <SecurityCard />
        <Card as="section" labelledBy="account">
          <h2 id="account" className="app-cardtitle">
            {t("settings.account")}
          </h2>
          <div className="settings__actions">
            <Button variant="secondary" icon={<LogOut size={18} aria-hidden="true" className="emb-flip-rtl" />} onClick={() => void signOut("signed_out")}>
              {t("common.signOut")}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Profile editing: display name (§5.14). */
function ProfileCard() {
  const t = useT();
  const me = useMe();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<MessageId | null>(null);

  const startEdit = () => {
    setName(me.data?.user.name ?? "");
    setEditing(true);
    setSaved(false);
    setError(null);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend("PATCH", "/v1/me/profile", { name: trimmed });
      await qc.invalidateQueries({ queryKey: meKey });
      setEditing(false);
      setSaved(true);
    } catch {
      setError("errors.generic");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="section" labelledBy="profile">
      <h2 id="profile" className="app-cardtitle">
        {t("settings.profile")}
      </h2>
      {saved && <Alert tone="success">{t("settings.profile.saved")}</Alert>}
      {error && <Alert tone="danger">{t(error)}</Alert>}
      {editing ? (
        <form className="settings__edit" onSubmit={(e) => void save(e)} noValidate>
          <TextField
            label={t("settings.profile.name")}
            name="display-name"
            autoComplete="name"
            maxLength={255}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="settings__actions">
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={busy} disabled={!name.trim()}>
              {t("settings.profile.save")}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <dl className="app-dl">
            <div>
              <dt>{t("settings.profile.name")}</dt>
              <dd><bdi>{me.data?.user.name}</bdi></dd>
            </div>
            <div>
              <dt>{t("settings.email")}</dt>
              <dd><bdi dir="ltr">{me.data?.user.email}</bdi></dd>
            </div>
          </dl>
          <div className="settings__actions">
            <Button variant="secondary" onClick={startEdit}>
              {t("settings.profile.edit")}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/** Security: password change and 2FA status (§5.14). */
function SecurityCard() {
  const t = useT();
  const [changingPw, setChangingPw] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageId | null>(null);
  const [fieldError, setFieldError] = useState<"tooShort" | "mismatch" | null>(null);
  const [pwSaved, setPwSaved] = useState(false);

  const submitPw = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 12) { setFieldError("tooShort"); return; }
    if (next !== confirm) { setFieldError("mismatch"); return; }
    setFieldError(null);
    setBusy(true);
    const { error: err } = await authClient
      .changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: false })
      .catch(() => ({ error: { status: 0 } }));
    setBusy(false);
    if (err) { setError("settings.security.pwInvalid"); return; }
    setChangingPw(false);
    setCurrent("");
    setNext("");
    setConfirm("");
    setPwSaved(true);
  };

  return (
    <Card as="section" labelledBy="security">
      <h2 id="security" className="app-cardtitle">
        {t("settings.security")}
      </h2>
      {pwSaved && <Alert tone="success">{t("settings.security.pwSaved")}</Alert>}
      {error && <Alert tone="danger">{t(error)}</Alert>}
      <dl className="app-dl">
        <div>
          <dt>{t("settings.twoFactor")}</dt>
          <dd>
            <Chip tone="success" icon={<CircleCheck size={14} aria-hidden="true" />}>
              {t("settings.twoFactor.on")}
            </Chip>
          </dd>
        </div>
      </dl>
      {changingPw ? (
        <form className="settings__edit" onSubmit={(e) => void submitPw(e)} noValidate>
          <TextField
            label={t("settings.security.currentPw")}
            type="password"
            name="current-password"
            autoComplete="current-password"
            dir="ltr"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <TextField
            label={t("settings.security.newPw")}
            hint={fieldError === "tooShort" ? undefined : t("auth.changePassword.tooShort")}
            error={fieldError === "tooShort" ? t("auth.changePassword.tooShort") : undefined}
            type="password"
            name="new-password"
            autoComplete="new-password"
            dir="ltr"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <TextField
            label={t("settings.security.confirmPw")}
            error={fieldError === "mismatch" ? t("auth.changePassword.mismatch") : undefined}
            type="password"
            name="confirm-password"
            autoComplete="new-password"
            dir="ltr"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <div className="settings__actions">
            <Button variant="secondary" onClick={() => { setChangingPw(false); setError(null); setFieldError(null); }}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={busy} disabled={!current || !next || !confirm}>
              {t("settings.security.changePw")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="settings__actions">
          <Button variant="secondary" onClick={() => { setChangingPw(true); setPwSaved(false); setError(null); }}>
            {t("settings.security.changePw")}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Kid-mode PIN for this device (design doc §4.3). */
function KidPinCard() {
  const t = useT();
  const [set, setSet] = useState(hasPin);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <Card as="section" labelledBy="kidpin">
      <h2 id="kidpin" className="app-cardtitle">
        {t("kidpin.title")}
      </h2>
      <p className="app-muted">{t("kidpin.body")}</p>
      {saved && <Alert tone="success">{t("kidpin.saved")}</Alert>}
      {editing || !set ? (
        <SetPinForm
          onSaved={() => {
            setSet(true);
            setEditing(false);
            setSaved(true);
          }}
        />
      ) : (
        <div className="settings__actions">
          <Button variant="secondary" onClick={() => (setSaved(false), setEditing(true))}>
            {t("kidpin.change")}
          </Button>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ 404

export function NotFoundPage() {
  const t = useT();
  useTitle(t("notFound.title"));
  return (
    <div className="app-page">
      <h1 className="emb-vh">{t("notFound.title")}</h1>
      <Card>
        <EmptyState
          icon={<Compass size={28} aria-hidden="true" />}
          title={t("notFound.title")}
          action={
            <Link to="/today" className="emb-btn emb-btn--primary">
              {t("notFound.action")}
            </Link>
          }
        >
          {t("notFound.body")}
        </EmptyState>
      </Card>
    </div>
  );
}
