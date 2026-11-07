/**
 * Clinic pages for this slice: Today, Patients, one patient, Settings, More,
 * and honest "coming next" pages for destinations built in the MVP.
 */
import { useMemo, useState, type ComponentType } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useIntl } from "react-intl";
import {
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
import { Alert, Avatar, Button, Card, Chip, DataList, EmptyState, MazeLoader, PageHeader, Segmented, type ChipTone, type Column } from "@emb/ui";
import { useMe, usePatients, useToday } from "../api/queries.ts";
import { findGame, localText } from "../games/registry.ts";
import { fullName, LoadError, StatusChip, useAge } from "./shared.tsx";
import { useT, usePrefs, locales, type Locale, type MessageId, type Motion, type Theme } from "../i18n/index.tsx";
import { useClinic } from "../lib/clinic.tsx";
import { ageParts, calendarDate, dayPart, firstName, matchesQuery } from "../lib/format.ts";
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
  const age = useAge();
  useTitle(t("nav.today"));
  const name = firstName(me.data?.user.name ?? "");
  const mine = (patients.data ?? []).filter((p) => p.status !== "discharged").slice(0, 6);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow={intl.formatDate(new Date(), { weekday: "long", day: "numeric", month: "long" })}
        title={t("today.greeting", { part: dayPart(), name })}
      />
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
          </h2>
          <p className="today-clear">
            <CircleCheck size={20} aria-hidden="true" />
            {t("today.attention.empty")}
          </p>
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
              {mine.map((p) => (
                <li key={p.id} className="today-pitem">
                  <Avatar name={fullName(p)} size={40} />
                  <span className="today-pitem__text">
                    <Link to={`/patients/${p.id}`} className="emb-stretched">
                      <bdi>{fullName(p)}</bdi>
                    </Link>
                    <span className="app-muted">{age(p.date_of_birth)}</span>
                  </span>
                  <StatusChip status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
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
  if (today.data.length === 0) {
    return (
      <EmptyState icon={<CalendarDays size={28} aria-hidden="true" />} title={t("today.nextUp.empty")}>
        {t("today.nextUp.emptyBody")}
      </EmptyState>
    );
  }
  return (
    <ul className="nextup">
      {today.data.map((it) => {
        const gameName = (g: string) => (findGame(g) ? localText(findGame(g)!.manifest.name, locale) : g);
        const games = it.items ? it.items.map((i) => (i.kind === "video" ? `▶ ${i.title}` : gameName(i.game_id))) : [...new Set(it.games)].map(gameName);
        return (
          <li key={it.planned_session_id} className="nextup__item">
            <Avatar name={fullName(it.patient)} size={44} />
            <div className="nextup__text">
              <Link to={`/patients/${it.patient.id}`} className="nextup__name">
                <bdi>{fullName(it.patient)}</bdi>
              </Link>
              <p className="app-muted">
                {age(it.patient.date_of_birth)} · {t("today.session", { week: it.week, seq: it.seq, total: it.total })}
              </p>
              <p className="nextup__games">{games.join(" → ")}</p>
              {it.planned_date < todayIso && (
                <p className="nextup__late">{t("today.planned", { date: intl.formatDate(calendarDate(it.planned_date), { weekday: "long", day: "numeric", month: "short" }) })}</p>
              )}
              {!it.patient.can_play && <Chip tone="warning">{t("patient.pending.title")}</Chip>}
            </div>
            {it.patient.can_play && (
              <Link to={`/session/${it.planned_session_id}`} className="emb-btn emb-btn--primary nextup__start" aria-label={t("run.startFor", { name: fullName(it.patient) })}>
                <Play size={18} aria-hidden="true" />
                <span aria-hidden="true">{t("run.startShort")}</span>
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ Coming next

const soon: Record<string, { title: MessageId; body: MessageId; icon: ComponentType<{ size?: number; "aria-hidden"?: "true" }> }> = {
  calendar: { title: "nav.calendar", body: "soon.calendar", icon: CalendarDays },
  protocols: { title: "nav.protocols", body: "soon.protocols", icon: RouteIcon },
  library: { title: "nav.library", body: "soon.library", icon: BookOpen },
  messages: { title: "nav.messages", body: "soon.messages", icon: MessageSquare },
  reports: { title: "nav.reports", body: "soon.reports", icon: BarChart3 },
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
  useTitle(t("nav.more"));
  const links: Array<{ to: string; label: MessageId; icon: ComponentType<{ size?: number; "aria-hidden"?: "true" }> }> = [
    { to: "/protocols", label: "nav.protocols", icon: RouteIcon },
    { to: "/library", label: "nav.library", icon: BookOpen },
    { to: "/reports", label: "nav.reports", icon: BarChart3 },
    ...(isManager ? [{ to: "/team", label: "nav.team" as MessageId, icon: Users }] : []),
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
  const me = useMe();
  const { locale, setLocale, theme, setTheme, motion, setMotion } = usePrefs();
  const signOut = useSignOut();
  useTitle(t("settings.title"));
  return (
    <div className="app-page app-page--narrow">
      <PageHeader title={t("settings.title")} />
      <div className="settings">
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
        <Card as="section" labelledBy="account">
          <h2 id="account" className="app-cardtitle">
            {t("settings.account")}
          </h2>
          <dl className="app-dl">
            <div>
              <dt>{t("settings.email")}</dt>
              <dd>
                <bdi dir="ltr">{me.data?.user.email}</bdi>
              </dd>
            </div>
            <div>
              <dt>{t("settings.twoFactor")}</dt>
              <dd>
                <Chip tone="success" icon={<CircleCheck size={14} aria-hidden="true" />}>
                  {t("settings.twoFactor.on")}
                </Chip>
              </dd>
            </div>
          </dl>
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
