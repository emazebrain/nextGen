/** Parent portal: a progress report the clinic shared, to read, print or save as PDF (migration 0042). */
import { useParams } from "react-router";
import { MazeLoader } from "@emb/ui";
import { useParentReport } from "../../api/progress-reports.ts";
import { useT } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { LoadError } from "../shared.tsx";
import { ReportToolbar } from "../patients/reports.tsx";
import { ReportDocument } from "../reports/ReportDocument.tsx";

export function ParentReportPage() {
  const t = useT();
  const { rid = "" } = useParams<{ rid: string }>();
  const report = useParentReport(rid);
  useTitle(t("pr.title"));
  if (report.isPending) return <MazeLoader label={t("common.loading")} />;
  if (report.isError) {
    return (
      <div className="app-page">
        <LoadError error={report.error} retry={() => void report.refetch()} />
      </div>
    );
  }
  return (
    <div className="app-page rdoc-page">
      <ReportToolbar back="/parent/results" backLabel={t("pr.ui.backParent")} />
      <ReportDocument report={report.data} />
    </div>
  );
}
