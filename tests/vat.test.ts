import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLines, DomainError, type EntryInput } from "../src/lib/accounting";
import { defaultProfile, type Journal, type Workspace } from "../src/lib/model";
import { filedReturnSchema, quarterlyVat } from "../src/lib/vat";

const source = "00000000-0000-4000-8000-000000000001";
const returnSource = "00000000-0000-4000-8000-000000000002";
function journal(fields: Partial<EntryInput>): Journal {
  const input: EntryInput = {
    date: "2025-03-31", description: "Practice invoice", kind: "sale", amount: "121.05",
    vat: "21.01", debit: "otherCosts", credit: "payables", requestKey: source, sourceId: source,
    ...fields,
  };
  return { id: input.date, entry_date: input.date, description: input.description, kind: input.kind,
    source_id: input.sourceId || null, lines: buildLines(input, 2025) };
}
function example(): Workspace {
  return {
    business: { id: source, created_at: "", profile: { ...defaultProfile, vatMethod: "invoice", vatScope: "ordinaryQuarterly" } },
    entries: [journal({}), journal({ kind: "purchase", amount: "60.50", vat: "10.50" }),
      journal({ date: "2025-04-01", vat: "90" }),
      journal({ kind: "opening", vat: "0", debit: "bank", credit: "vatOutput" }),
      journal({ kind: "payment", vat: "0", debit: "bank", credit: "receivables" })],
    documents: [[source, "invoice.pdf"], [returnSource, "filed-return.pdf"]].map(([id, name]) => ({
      id, name, kind: "pdf", status: "textReady", sha256: "", text_content: "", created_at: "",
    })),
    bankRows: [], evidence: [],
    vatReturns: [{ quarter: 1, source_id: returnSource, filed_output: "21", filed_input: "11", note: "" }],
  };
}

test("VAT comparison isolates quarters, excludes settlements and preserves rounding differences", () => {
  const workspace = example();
  const first = quarterlyVat(workspace, 1);
  assert.deepEqual(first.rows.map(row => [row.booked, row.filed, row.difference]), [
    ["21.01", "21", "0.01"], ["10.50", "11", "-0.50"],
  ]);
  assert.equal(first.status, "differenceFound");
  assert.equal(first.invoices.length, 2);
  assert.equal(quarterlyVat(workspace, 2).rows[0].booked, "90.00");
  assert.equal(quarterlyVat(workspace, 2).status, "missingReturn");
});

test("filed return PDFs cannot count as invoice evidence or support two quarters", () => {
  const workspace = example();
  workspace.vatReturns.push({ ...workspace.vatReturns[0], quarter: 2 });
  workspace.entries = [journal({ sourceId: returnSource, vat: "21" })];
  const first = quarterlyVat(workspace, 1);
  assert.equal(first.duplicateSource, true);
  assert.equal(first.status, "needsReview");
  assert.equal(first.rows[0].difference, null);
  assert.equal(first.missingSources, 1);
  assert.equal(quarterlyVat(workspace, 2).duplicateSource, true);
});

test("only the entered deductible part of purchase VAT contributes to box 5b", () => {
  const workspace = example();
  const purchase = journal({ kind: "purchase", amount: "121", vat: "10" });
  const nonDeductible = journal({ kind: "purchase", amount: "21", vat: "0" });
  workspace.entries = [purchase, nonDeductible];
  assert.equal(quarterlyVat(workspace, 1).rows[1].booked, "10.00");
  assert.equal(purchase.lines.find(line => line.account === "otherCosts")?.debit, "111.00");
  assert.equal(nonDeductible.lines.find(line => line.account === "otherCosts")?.debit, "21.00");
});

test("VAT comparison flags unsupported methods, missing evidence and other transactions", () => {
  const workspace = example();
  workspace.business.profile.vatMethod = "cash";
  assert.equal(quarterlyVat(workspace, 1).status, "scopeReview");
  assert.equal(quarterlyVat(workspace, 1).rows[0].difference, null);
  workspace.business.profile.vatMethod = "invoice";
  workspace.vatReturns[0].filed_output = "21";
  workspace.vatReturns[0].filed_input = "0";
  workspace.entries = [journal({ vat: "21", sourceId: "" }), journal({ kind: "adjustment", vat: "0", debit: "vatOutput", credit: "bank" })];
  const result = quarterlyVat(workspace, 1);
  assert.equal(result.status, "needsReview");
  assert.equal(result.missingSources, 1);
  assert.equal(result.other, 1);
  workspace.entries = [journal({ vat: "21" })];
  assert.equal(quarterlyVat(workspace, 1).status, "totalsAgree");
  workspace.business.profile.vatScope = "unknown";
  assert.equal(quarterlyVat(workspace, 1).status, "scopeReview");
});

test("filed zeros require explicit input and purchase VAT cannot be booked as a purchase category", () => {
  const returnInput = { quarter: "1", sourceId: source, filedOutput: "0", filedInput: "-45", note: "" };
  assert.equal(filedReturnSchema.parse(returnInput).filedOutput, "0");
  for (const filedInput of ["", "1.01", "1,20", "1e3"]) {
    assert.equal(filedReturnSchema.safeParse({ ...returnInput, filedInput }).success, false);
  }
  assert.throws(() => journal({ kind: "purchase", debit: "vatInput" }), DomainError);
});
