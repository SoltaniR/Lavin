import { isInvoicePurpose, type Document, type InvoiceDraft, type InvoiceFields, type InvoiceIssue } from "../model";
import { exchangeCurrencies } from "./exchange-rates";

export function invoiceDraftGaps(draft: Pick<InvoiceDraft, "direction" | "fields">, year: number) {
  const f = draft.fields, foreign = f.foreign;
  const dateInYear = f.date?.startsWith(year + "-");
  const currencyKnown = foreign?.currency && exchangeCurrencies.some(code => code === foreign.currency);
  return [
    ...(!draft.direction ? ["direction"] : []),
    ...(!f.date ? [f.dateSuggestion ? "suggestedDate" : "date"] : !dateInYear ? ["year"] : []),
    ...(foreign
      ? [
          ...(!currencyKnown ? [foreign.currency ? "unsupportedCurrency" : "currency"] : []),
          ...(!foreign.amount ? ["originalTotal"] : []),
          ...(foreign.vat === undefined ? ["originalVat"] : []),
          ...(dateInYear && currencyKnown && foreign.amount && !f.exchange ? ["rate"] : []),
        ]
      : [...(!f.amount ? ["total"] : []), ...(f.invoiceVat === undefined ? ["vat"] : [])]),
  ];
}

export function currentInvoiceIssues(original: InvoiceIssue[] | undefined, drafts: Pick<InvoiceDraft, "direction" | "fields">[], year: number) {
  const issues: InvoiceIssue[] = (original ?? []).filter(issue => issue !== "missingFields" && issue !== "fxPending" && issue !== "nonEur");
  const gaps = drafts.flatMap(draft => invoiceDraftGaps(draft, year));
  if (gaps.includes("rate")) issues.push("fxPending");
  if (gaps.some(gap => gap !== "rate")) issues.push("missingFields");
  return issues;
}

export function reviewInvoiceDocuments(documents: Document[], drafts: InvoiceDraft[], year: number): Document[] {
  const bySource = Map.groupBy(drafts, draft => draft.document_id);
  return documents.map(document => {
    if (!isInvoicePurpose(document.purpose) || !["invoiceReady", "invoicePartial"].includes(document.status)) return document;
    const pending = bySource.get(document.id)?.filter(draft => !draft.posted_entry);
    if (!pending?.length) return document;
    const issues = currentInvoiceIssues(document.invoice_issues, pending, year);
    return { ...document, status: issues.length ? "invoicePartial" : "invoiceReady", invoice_issues: issues };
  });
}

export function preserveConfirmedFields(prior: InvoiceFields, current: InvoiceFields): InvoiceFields {
  const confirmedDate = prior.dateConfirmed || (prior.date && prior.date === prior.dateSuggestion?.date);
  const result = confirmedDate ? { ...current, date: prior.date, dateConfirmed: true } : current;
  if (prior.exchangeConfirmed) {
    return { ...result, foreign: prior.foreign, amount: prior.amount, invoiceVat: prior.invoiceVat,
      exchange: prior.exchange, exchangeConfirmed: true };
  }
  if (prior.exchange && prior.date === result.date && prior.foreign?.amount === result.foreign?.amount &&
    prior.foreign?.vat === result.foreign?.vat && prior.foreign?.currency === result.foreign?.currency) {
    return { ...result, amount: prior.amount, invoiceVat: prior.invoiceVat, exchange: prior.exchange };
  }
  return result;
}
