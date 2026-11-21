import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Workspace } from "@/lib/model";
import { quarters, quarterlyVat, vatGuidance } from "@/lib/vat";
import { vatFigures } from "@/lib/documents/vat-pdf";
import { VatReturnForm } from "./vat-return-form";

export async function VatReview({ workspace, quarter, locale, selectedSource }: {
  workspace: Workspace;
  quarter: number;
  locale: string;
  selectedSource?: string;
}) {
  const t = await getTranslations();
  const { business, documents } = workspace;
  const year = business.profile.year as 2025 | 2026;
  const review = quarterlyVat(workspace, quarter);
  const pdfs = documents.filter(d => d.kind === "pdf" && (!d.purpose || d.purpose === "vat" || d.purpose === "evidence" || d.id === review.filed?.source_id))
    .map(d => ({
      id: d.id, name: d.name, suggestion: d.vat_suggestion ?? vatFigures(d.text_content),
      usedIn: workspace.vatReturns.find(filed => filed.source_id === d.id && filed.quarter !== quarter)?.quarter,
    }));
  const money = new Intl.NumberFormat(locale === "nl" ? "nl-NL" : "en-GB", { style: "currency", currency: "EUR" });
  const format = (amount?: string | null) => amount == null ? "—" : money.format(Number(amount));
  const documentName = (id: string) => documents.find(d => d.id === id)?.name;
  return <>
    <header className="page-heading">
      <h1>{t("vat.title")}</h1>
      <p>{t("vat.subtitle")}</p>
    </header>
    <div className="vat-periods" role="group" aria-label={t("vat.periods")}>
      {quarters.map(q => <Link key={q} href={`/?view=vat&quarter=${q}`} aria-current={q === quarter ? "page" : undefined}
        className={`button ${q === quarter ? "primary" : "secondary"}`}>{t("vat.period", { quarter: q, year })}</Link>)}
    </div>
    <section className="panel vat-panel">
      <div className="section-heading">
        <h2>{t("vat.comparison")}</h2>
        <span className="badge">{t(`vat.status.${review.status}`)}</span>
      </div>
      <div className="table-scroll"><table>
        <thead><tr><th>{t("common.description")}</th><th className="numeric">{t("vat.journal")}</th>
          <th className="numeric">{t("vat.filed")}</th><th className="numeric">{t("vat.difference")}</th></tr></thead>
        <tbody>{review.rows.map(row => <tr key={row.key}>
          <th scope="row">{t(`vat.${row.key}`)}</th><td className="numeric">{format(row.booked)}</td>
          <td className="numeric">{format(row.filed)}</td><td className="numeric">{format(row.difference)}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="help">{t("vat.rounding")}</p>
      {!review.eligible && <p className="notice">{t("vat.scopeHelp")} <Link className="guide-link" href="/?view=business">{t("nav.business")}</Link></p>}
      <ul className="vat-issues">
        {review.duplicateSource && <li>{t("errors.vatSourcePeriod")}</li>}
        {!review.filed && <li>{t("imports.missingQuarterHelp")}</li>}
        {!review.invoices.length && <li>{t("vat.noInvoices")}</li>}
        {review.missingSources > 0 && <li>{t("vat.missingInvoices", { count: review.missingSources })}</li>}
        {review.other > 0 && <li>{t("vat.otherEntries", { count: review.other })}</li>}
        {review.unposted > 0 && <li>{t("vat.unposted", { count: review.unposted })}</li>}
      </ul>
      {review.invoices.length > 0 && <details>
        <summary>{t("vat.invoiceList", { count: review.invoices.length })}</summary>
        <ul className="vat-invoices">
          {review.invoices.map(({ entry, vat, hasInvoiceSource }) => <li key={entry.id}>
            <span>{entry.entry_date} · {entry.description} · {format(vat)}</span>
            {hasInvoiceSource && entry.source_id
              ? <a className="text-link" href={`/api/documents/${entry.source_id}`}>{documentName(entry.source_id)}</a>
              : <span className="muted"> · {t("vat.missingInvoice")}</span>}
          </li>)}
        </ul>
      </details>}
    </section>
    <section className="panel vat-panel">
      <h2>{t("vat.original")}</h2>
      <p className="help">{t("vat.captureHelp")}</p>
      {review.filed && <p><a className="text-link" href={`/api/documents/${review.filed.source_id}`}>{t("vat.viewOriginal")}</a></p>}
      {pdfs.length === 0 ? <Link href="/?view=documents" className="button secondary">{t("vat.uploadFirst")}</Link> :
        <VatReturnForm key={JSON.stringify([business.id, quarter, review.filed, selectedSource])}
          businessId={business.id} quarter={quarter} year={year} filed={review.filed}
          sources={pdfs} selectedSource={selectedSource} />}
    </section>
    <p><a className="text-link" href={vatGuidance[year]} target="_blank" rel="noreferrer">{t("vat.official", { year })}</a></p>
  </>;
}
