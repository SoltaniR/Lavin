import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultProfile, reportingYearSchema, type InvoiceDraft, type Workspace } from "../src/lib/model";
import { documentCoverage, supplierDateMatches, yearConflicts } from "../src/lib/report-intake";
import { invoiceDraftGaps, preserveConfirmedFields } from "../src/lib/documents/invoice-review";

const workspace: Workspace = {
  business: { id: "business", profile: { ...defaultProfile, year: 2026, vatScope: "ordinaryQuarterly" }, created_at: "" },
  entries: [], documents: [], bankRows: [], vatReturns: [], evidence: [],
};
const draft = (id: string, fields: InvoiceDraft["fields"]): InvoiceDraft =>
  ({ id, fields, direction: "purchase", posted_entry: null, document_id: id });

test("2026 is an explicit choice and December opens at midnight in Amsterdam", () => {
  assert.equal(reportingYearSchema.safeParse("").success, false);
  assert.equal(reportingYearSchema.parse("2026"), 2026);
  const data = { ...workspace, invoiceDrafts: [draft("one", { date: "2026-01-12" }), draft("two", { date: "2025-04-01" })] };
  const november = documentCoverage(data, new Date("2026-11-21T12:00:00Z")).groups;
  assert.equal(november.purchase[0], "present");
  assert.equal(november.purchase[3], "missing");
  assert.equal(november.purchase[10], "open");
  assert.equal(november.purchase[11], "future");
  assert.equal(november.vat[3], "open");
  const december = documentCoverage(data, new Date("2026-11-30T23:01:00Z")).groups;
  assert.equal(december.purchase[11], "open");
});

test("bank statements close a coverage gap only across a continuous account period", () => {
  const statement = (id: string, account: string, start: string, end: string) => ({
    id, name: id, kind: "mt940" as const, purpose: "bank" as const, status: "bankReady",
    text_content: "", sha256: id, created_at: "", statement_period: { account, start, end },
  });
  const a = statement("first", "NL01", "2026-01-01", "2026-01-15");
  const b = statement("second", "NL01", "2026-01-16", "2026-01-31");
  const c = statement("third", "NL02", "2026-01-16", "2026-01-31");
  const coverage = (documents: Workspace["documents"]) => documentCoverage({ ...workspace, documents }, new Date("2026-02-01")).groups.bank[0];
  assert.equal(coverage([a, b]), "present");
  assert.equal(coverage([a, c]), "partial");
});

test("year correction guards linked bank and VAT periods and suppresses misleading currency gaps", () => {
  assert.deepEqual(yearConflicts({
    entries: [], bankRows: [{ document_id: "bank", booking_date: "2025-02-05" }],
    vatReturns: [{ quarter: 2, source_id: "vat" }], documents: [{ id: "vat", text_content: "Q1 2026" }],
  }, 2026), { posted: 0, bank: 1, vat: 1 });
  const f = { date: "2026-04-17", foreign: { amount: "10.00", currency: "GBP", vat: "0.00" } };
  assert.deepEqual(invoiceDraftGaps(draft("invoice", f), 2025), ["year"]);
  assert.deepEqual(invoiceDraftGaps(draft("invoice", f), 2026), ["rate"]);
});

test("only unconfirmed same-supplier dates in the report year qualify for a batch", () => {
  const proposal = { label: "created" as const, date: "2026-04-17", supplier: { key: "example.test", name: "Example" } };
  const original = draft("original", { dateSuggestion: proposal });
  const matches = supplierDateMatches([
    original, draft("match", { dateSuggestion: proposal }),
    draft("differentYear", { dateSuggestion: { ...proposal, date: "2025-04-17" } }),
    draft("confirmed", { dateSuggestion: proposal, date: "2026-04-18" }),
  ], original, 2026);
  assert.deepEqual(matches.map(d => d.id), ["match"]);
  assert.equal(preserveConfirmedFields({ date: proposal.date, dateConfirmed: true }, { date: "2026-04-20" }).date, proposal.date);
});
