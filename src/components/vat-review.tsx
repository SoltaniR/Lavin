import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { saveVatReturn } from "@/app/actions";
import type { Workspace } from "@/lib/model";
import { quarters, quarterlyVat, vatGuidance } from "@/lib/vat";
import { ActionForm } from "./forms";

export async function VatReview({ workspace, quarter, locale }: {
  workspace: Workspace;
  quarter: number;
  locale: string;
}) {
  const t = await getTranslations();
  const { business, documents } = workspace;
  const year = business.profile.year as 2025 | 2026;
  const review = quarterlyVat(workspace, quarter);
  const pdfs = documents.filter(d => d.kind === "pdf");
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
        {!review.invoices.length && <li>{t("vat.noInvoices")}</li>}
        {review.missingSources > 0 && <li>{t("vat.missingInvoices", { count: review.missingSources })}</li>}
        {review.other > 0 && <li>{t("vat.otherEntries", { count: review.other })}</li>}
        {review.unposted > 0 && <li>{t("vat.unposted", { count: review.unposted })}</li>}
      </ul>
      {review.invoices.length > 0 && <details>
        <summary>{t("vat.invoiceList", { count: review.invoices.length })}</summary>
        <ul className="vat-invoices">
          {review.invoices.map(({ entry, vat }) => <li key={entry.id}>
            <span>{entry.entry_date} · {entry.description} · {format(vat)}</span>
            {entry.source_id && <a className="text-link" href={`/api/documents/${entry.source_id}`}>{documentName(entry.source_id)}</a>}
          </li>)}
        </ul>
      </details>}
    </section>
    <section className="panel vat-panel">
      <h2>{t("vat.original")}</h2>
      <p className="help">{t("vat.captureHelp")}</p>
      {review.filed && <p><a className="text-link" href={`/api/documents/${review.filed.source_id}`}>{t("vat.viewOriginal")}</a></p>}
      {pdfs.length === 0 ? <Link href="/?view=documents" className="button secondary">{t("vat.uploadFirst")}</Link> :
        <ActionForm key={`${business.id}:${quarter}`} action={saveVatReturn} label={t("vat.save")}>
          <input type="hidden" name="businessId" value={business.id} />
          <input type="hidden" name="quarter" value={quarter} />
          <div className="form-grid">
            <label className="wide">{t("vat.source")}<select name="sourceId" required defaultValue={review.filed?.source_id ?? ""}>
              <option value="">{t("vat.chooseSource")}</option>
              {pdfs.map(pdf => <option key={pdf.id} value={pdf.id}>{pdf.name}</option>)}
            </select></label>
            <label>{t("vat.output")}<input name="filedOutput" inputMode="text" pattern="-?[0-9]{1,10}" required defaultValue={review.filed?.filed_output} /></label>
            <label>{t("vat.input")}<input name="filedInput" inputMode="text" pattern="-?[0-9]{1,10}" required defaultValue={review.filed?.filed_input} /></label>
            <label className="wide">{t("vat.note")}<textarea name="note" rows={3} maxLength={2000} defaultValue={review.filed?.note ?? ""} /></label>
          </div>
        </ActionForm>}
    </section>
    <p><a className="text-link" href={vatGuidance[year]} target="_blank" rel="noreferrer">{t("vat.official", { year })}</a></p>
  </>;
}
