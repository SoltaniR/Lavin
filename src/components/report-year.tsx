import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { changeReportYear } from "@/app/actions";
import { reportingYears, type Workspace } from "@/lib/model";
import { yearConflicts } from "@/lib/report-intake";
import { ActionForm } from "./forms";

export async function ReportYear({ workspace, preview }: { workspace: Workspace; preview: boolean }) {
  const t = await getTranslations();
  const { business, documents, invoiceDrafts = [] } = workspace;
  const year = business.profile.year;
  const target = reportingYears.find(y => y !== year);
  if (!target) return null;
  const conflicts = yearConflicts(workspace, target);
  const blocked = conflicts.posted || conflicts.bank || conflicts.vat;
  const dated = invoiceDrafts.filter(draft => draft.fields.date?.startsWith(target + "-"));
  const undated = invoiceDrafts.filter(draft => !draft.fields.date);
  const outside = invoiceDrafts.filter(draft => draft.fields.date && !draft.fields.date.startsWith(target + "-"));
  const sourceNames = new Map(documents.map(d => [d.id, d.name]));
  const mismatchedVat = documents.filter(d => d.purpose === "vat" && d.vat_suggestion?.year && d.vat_suggestion.year !== target);
  return <section className="panel report-year" id="report-year">
    <h2>{t("intake.yearTitle", { year })}</h2>
    {preview ? <>
      <h3>{t("intake.yearPreview", { target })}</h3>
      <p className="help">{t("intake.yearPreviewHelp", { count: documents.length })}</p>
      <ul className="year-preview-list">
        <li>{t("intake.yearDated", { count: dated.length, target })}</li>
        <li>{t("intake.yearUndated", { count: undated.length })}</li>
        <li>{t("intake.yearOutside", { count: outside.length, target })}</li>
      </ul>
      {(outside.length > 0 || mismatchedVat.length > 0) && <details className="notice">
        <summary>{t("intake.yearCheckSources")}</summary>
        <ul>{outside.map(draft => <li key={draft.id}>
          <a className="text-link" href={`/api/documents/${draft.document_id}${draft.fields.page ? "#page=" + draft.fields.page : ""}`}
            target="_blank" rel="noreferrer">{sourceNames.get(draft.document_id)}</a> · {draft.fields.date}
        </li>)}{mismatchedVat.map(d => <li key={d.id}>
          <a className="text-link" href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer">{d.name}</a> · {d.vat_suggestion?.year}
        </li>)}</ul>
      </details>}
      {Boolean(blocked) ? <div className="notice">
        <p>{t("intake.yearBlocked")}</p>
        <ul>{(["posted", "bank", "vat"] as const).map(kind => conflicts[kind] > 0 &&
          <li key={kind}>{t("intake.yearBlock." + kind, { count: conflicts[kind] })}</li>)}</ul>
        <Link className="text-link" href="/?view=setup">{t("app.new")}</Link>
      </div> : <ActionForm action={changeReportYear} label={t("intake.yearConfirm", { target })} successHref="/?view=documents">
        <input type="hidden" name="businessId" value={business.id} />
        <input type="hidden" name="previousYear" value={year} />
        <input type="hidden" name="targetYear" value={target} />
        <label className="checkbox"><input name="confirmYear" type="checkbox" required />{t("intake.yearConfirmHelp", { target })}</label>
      </ActionForm>}
    </> : <p className="help">{t("intake.yearHelp")}</p>}
    <Link className="text-link" href={preview ? "/?view=business#report-year" : "/?view=business&changeYear=1#report-year"}>
      {t(preview ? "intake.yearCancel" : "intake.yearChange", { target })}
    </Link>
  </section>;
}
