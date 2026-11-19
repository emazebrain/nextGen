/** Parent messages — placeholder until messaging (§5.11) is built. */
import { Card, EmptyState, PageHeader } from "@emb/ui";
import { MessageSquare } from "lucide-react";
import { useT } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";

export function ParentMessagesPage() {
  const t = useT();
  useTitle(t("parent.messages"));

  return (
    <div className="app-page">
      <PageHeader title={t("parent.messages")} />
      <Card>
        <EmptyState icon={<MessageSquare size={32} aria-hidden="true" />} title={t("parent.noMessages")}>
          {t("parent.noMessagesHint")}
        </EmptyState>
      </Card>
    </div>
  );
}
