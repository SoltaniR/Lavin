import Decimal from "decimal.js";
import { z } from "zod";
import type { Workspace } from "./model";

export const quarters = [1, 2, 3, 4] as const;
export const quarterSchema = z.enum(["1", "2", "3", "4"]).transform(Number);
const wholeEuros = z.string().trim().regex(/^-?\d{1,10}$/);
export const filedReturnSchema = z.object({
  quarter: quarterSchema,
  sourceId: z.string().uuid(),
  filedOutput: wholeEuros,
  filedInput: wholeEuros,
  note: z.string().trim().max(2000),
});

export const vatGuidance = {
  2025: "https://download.belastingdienst.nl/belastingdienst/docs/toelichting_bij_btw_aangifte_ob0731t53fd.pdf",
  2026: "https://download.belastingdienst.nl/belastingdienst/docs/toelichting_bij_btw_aangifte_ob0731t63fd.pdf",
};

export function quarterlyVat(workspace: Workspace, quarter: number) {
  const { business, entries, documents, bankRows, vatReturns } = workspace;
  const { year, vatMethod, vatScope } = business.profile;
  const inQuarter = (date: string) => Number(date.slice(0, 4)) === year &&
    Math.ceil(Number(date.slice(5, 7)) / 3) === quarter;
  const sources = new Set(documents.filter(d => d.kind === "pdf").map(d => d.id));
  const invoices = [];
  let output = new Decimal(0), input = new Decimal(0), other = 0, missingSources = 0;

  for (const entry of entries) {
    if (!inQuarter(entry.entry_date) || entry.kind === "opening") continue;
    const vatLines = entry.lines.filter(line => line.account === "vatOutput" || line.account === "vatInput");
    if (entry.kind !== "sale" && entry.kind !== "purchase") {
      if (vatLines.length || entry.lines.some(line => line.account === "sales")) other++;
      continue;
    }
    if (!entry.source_id || !sources.has(entry.source_id)) missingSources++;
    // Old data could contain purchases posted straight to the input-VAT account.
    // Skip ambiguous posting shapes rather than treating their total as VAT.
    const account = entry.kind === "sale" ? "vatOutput" : "vatInput";
    const valid = vatLines.length <= 1 && vatLines.every(line =>
      line.account === account && new Decimal(entry.kind === "sale" ? line.debit : line.credit).isZero(),
    ) && (entry.kind !== "purchase" || entry.lines.some(line => line.account !== "vatInput" && new Decimal(line.debit).gt(0)));
    if (!valid) { other++; continue; }
    const vat = new Decimal(vatLines[0]?.[entry.kind === "sale" ? "credit" : "debit"] ?? 0);
    if (entry.kind === "sale") output = output.plus(vat);
    else input = input.plus(vat);
    invoices.push({ entry, vat: vat.toFixed(2) });
  }

  const filed = vatReturns.find(v => v.quarter === quarter);
  const eligible = vatMethod === "invoice" && vatScope === "ordinaryQuarterly";
  const unposted = bankRows.filter(row => inQuarter(row.booking_date) && !row.posted_entry).length;
  const rows = [
    { key: "output", booked: output, filed: filed?.filed_output },
    { key: "input", booked: input, filed: filed?.filed_input },
  ].map(row => ({
    ...row,
    booked: row.booked.toFixed(2),
    difference: eligible && row.filed !== undefined ? row.booked.minus(row.filed).toFixed(2) : null,
  }));
  const differences = rows.some(row => row.difference !== null && !new Decimal(row.difference).isZero());
  const needsReview = !invoices.length || Boolean(other || missingSources || unposted);
  const status = !eligible ? "scopeReview"
    : !filed ? "missingReturn"
    : differences ? "differenceFound"
    : needsReview ? "needsReview"
    : "totalsAgree";
  return { rows, filed, eligible, invoices, missingSources, other, unposted, status };
}
