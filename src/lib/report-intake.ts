import { bankPdfPeriod, normalizedBankAccount } from "./documents/bank-pdf";
import { vatFigures } from "./documents/vat-pdf";
import type { BankRow, Document, InvoiceDraft, VatReturn, Workspace } from "./model";

export function yearConflicts(w: {
  entries: readonly unknown[];
  bankRows: Pick<BankRow, "document_id" | "booking_date">[];
  vatReturns: Pick<VatReturn, "quarter" | "source_id">[];
  documents: Pick<Document, "id" | "vat_suggestion" | "text_content">[];
}, year: number) {
  const bank = new Set(w.bankRows.filter(row => !row.booking_date.startsWith(year + "-")).map(row => row.document_id));
  const byId = new Map(w.documents.map(document => [document.id, document]));
  const vat = w.vatReturns.filter(filed => {
    const source = byId.get(filed.source_id);
    const period = source?.vat_suggestion?.year ? source.vat_suggestion : vatFigures(source?.text_content ?? "");
    return period.year !== year || period.quarter !== filed.quarter;
  });
  return { posted: w.entries.length, bank: bank.size, vat: vat.length };
}

export function supplierDateMatches(drafts: InvoiceDraft[], draft: InvoiceDraft, year: number) {
  const suggestion = draft.fields.dateSuggestion;
  const supplier = suggestion?.supplier?.key;
  if (!supplier) return [];
  return drafts.filter(other => {
    const candidate = other.fields.dateSuggestion;
    return other.id !== draft.id && !other.posted_entry && !other.fields.date &&
      candidate?.supplier?.key === supplier && candidate.label === suggestion.label && candidate.date.startsWith(year + "-");
  });
}

type CoverageState = "missing" | "partial" | "open" | "future" | "present";
type Period = { start: string; end: string };
const dayMs = 86_400_000;

export function documentCoverage(w: Workspace, now = new Date()) {
  const { profile } = w.business;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam", dateStyle: "short" }).format(now);
  const state = ({ start, end }: Period, present: boolean, partial = false): CoverageState =>
    start > today ? "future" : present ? "present" : end >= today ? "open" : partial ? "partial" : "missing";
  const month = (m: number) => ({
    start: new Date(Date.UTC(profile.year, m - 1, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(profile.year, m, 0)).toISOString().slice(0, 10),
  });
  const invoices = w.invoiceDrafts ?? [];
  const dates = (kind: "sale" | "purchase") => [
    ...invoices.filter(draft => draft.direction === kind).map(draft => draft.fields.date),
    ...w.entries.filter(entry => entry.kind === kind && entry.source_id).map(entry => entry.entry_date),
  ];
  const invoiceMonths = (kind: "sale" | "purchase") => {
    const read = new Set(dates(kind).map(date => date?.slice(0, 7)));
    return Array.from({ length: 12 }, (_, i) => {
      const period = month(i + 1);
      return state(period, read.has(period.start.slice(0, 7)));
    });
  };
  const statements = w.documents.flatMap(document => document.statement_period ? [document.statement_period] : []);
  const uncheckedBank = w.documents.filter(d => (d.purpose === "bank" || !d.purpose && d.kind === "mt940") && !d.statement_period);
  const uncheckedPeriods = uncheckedBank.flatMap(d => {
    const period = d.kind === "pdf" && bankPdfPeriod(d.text_content);
    return period ? [period] : [];
  });
  const accounts = Map.groupBy(statements, item => normalizedBankAccount(item.account));
  for (const periods of accounts.values()) periods.sort((a, b) => a.start.localeCompare(b.start));
  const bank = Array.from({ length: 12 }, (_, i) => {
    const period = month(i + 1), start = Date.parse(period.start), end = Date.parse(period.end);
    let full = accounts.size > 0, partial = false;
    for (const periods of accounts.values()) {
      let next = start;
      for (const statement of periods) {
        const from = Date.parse(statement.start), through = Date.parse(statement.end);
        if (from <= end && through >= start) partial = true;
        if (from <= next && through >= next) next = through + dayMs;
      }
      if (next <= end) full = false;
    }
    const unverified = uncheckedPeriods.some(item => item.start <= period.end && item.end >= period.start);
    return state(period, full && !unverified, partial || unverified);
  });
  const vat = profile.vatScope === "ordinaryQuarterly" ? Array.from({ length: 4 }, (_, i) => {
    const quarter = i + 1;
    const found = w.vatReturns.some(filed => filed.quarter === quarter) ||
      w.documents.some(document => document.purpose === "vat" && document.vat_suggestion?.quarter === quarter &&
        document.vat_suggestion.year === profile.year);
    return state({ start: month(quarter * 3 - 2).start, end: month(quarter * 3).end }, found);
  }) : [];
  const invoiceSources = Map.groupBy(invoices, draft => draft.document_id);
  const postedSources = new Set(w.entries.map(entry => entry.source_id));
  const needsInvoiceReview = (d: Workspace["documents"][number]) => {
    if (postedSources.has(d.id)) return false;
    const drafts = invoiceSources.get(d.id);
    return drafts?.length ? drafts.some(item => !item.fields.date?.startsWith(profile.year + "-")) : d.status !== "invoiceReady";
  };
  const unread = {
    sale: w.documents.filter(d => d.purpose === "sale" && needsInvoiceReview(d)).length,
    purchase: w.documents.filter(d => d.purpose === "purchase" && needsInvoiceReview(d)).length,
    bank: uncheckedBank.length,
    vat: w.documents.filter(d => d.purpose === "vat" && !d.vat_suggestion?.quarter && !w.vatReturns.some(filed => filed.source_id === d.id)).length,
  };
  return {
    groups: { sale: invoiceMonths("sale"), purchase: invoiceMonths("purchase"), bank, vat },
    unread,
  };
}
