import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { dismissInvoice, retryInvoiceConversions, updateInvoiceDetails } from "@/app/actions";
import { invoiceReadVersion, isInvoicePurpose, type InvoiceDraft, type Workspace } from "@/lib/model";
import { isInvoiceOriginal } from "@/lib/vat";
import { ActionForm, EntryForm } from "./forms";
import { RereadInvoicePdfs } from "./document-upload";
import { exchangeCurrencies } from "@/lib/documents/exchange-rates";
import { invoiceDraftGaps } from "@/lib/documents/invoice-review";
import { supplierDateMatches } from "@/lib/report-intake";

export async function InvoiceReview({ workspace, selectedId, page, locale, filter }: {
  workspace: Workspace;
  selectedId?: string;
  page: number;
  locale: string;
  filter?: string;
}) {
  const t = await getTranslations();
  const { business, documents, invoiceDrafts = [] } = workspace;
  const year = business.profile.year;
  const pending = invoiceDrafts.filter(draft => !draft.posted_entry);
  const withGaps = new Map(pending.map(draft => [draft.id, invoiceDraftGaps(draft, year)]));
  const gaps = (draft: InvoiceDraft) => withGaps.get(draft.id) ?? [];
  const incomplete = [...withGaps.values()].filter(fields => fields.length).length;
  const filters = ["all", "ready", "input", "year"] as const;
  const active = filters.find(value => value === filter) ?? "all";
  const matchingFilter = pending.filter(draft => active === "all" ||
    (active === "year" ? gaps(draft).includes("year") : active === "input" ? gaps(draft).length > 0 : !gaps(draft).length));
  const outside = pending.filter(draft => gaps(draft).includes("year")).length;
  const selected = pending.find(draft => draft.id === selectedId);
  const source = documents.find(document => document.id === selected?.document_id);
  const suggestion = selected?.fields.dateSuggestion;
  const foreign = selected?.fields.foreign;
  const exchange = selected?.fields.exchange;
  const matchingDates = selected ? supplierDateMatches(invoiceDrafts, selected, year) : [];
  const dateOutside = selected ? gaps(selected).includes("year") : false;
  const dateInYear = suggestion?.date.startsWith(year + "-");
  const printedLine = suggestion && source?.text_content.split(/\r?\n/).find(line =>
    line.trim().toLowerCase().startsWith(suggestion.label + ":") && line.includes(suggestion.date))?.trim().slice(0, 180);
  const byId = new Map(documents.map(document => [document.id, document.name]));
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const format = (amount?: string) => amount ? money.format(Number(amount)) : t("imports.missingField");
  const pageSize = 30;
  const currentPage = Math.min(Math.max(1, page), Math.max(1, Math.ceil(matchingFilter.length / pageSize)));
  const offset = (currentPage - 1) * pageSize;
  const href = "/?view=review&issue=" + active + "&draftPage=";
  const partial = documents.filter(document =>
    document.status === "invoicePartial" ||
    document.status === "needsOcr" && isInvoicePurpose(document.purpose));
  const postedSources = new Set([
    ...invoiceDrafts.filter(draft => draft.posted_entry).map(draft => draft.document_id),
    ...workspace.entries.map(entry => entry.source_id),
    ...workspace.vatReturns.map(filed => filed.source_id),
  ]);
  const draftSources = new Set(invoiceDrafts.map(draft => draft.document_id));
  const noDraft = partial.filter(document => isInvoicePurpose(document.purpose) && !draftSources.has(document.id) && !postedSources.has(document.id));
  const noDraftIds = new Set(noDraft.map(document => document.id));
  const partialWithDrafts = partial.filter(document => !noDraftIds.has(document.id));
  const rereadIds = documents.filter(document => document.kind === "pdf" && isInvoicePurpose(document.purpose) &&
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
    {outside > 0 && <p className="notice">{t("imports.outsideYear", { count: outside, year })}{" "}
      <Link className="text-link" href="/?view=business#report-year">{t("intake.checkYear")}</Link></p>}
    {pending.some(draft => gaps(draft).includes("rate")) && <ActionForm action={retryInvoiceConversions}
      label={t("imports.retryRates")} className="quiet-action">
      <input type="hidden" name="businessId" value={business.id} />
    </ActionForm>}
    <RereadInvoicePdfs businessId={business.id} documentIds={rereadIds} />
    {noDraft.length > 0 && <details className="notice" id="invoice-files-without-drafts">
      <summary>{t("imports.noDraftCount", { count: noDraft.length })}</summary>
      <ul>{noDraft.map(document => <li key={document.id}>
        <a className="text-link" href={`/api/documents/${document.id}`} target="_blank" rel="noreferrer">{document.name}</a>{" "}
        {(document.invoice_issues?.length ? document.invoice_issues : [document.status === "needsOcr" ? "unreadable" : "layout"])
          .map(issue => t("imports.invoiceIssue." + issue)).join(" · ")}{" "}
        <Link className="text-link" href={`/?view=review&manualSource=${document.id}#manual-entry`}>{t("imports.manualFromSource")}</Link>
      </li>)}</ul>
    </details>}
    {partialWithDrafts.length > 0 && <details className="notice">
      <summary>{t("imports.partialCount", { count: partialWithDrafts.length })}</summary>
      <ul>{partialWithDrafts.map(document => <li key={document.id}>
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
        {!selected.fields.date && suggestion && <p className="help">{t("imports.suggestedDate", { label: suggestion.label, date: suggestion.date })}
          {printedLine && <q className="source-excerpt">{printedLine}</q>}</p>}
        {!selected.fields.date && suggestion && dateInYear && <ActionForm action={updateInvoiceDetails} label={t("imports.useSuggestedDate")}>
          <input type="hidden" name="businessId" value={business.id} />
          <input type="hidden" name="draftId" value={selected.id} />
          <input type="hidden" name="intent" value="confirmDate" />
          {suggestion.supplier && <label className="checkbox">
            <input type="checkbox" name="remember" defaultChecked />
            {t("imports.rememberDate", { supplier: suggestion.supplier.name })}
          </label>}
          {matchingDates.length > 0 && <details className="import-duplicate">
            <summary>{t("imports.previewDateMatches", { count: matchingDates.length })}</summary>
            <ul>{matchingDates.map(draft => <li key={draft.id}>
              {byId.get(draft.document_id)} · {draft.fields.dateSuggestion?.date}
            </li>)}</ul>
            <input type="hidden" name="matchingDraftIds" value={matchingDates.map(draft => draft.id).sort().join(",")} />
            <label className="checkbox"><input type="checkbox" name="applyMatching" />{t("imports.applyDateMatches")}</label>
          </details>}
        </ActionForm>}
        <details className="import-duplicate" open={dateOutside}>
          <summary>{t("imports.checkDate")}</summary>
          <ActionForm action={updateInvoiceDetails} label={t("imports.saveDate")}>
            <input type="hidden" name="businessId" value={business.id} />
            <input type="hidden" name="draftId" value={selected.id} />
            <input type="hidden" name="intent" value="setDate" />
            <label>{t("common.date")}<input name="invoiceDate" type="date" min={year + "-01-01"}
              max={year + "-12-31"} defaultValue={dateOutside ? undefined : selected.fields.date} required /></label>
          </ActionForm>
        </details>
        {foreign && !dateOutside && <details className="import-duplicate" open={!exchange && Boolean(selected.fields.date)}>
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
        {gaps(selected).map(field => <p className="help" key={field}>{t("imports.gaps." + field)}</p>)}
        <Link className="text-link" href={href + currentPage + "#invoice-review"}>{t("imports.backToDrafts")}</Link>
      </div>
      {!dateOutside && (!foreign || exchange) && <EntryForm key={JSON.stringify([selected.id, selected.fields.date, exchange])} businessId={business.id} profile={business.profile} draft={selected} sourceName={source.name}
        documents={source.kind === "csv" ? documents.filter(d => isInvoiceOriginal(d) &&
          !workspace.vatReturns.some(filed => filed.source_id === d.id)).map(({ id, name }) => ({ id, name })) : []} />}
      <ActionForm key={"dismiss:" + selected.id} action={dismissInvoice} label={t("imports.dismiss")} className="quiet-action">
        <input type="hidden" name="businessId" value={business.id} />
        <input type="hidden" name="draftId" value={selected.id} />
      </ActionForm>
    </div>}
    {pending.length === 0 ? <p className="empty-inline">{t("imports.noDrafts")}</p> : <>
      <nav className="import-filters" aria-label={t("imports.filterDrafts")}>
        {filters.map(value => <Link className={active === value ? "button secondary" : "text-link"}
          aria-current={active === value ? "page" : undefined} key={value}
          href={`/?view=review&issue=${value}#invoice-review`}>{t("imports.filters." + value)}</Link>)}
      </nav>
      {matchingFilter.length === 0 && <p className="empty-inline">{t("imports.noFilterResults")}</p>}
      <ul className="import-draft-list">
        {matchingFilter.slice(offset, offset + pageSize).map(draft => <li key={draft.id}>
          <div>
            <strong>{draft.fields.reference || byId.get(draft.document_id)}</strong>
            <small>{[draft.fields.date, byId.get(draft.document_id)].filter(Boolean).join(" · ")}</small>
            <small>{gaps(draft).length
              ? gaps(draft).map(field => t("imports.gaps." + field)).join(" · ")
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
        {offset + pageSize < matchingFilter.length && <Link className="text-link" href={href + (currentPage + 1) + "#invoice-review"}>{t("imports.moreDrafts")}</Link>}
      </div>
    </>}
  </section>;
}
