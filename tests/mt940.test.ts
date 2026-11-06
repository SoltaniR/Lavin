import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMt940 } from "../src/lib/documents/mt940";
const source = readFileSync(
  new URL("./fixtures/sample-bank.mt940", import.meta.url),
  "utf8",
);
test("extracts signed movements and reconciles statement balances", () => {
  const result = parseMt940(source);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].amount, "121.00");
  assert.equal(result.rows[1].amount, "-11.00");
  assert.equal(result.closing, "5520.00");
});
test("missing movement cannot silently pass reconciliation", () => {
  assert.throws(
    () =>
      parseMt940(
        source.replace(
          ":61:2503100310D11,00NCHGFEE-001//BANK-002\n:86:Synthetic bank fee\n",
          "",
        ),
      ),
    /bankBalance/,
  );
});
test("rejects currencies and multiple statements outside the supported subset", () => {
  assert.throws(
    () => parseMt940(source.replaceAll("EUR", "USD")),
    /bankFormat/,
  );
  assert.throws(() => parseMt940(source + "\n" + source), /bankFormat/);
});
test("a reversal changes the signed amount and must still reconcile", () => {
  const reversed = source
    .replace("0310D11,00", "0310RD11,00")
    .replace("EUR5520,00", "EUR5542,00");
  assert.equal(parseMt940(reversed).rows[1].amount, "11.00");
});
