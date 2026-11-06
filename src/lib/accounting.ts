import Decimal from "decimal.js";
import { z } from "zod";
import { accounts, type Journal, type Line, type Profile } from "./model";

export class DomainError extends Error {}
export const moneySchema = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
const knownAccounts = new Set(accounts.map((a) => a.code));
export const entrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(3).max(240),
  kind: z.enum(["sale", "purchase", "payment", "opening", "adjustment"]),
  debit: z.string(),
  credit: z.string(),
  amount: moneySchema,
  vat: moneySchema.default("0"),
  requestKey: z.string().uuid(),
  sourceId: z.union([z.string().uuid(), z.literal("")]).default(""),
});
export type EntryInput = z.infer<typeof entrySchema>;

export function buildLines(input: EntryInput, year: number): Line[] {
  const date = new Date(`${input.date}T12:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== input.date ||
    date.getUTCFullYear() !== year
  )
    throw new DomainError("date");
  const total = new Decimal(input.amount),
    vat = new Decimal(input.vat);
  if (total.lte(0) || vat.gte(total) || vat.lt(0))
    throw new DomainError("amount");
  const line = (
    account: string,
    debit: Decimal.Value,
    credit: Decimal.Value,
  ): Line => ({
    account,
    debit: new Decimal(debit).toFixed(2),
    credit: new Decimal(credit).toFixed(2),
  });
  let lines: Line[];
  if (input.kind === "sale") {
    lines = [line("receivables", total, 0), line("sales", 0, total.minus(vat))];
    if (!vat.isZero()) lines.push(line("vatOutput", 0, vat));
  } else if (input.kind === "purchase") {
    if (
      !accounts.some(
        (a) =>
          a.code === input.debit &&
          (a.kind === "expense" || a.kind === "asset"),
      )
    )
      throw new DomainError("account");
    lines = [
      line(input.debit, total.minus(vat), 0),
      line("payables", 0, total),
    ];
    if (!vat.isZero()) lines.push(line("vatInput", vat, 0));
  } else {
    if (!vat.isZero()) throw new DomainError("vat");
    if (input.debit === input.credit) throw new DomainError("account");
    lines = [line(input.debit, total, 0), line(input.credit, 0, total)];
  }
  if (
    input.kind === "opening" &&
    lines.some((l) =>
      ["income", "expense"].includes(
        accounts.find((a) => a.code === l.account)?.kind ?? "",
      ),
    )
  )
    throw new DomainError("opening");
  validateLines(lines);
  return lines;
}

export function validateLines(lines: Line[]) {
  if (lines.length < 2) throw new DomainError("balance");
  let balance = new Decimal(0);
  for (const l of lines) {
    if (!knownAccounts.has(l.account)) throw new DomainError("account");
    const d = new Decimal(l.debit),
      c = new Decimal(l.credit);
    if (
      d.lt(0) ||
      c.lt(0) ||
      d.gt(0) === c.gt(0) ||
      d.decimalPlaces() > 2 ||
      c.decimalPlaces() > 2
    )
      throw new DomainError("amount");
    balance = balance.plus(d).minus(c);
  }
  if (!balance.isZero()) throw new DomainError("balance");
}

export function financials(entries: Journal[]) {
  const balances = Object.fromEntries(
    accounts.map((a) => [a.code, new Decimal(0)]),
  );
  for (const entry of entries)
    for (const l of entry.lines)
      balances[l.account] = balances[l.account].plus(l.debit).minus(l.credit);
  const sum = (kind: string) =>
    accounts
      .filter((a) => a.kind === kind)
      .reduce((s, a) => s.plus(balances[a.code]), new Decimal(0));
  const revenue = sum("income").negated(),
    expenses = sum("expense"),
    profit = revenue.minus(expenses);
  const assets = sum("asset"),
    liabilities = sum("liability").negated(),
    capital = sum("equity").negated();
  return {
    balances: Object.fromEntries(
      Object.entries(balances).map(([k, v]) => [k, v.toFixed(2)]),
    ),
    revenue: revenue.toFixed(2),
    expenses: expenses.toFixed(2),
    profit: profit.toFixed(2),
    assets: assets.toFixed(2),
    liabilities: liabilities.toFixed(2),
    equity: capital.plus(profit).toFixed(2),
    difference: assets
      .minus(liabilities)
      .minus(capital)
      .minus(profit)
      .toFixed(2),
  };
}

export function readiness(
  p: Profile,
  entryCount: number,
  remaining: number,
  unposted: number,
): string[] {
  return [
    ...(!entryCount ? ["noEntries"] : []),
    ...(remaining ? ["evidence"] : []),
    ...(unposted ? ["bankRows"] : []),
    ...(p.vatMethod === "unknown" ? ["vatMethod"] : []),
    "draftOnly",
  ];
}
