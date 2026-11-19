/** Parent home — today's session card, child overview (§5.10). */
import { Card, EmptyState, PageHeader } from "@emb/ui";
import { CalendarDays } from "lucide-react";
import { useT } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { useParentContext } from "./shell.tsx";

export function ParentHomePage() {
  const t = useT();
  const { activeChild } = useParentContext();
  useTitle(t("parent.home"));

  if (!activeChild) {
    return (
      <div className="app-page">
        <EmptyState icon={<CalendarDays size={32} aria-hidden="true" />} title={t("parent.noChildren")}>
          {t("parent.noChildrenHint")}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="app-page">
      <PageHeader
        title={t("parent.welcome", { name: activeChild.given_name })}
        description={t("parent.homeIntro")}
      />
      <Card>
        <div className="parent-child-card">
          <h3 className="parent-child-card__name">
            <bdi>{activeChild.given_name} {activeChild.family_name}</bdi>
          </h3>
          <dl className="parent-child-card__details">
            <div className="parent-child-card__detail">
              <dt>{t("parent.clinic")}</dt>
              <dd><bdi>{activeChild.clinic_name}</bdi></dd>
            </div>
            <div className="parent-child-card__detail">
              <dt>{t("parent.status")}</dt>
              <dd>{t("patients.status", { status: activeChild.status })}</dd>
            </div>
          </dl>
        </div>
      </Card>

      {/* Session card — will be populated when sessions are available */}
      <Card>
        <EmptyState icon={<CalendarDays size={32} aria-hidden="true" />} title={t("parent.noSession")}>
          {t("parent.noSessionHint")}
        </EmptyState>
      </Card>
    </div>
  );
}
