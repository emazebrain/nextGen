/** Create a clinic under an organization, or edit one (system admin spec). */
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Alert, Button, Card, MazeLoader, PageHeader, SelectField, TextField } from "@emb/ui";
import { createClinic, patchClinic, useAdminClinic, useAdminMutation, useAdminOrg, type AdminClinic, type AdminOrg, type Region } from "../../api/admin.ts";
import { ApiError } from "../../api/http.ts";
import { usePrefs, useT, type MessageId } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { LoadError } from "../shared.tsx";
import { BackLink, saveError, useCountryName } from "./common.tsx";

/** ISO 3166-1 alpha-2 codes; names come from the browser in the reader's language. */
const COUNTRIES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );

/** What a new clinic most likely needs, by the organization's region. An empty value means "the admin picks". */
const REGION_DEFAULTS: Record<Region, { country: string; timezone: string; zones: (tz: string) => boolean }> = {
  il: { country: "IL", timezone: "Asia/Jerusalem", zones: (tz) => tz === "Asia/Jerusalem" },
  us: { country: "US", timezone: "", zones: (tz) => tz.startsWith("America/") || tz === "Pacific/Honolulu" },
  eu: { country: "", timezone: "", zones: (tz) => tz.startsWith("Europe/") },
};

function allTimeZones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
  return supported?.length ? supported : ["Asia/Jerusalem", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Europe/Paris", "UTC"];
}

export function ClinicFormPage() {
  const t = useT();
  const { id, orgId } = useParams();
  const clinic = useAdminClinic(id ?? "");
  const org = useAdminOrg(orgId ?? clinic.data?.organization_id ?? "");
  if ((id && clinic.isPending) || org.isPending) return <MazeLoader label={t("common.loading")} />;
  if (id && clinic.isError) return <LoadError error={clinic.error} retry={() => void clinic.refetch()} />;
  if (org.isError) return <LoadError error={org.error} retry={() => void org.refetch()} />;
  return <ClinicForm org={org.data.organization} {...(id && clinic.data ? { existing: clinic.data } : {})} />;
}

function ClinicForm({ org, existing }: { org: AdminOrg; existing?: AdminClinic }) {
  const t = useT();
  const navigate = useNavigate();
  const { locale } = usePrefs();
  const countryName = useCountryName();
  const defaults = REGION_DEFAULTS[org.region] ?? REGION_DEFAULTS.eu;
  const [name, setName] = useState(existing?.name ?? "");
  const [country, setCountry] = useState(existing?.country_code ?? defaults.country);
  const [timezone, setTimezone] = useState(existing?.timezone ?? defaults.timezone);
  const [address, setAddress] = useState(existing?.address ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [license, setLicense] = useState(existing?.license_no ?? "");
  const [errors, setErrors] = useState<Partial<Record<"name" | "country" | "timezone", MessageId>>>({});
  const [error, setError] = useState<MessageId | null>(null);
  const save = useAdminMutation(() =>
    existing ? patchClinic(existing.id, { name: name.trim(), timezone, address, phone, license_no: license }) : createClinic(org.id, { name: name.trim(), country_code: country, timezone }),
  );
  const title = existing ? t("admin.clinics.edit") : t("admin.clinics.new");
  useTitle(title);
  const backTo = existing ? `/admin/clinics/${existing.id}` : `/admin/organizations/${org.id}`;

  const countries = useMemo(() => {
    const collator = new Intl.Collator(locale);
    return COUNTRIES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => collator.compare(a.name, b.name));
  }, [locale]);
  const zones = useMemo(() => {
    const all = allTimeZones();
    // A clinic's saved zone is always offered, even if this browser doesn't list it.
    if (existing && !all.includes(existing.timezone)) all.push(existing.timezone);
    return { suggested: all.filter(defaults.zones), rest: all.filter((tz) => !defaults.zones(tz)) };
  }, [defaults, existing]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const found: typeof errors = {};
    if (!name.trim()) found.name = "errors.required";
    if (!country) found.country = "errors.required";
    if (!timezone) found.timezone = "errors.required";
    setErrors(found);
    if (Object.keys(found).length) {
      setError("errors.fieldsInvalid");
      return;
    }
    try {
      const saved = await save.mutateAsync(undefined);
      navigate(`/admin/clinics/${saved.id}`, { state: { flash: { tone: "success", text: t(existing ? "admin.clinics.saved" : "admin.clinics.created") } } });
    } catch (err) {
      if (err instanceof ApiError && err.code === "name_taken") setErrors({ name: "admin.clinics.nameTaken" });
      else setError(saveError(err));
    }
  };

  const fieldError = (id: "country" | "timezone") =>
    errors[id] ? (
      <p className="emb-field__error" id={`clinic-${id}-error`}>
        {t(errors[id]!)}
      </p>
    ) : null;

  return (
    <div className="app-page app-page--narrow">
      <BackLink to={backTo}>
        <bdi>{existing ? existing.name : org.name}</bdi>
      </BackLink>
      <PageHeader title={title} description={existing ? undefined : org.name} />
      <Card>
        <form className="pform" onSubmit={(e) => void submit(e)} noValidate>
          {error && <Alert tone="danger">{t(error)}</Alert>}
          <TextField
            label={t("admin.clinics.name")}
            name="name"
            autoComplete="off"
            maxLength={255}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setErrors(({ name: _gone, ...rest }) => rest);
            }}
            error={errors.name ? t(errors.name) : undefined}
          />
          <div className="pform__row">
            <div>
              <SelectField
                label={t("admin.clinics.country")}
                name="country_code"
                value={country}
                disabled={!!existing}
                aria-invalid={errors.country ? true : undefined}
                aria-describedby={errors.country ? "clinic-country-error" : existing ? "clinic-country-hint" : undefined}
                onChange={(e) => {
                  setCountry(e.target.value);
                  setErrors(({ country: _gone, ...rest }) => rest);
                }}
              >
                <option value="">{t("admin.clinics.countryChoose")}</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </SelectField>
              {fieldError("country")}
              {existing && (
                <p className="app-check__hint" id="clinic-country-hint">
                  {t("admin.clinics.countryLocked")}
                </p>
              )}
            </div>
            <div>
              <SelectField
                label={t("admin.clinics.timezone")}
                name="timezone"
                value={timezone}
                aria-invalid={errors.timezone ? true : undefined}
                aria-describedby={errors.timezone ? "clinic-timezone-error" : undefined}
                onChange={(e) => {
                  setTimezone(e.target.value);
                  setErrors(({ timezone: _gone, ...rest }) => rest);
                }}
              >
                <option value="">{t("admin.clinics.timezoneChoose")}</option>
                <optgroup label={t("admin.clinics.timezoneSuggested")}>
                  {zones.suggested.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replaceAll("_", " ")}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("admin.clinics.timezoneAll")}>
                  {zones.rest.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replaceAll("_", " ")}
                    </option>
                  ))}
                </optgroup>
              </SelectField>
              {fieldError("timezone")}
            </div>
          </div>
          {existing && (
            <>
              <p className="pform__hint">{t("admin.clinics.letterheadHint")}</p>
              <TextField label={t("admin.clinics.address")} name="address" autoComplete="off" maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} />
              <div className="pform__row">
                <TextField label={t("admin.clinics.phone")} name="phone" type="tel" dir="ltr" autoComplete="off" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
                <TextField label={t("admin.clinics.license")} name="license_no" dir="ltr" autoComplete="off" maxLength={60} value={license} onChange={(e) => setLicense(e.target.value)} />
              </div>
            </>
          )}
          <div className="pform__actions">
            <Link to={backTo} className="emb-btn emb-btn--secondary">
              {t("common.cancel")}
            </Link>
            <Button type="submit" loading={save.isPending}>
              {existing ? t("admin.clinics.save") : t("admin.clinics.create")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
