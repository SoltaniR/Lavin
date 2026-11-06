import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  buildLines,
  entrySchema,
  financials,
  validateLines,
  type EntryInput,
} from "../src/lib/accounting";
import { defaultProfile, requirements, type Journal } from "../src/lib/model";
import en from "../src/messages/en.json";
import nl from "../src/messages/nl.json";

const input = (changes: Partial<EntryInput> = {}): EntryInput => ({
  date: "2025-01-01",
  description: "Test transaction",
  kind: "sale",
  debit: "bank",
  credit: "capital",
  amount: "121.00",
  vat: "21.00",
  requestKey: randomUUID(),
  sourceId: "",
  ...changes,
});
const journal = (i: EntryInput): Journal => ({
  id: randomUUID(),
  entry_date: i.date,
  description: i.description,
  kind: i.kind,
  source_id: null,
  lines: buildLines(i, 2025),
});

test("invoice and settlement recognize revenue exactly once", () => {
  const entries = [
    journal(input()),
    journal(input({ kind: "payment", credit: "receivables", vat: "0" })),
  ];
  const f = financials(entries);
  assert.equal(f.revenue, "100.00");
  assert.equal(f.balances.receivables, "0.00");
  assert.equal(f.balances.bank, "121.00");
  assert.equal(f.liabilities, "21.00");
  assert.equal(f.difference, "0.00");
});
test("sample year agrees to independent expected figures", () => {
  const entries = [
    journal(input({ kind: "opening", amount: "5000", vat: "0" })),
    journal(input({ amount: "1210", vat: "210" })),
    journal(
      input({
        kind: "payment",
        credit: "receivables",
        amount: "1210",
        vat: "0",
      }),
    ),
    journal(
      input({ kind: "purchase", debit: "rent", amount: "600", vat: "0" }),
    ),
    journal(
      input({
        kind: "payment",
        debit: "payables",
        credit: "bank",
        amount: "600",
        vat: "0",
      }),
    ),
    journal(
      input({
        kind: "payment",
        debit: "drawings",
        credit: "bank",
        amount: "200",
        vat: "0",
      }),
    ),
  ];
  const f = financials(entries);
  assert.equal(f.revenue, "1000.00");
  assert.equal(f.expenses, "600.00");
  assert.equal(f.profit, "400.00");
  assert.equal(f.assets, "5410.00");
  assert.equal(f.liabilities, "210.00");
  assert.equal(f.equity, "5200.00");
  assert.equal(f.difference, "0.00");
});
test("fractional cent artifacts do not enter the ledger", () => {
  const f = financials([journal(input({ amount: "0.30", vat: "0.10" }))]);
  assert.equal(f.revenue, "0.20");
  assert.equal(f.difference, "0.00");
  assert.throws(() => entrySchema.parse(input({ amount: "0.001" })));
});
test("invalid dates, years, amounts and opening profit accounts are rejected", () => {
  for (const change of [
    { date: "2025-02-30" },
    { date: "2026-01-01" },
    { amount: "0" },
    { vat: "121" },
    { kind: "opening", debit: "rent", vat: "0" },
  ] as Partial<EntryInput>[])
    assert.throws(() => buildLines(input(change), 2025));
});
test("unbalanced and invalid lines cannot be posted", () => {
  assert.throws(
    () =>
      buildLines(
        input({ kind: "payment", debit: "bank", credit: "bank", vat: "0" }),
        2025,
      ),
    /account/,
  );
  assert.throws(() =>
    validateLines([
      { account: "bank", debit: "100", credit: "0" },
      { account: "capital", debit: "0", credit: "99" },
    ]),
  );
  assert.throws(() =>
    validateLines([
      { account: "bank", debit: "1", credit: "1" },
      { account: "capital", debit: "0", credit: "0" },
    ]),
  );
});
test("checklist changes with actual business features", () => {
  const base = requirements({ ...defaultProfile, firstYear: true });
  assert.ok(!base.includes("comparatives"));
  assert.ok(!base.includes("stock"));
  const salon = requirements({
    ...defaultProfile,
    cash: true,
    stock: true,
    equipment: true,
  });
  for (const key of ["cash", "stock", "equipment", "comparatives"])
    assert.ok(salon.includes(key));
});
function strings(
  object: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(object).flatMap(([k, v]) =>
      typeof v === "string"
        ? [[prefix + k, v]]
        : Object.entries(
            strings(v as Record<string, unknown>, `${prefix}${k}.`),
          ),
    ),
  );
}
test("English and Dutch have identical keys and message placeholders", () => {
  const a = strings(en),
    b = strings(nl);
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  for (const key of Object.keys(a))
    assert.deepEqual(a[key].match(/\{\w+\}/g), b[key].match(/\{\w+\}/g), key);
});
