import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { dismissInvoice, updateInvoiceDetails } from "@/app/actions";
import { invoiceReadVersion, isInvoicePurpose, type InvoiceDraft, type Workspace } from "@/lib/model";
import { isInvoiceOriginal } from "@/lib/vat";
import { ActionForm, EntryForm } from "./forms";
import { RereadInvoicePdfs } from "./document-upload";
import { exchangeCurrencies } from "@/lib/documents/exchange-rates";

export async function InvoiceReview({ workspace, selectedId, page, locale }: {
  workspace: Workspace;
  selectedId?: string;
  page: number;
  locale: string;
}) {
  const t = await getTranslations();
  const { business, documents, invoiceDrafts = [] } = workspace;
  const pending = invoiceDrafts.filter(draft => !draft.posted_entry);
  const missingFields = (draft: InvoiceDraft) => [
    ...(!draft.direction ? ["direction"] : []),
    ...(!draft.fields.date ? ["date"] : !draft.fields.date.startsWith(business.profile.year + "-") ? ["year"] : []),
    ...(draft.fields.foreign && !draft.fields.exchange ? ["exchange"] : !draft.fields.amount ? ["total"] : []),
    ...(draft.fields.invoiceVat === undefined ? ["vat"] : []),
    ...(!draft.fields.reference && !draft.fields.description ? ["reference"] : []),
  ];
  const withGaps = new Map(pending.map(draft => [draft.id, missingFields(draft)]));
  const incomplete = [...withGaps.values()].filter(fields => fields.length).length;
  const selected = pending.find(draft => draft.id === selectedId);
  const source = documents.find(document => document.id === selected?.document_id);
  const suggestion = selected?.fields.dateSuggestion;
  const foreign = selected?.fields.foreign;
  const exchange = selected?.fields.exchange;
  const byId = new Map(documents.map(document => [document.id, document.name]));
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const format = (amount?: string) => amount ? money.format(Number(amount)) : t("imports.missingField");
  const pageSize = 30;
  const currentPage = Math.min(Math.max(1, page), Math.max(1, Math.ceil(pending.length / pageSize)));
  const offset = (currentPage - 1) * pageSize;
  const href = "/?view=review&draftPage=";
  const partial = documents.filter(document =>
    document.status === "invoicePartial" ||
    document.status === "needsOcr" && isInvoicePurpose(document.purpose));
  const postedSources = new Set([
    ...invoiceDrafts.filter(draft => draft.posted_entry).map(draft => draft.document_id),
    ...workspace.entries.map(entry => entry.source_id),
    ...workspace.vatReturns.map(filed => filed.source_id),
  ]);
  const rereadIds = partial.filter(document => document.kind === "pdf" && isInvoicePurpose(document.purpose) &&
    document.invoice_read_version !== invoiceReadVersion && !postedSources.has(document.id)).map(document => document.id);
  return <section className="panel import-review" id="invoice-review">
    <div className="section-heading">
      <h2>{t("imports.invoices")}</h2>
      <Link className="text-link" href="/?view=documents&kind=sale">{t("imports.uploadInvoices")}</Link>
    </div>
    <p className="help">{t("imports.reviewHelp")}</p>
    {invoiceDrafts.length > 0 && <p className="muted">
      {t("imports.invoiceCount", { ready: pending.length - incomplete, incomplete, posted: invoiceDrafts.length - pending.length })}
    </p>}
    <RereadInvoicePdfs businessId={business.id} documentIds={rereadIds} />
    {partial.length > 0 && <details className="notice">
      <summary>{t("imports.partialCount", { count: partial.length })}</summary>
      <ul>{partial.map(document => <li key={document.id}>
        <Link className="text-link" href={"/?view=documents#document-" + document.id}>{document.name}</Link>{" "}
        <span>{document.invoice_issues?.map(issue => t("imports.invoiceIssue." + issue)).join(" · ") ||
          t(document.status === "needsOcr" ? "imports.invoiceIssue.unreadable" : "imports.invoiceIssue.layout")}</span>
      </li>)}</ul>
    </details>}
    {selected && source && <div className="import-draft" id="draft-fields">
      <div>
        <h3>{selected.fields.reference || t("imports.reviewInvoice")}</h3>
        <p><a className="text-link" href={"/api/documents/" + source.id + (selected.fields.page ? "#page=" + selected.fields.page : "")}
          target="_blank" rel="noreferrer">{source.name}</a></p>
        {selected.fields.row && <p className="help">{t("imports.csvRow", { row: selected.fields.row })}</p>}
        {selected.fields.page && <p className="help">{selected.fields.lastPage && selected.fields.lastPage > selected.fields.page
          ? t("imports.pdfPages", { first: selected.fields.page, last: selected.fields.lastPage })
          : t("imports.pdfPage", { page: selected.fields.page })}</p>}
        <p>{t("imports.readVat", { amount: format(selected.fields.invoiceVat) })}</p>
        {!selected.fields.date && suggestion && <ActionForm action={updateInvoiceDetails} label={t("imports.useSuggestedDate")}>
          <input type="hidden" name="businessId" value={business.id} />
          <input type="hidden" name="draftId" value={selected.id} />
          <input type="hidden" name="intent" value="confirmDate" />
          <p className="help">{t("imports.suggestedDate", { label: suggestion.label, date: suggestion.date })}</p>
          {suggestion.supplier && <label className="checkbox">
            <input type="checkbox" name="remember" defaultChecked />
            {t("imports.rememberDate", { supplier: suggestion.supplier.name })}
          </label>}
        </ActionForm>}
        {foreign && <details className="import-duplicate" open={!exchange}>
          <summary>{exchange ? t("imports.exchangeSummary", {
            currency: exchange.currency, amount: foreign.amount ?? "", rate: exchange.unitsPerEuro, date: exchange.date,
          }) : t("imports.exchangeReview")}</summary>
          <ActionForm key={JSON.stringify(exchange)} action={updateInvoiceDetails} label={t("imports.calculateEuros")}>
            <input type="hidden" name="businessId" value={business.id} />
            <input type="hidden" name="draftId" value={selected.id} />
            <input type="hidden" name="intent" value="exchange" />
            <div className="form-grid">
              <label>{t("imports.invoiceCurrency")}<select name="currency" required defaultValue={foreign.currency ?? ""}>
                <option value="">{t("imports.chooseCurrency")}</option>
                {exchangeCurrencies.map(code => <option key={code} value={code}>{code}</option>)}
              </select></label>
              <label>{t("common.date")}<input name="invoiceDate" type="date" min={business.profile.year + "-01-01"}
                max={business.profile.year + "-12-31"} defaultValue={selected.fields.date ?? suggestion?.date} required /></label>
              <label>{t("imports.originalAmount")}
                <input name="originalAmount" inputMode="decimal" defaultValue={foreign.amount} required /></label>
              <label>{t("imports.originalVat")}
                <input name="originalVat" inputMode="decimal" defaultValue={foreign.vat} /></label>
            </div>
            <p className="help">{t("imports.exchangeHelp")}</p>
          </ActionForm>
        </details>}
        {withGaps.get(selected.id)?.map(field => <p className="help" key={field}>{t("imports.gaps." + field)}</p>)}
        <Link className="text-link" href={href + currentPage + "#invoice-review"}>{t("imports.backToDrafts")}</Link>
      </div>
      {(!foreign || exchange) && <EntryForm key={JSON.stringify([selected.id, selected.fields.date, exchange])} businessId={business.id} profile={business.profile} draft={selected}
        documents={source.kind === "csv" ? documents.filter(d => isInvoiceOriginal(d) &&
          !workspace.vatReturns.some(filed => filed.source_id === d.id)).map(({ id, name }) => ({ id, name })) : []} />}
      <ActionForm key={"dismiss:" + selected.id} action={dismissInvoice} label={t("imports.dismiss")} className="quiet-action">
        <input type="hidden" name="businessId" value={business.id} />
        <input type="hidden" name="draftId" value={selected.id} />
      </ActionForm>
    </div>}
    {pending.length === 0 ? <p className="empty-inline">{t("imports.noDrafts")}</p> : <>
      <ul className="import-draft-list">
        {pending.slice(offset, offset + pageSize).map(draft => <li key={draft.id}>
          <div>
            <strong>{draft.fields.reference || byId.get(draft.document_id)}</strong>
            <small>{[draft.fields.date, byId.get(draft.document_id)].filter(Boolean).join(" · ")}</small>
            <small>{withGaps.get(draft.id)?.length
              ? withGaps.get(draft.id)?.map(field => t("imports.gaps." + field)).join(" · ")
              : t(draft.direction === "purchase" ? "imports.purchaseConfirm" : "imports.readyConfirm")}</small>
          </div>
          <span className="numeric">{format(draft.fields.amount)}</span>
          <Link className="button secondary" href={href + currentPage + "&draft=" + draft.id + "#draft-fields"}>
            {t("imports.reviewInvoice")}
          </Link>
        </li>)}
      </ul>
      <div className="import-pagination">
        {currentPage > 1 && <Link className="text-link" href={href + (currentPage - 1) + "#invoice-review"}>{t("flow.back")}</Link>}
        {offset + pageSize < pending.length && <Link className="text-link" href={href + (currentPage + 1) + "#invoice-review"}>{t("imports.moreDrafts")}</Link>}
      </div>
    </>}
  </section>;
}
