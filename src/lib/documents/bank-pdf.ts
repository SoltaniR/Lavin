import Decimal from "decimal.js";
import type { Statement } from "./mt940";
import { labeled, sourceDate, sourceMoney } from "./fields";
import { readPrintedDate } from "./invoice-text";

const accountPattern = /\b([A-Z]{2}\s*\d{2}\s*[A-Z]{4}\s*(?:\d\s*){10})(?!\d)/gi;
const datePattern = "(?:\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4})";
const periodLabel = /^(?:period|periode|statement period|afschriftperiode)\b/i;
const period = new RegExp("^(" + datePattern + ")\\s*(?:t/m|tot|to|through|until|till|–|—|-)\\s*(" + datePattern + ")$", "i");
const timedPeriod = /^(\d{1,2} [\p{L}.]+ \d{4}) \[GMT[+-][\d:]+\]\s*[-–—]\s*(\d{1,2} [\p{L}.]+ \d{4}) \[GMT[+-][\d:]+\]$/iu;
const movement = new RegExp("^(" + datePattern + ")\\s+(.+?)\\s+((?:(?:EUR|€)\\s*)?[+−-]?\\d[\\d., \\u00a0\\u202f]*[.,]\\d{2}(?:\\s*(?:CR|DR|CREDIT|DEBIT|BIJ|AF|EUR|€))?)$", "i");
const debitCredit = new RegExp("^(" + datePattern + ")\\s+(.+?)\\s+(\\d+[.,]\\d{2}|[—-])\\s+(\\d+[.,]\\d{2}|[—-])$", "i");
const dated = new RegExp("^" + datePattern + "\\s+");
const otherCurrency = /\b(?:USD|GBP|CHF|JPY|CAD|AUD)\b|[$£]/i;

export function normalizedBankAccount(account: string) {
  return account.match(accountPattern)?.[0].replace(/\s/g, "").toUpperCase() ??
    account.replace(/\s/g, "").toUpperCase();
}

export function bankPdfPeriod(text: string) {
  const lines = text.split(/\r?\n/).filter(line => line.trim()).map(line => line.trim().replace(/\s+/g, " "));
  const read = labeled(lines, periodLabel, value => {
    const match = value.match(period);
    const start = match && sourceDate(match[1]), end = match && sourceDate(match[2]);
    return start && end && start <= end ? start + "/" + end : undefined;
  }) ?? labeled(lines.slice(0, 30), /^EUR statement$/i, value => {
    const match = value.match(timedPeriod);
    const start = match && readPrintedDate(match[1]), end = match && readPrintedDate(match[2]);
    return start && end && start <= end ? start + "/" + end : undefined;
  });
  if (!read) return undefined;
  const [start, end] = read.split("/");
  return { start, end };
}

export function pdfStatement(text: string): Statement | null {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  // Use labeled account lines. Other IBANs on the statement may be counterparties.
  const account = labeled(lines, /^(?:IBAN|rekeningnummer|account(?: number)?)\b/i, value =>
    value.match(accountPattern)?.[0] ? normalizedBankAccount(value.match(accountPattern)![0]) : undefined,
  );
  const { start: openingDate, end: closingDate } = bankPdfPeriod(text) ?? {};
  const opening = labeled(lines, /^(?:opening balance|begin\s*saldo|vorig saldo|saldo vooraf)\b(?:\s*\(EUR\))?/i, sourceMoney);
  const closing = labeled(lines, /^(?:closing balance|eind\s*saldo|nieuw saldo|saldo achteraf)\b(?:\s*\(EUR\))?/i, sourceMoney);
  if (!account || !openingDate || !closingDate || openingDate > closingDate || opening === undefined ||
    closing === undefined || !/\bEUR\b|€/.test(text) || otherCurrency.test(text)) return null;

  const rows: Statement["rows"] = [];
  const amountColumn = lines.some(line => /^(?:date|datum)\b.*\b(?:amount|bedrag)\b/i.test(line) && !/\b(?:debit|credit|af|bij)\b/i.test(line));
  const twoColumns = lines.some(line => /^(?:date|datum)\b.*\b(?:debit|af)\b.*\b(?:credit|bij)\b/i.test(line));
  for (const line of lines) {
    if (!dated.test(line)) {
      if (/^\d{1,2}[-/.]\d{1,2}\b/.test(line)) return null;
      continue;
    }
    const columns = twoColumns && line.match(debitCredit);
    const signed = !twoColumns && line.match(movement);
    if (!columns && !signed) return null;
    const match = columns || signed;
    if (!match) return null;
    const date = sourceDate(match[1]);
    const description = match[2].trim();
    let amount: string | undefined;
    if (columns) {
      const debit = sourceMoney(columns[3]) ?? "0", credit = sourceMoney(columns[4]) ?? "0";
      if (new Decimal(debit).isZero() === new Decimal(credit).isZero()) return null;
      amount = new Decimal(credit).minus(debit).toFixed(2);
    } else {
      const raw = match[3], direction = raw.match(/\s+(DR|CR|DEBIT|CREDIT|AF|BIJ)$/i)?.[1];
      const numeric = direction ? raw.slice(0, -direction.length).trim() : raw;
      if (!direction && !amountColumn && !/[+−-]/.test(numeric)) return null;
      amount = sourceMoney(numeric);
      if (amount && direction) {
        const outgoing = /^(DR|DEBIT|AF)$/i.test(direction);
        if (/[+−-]/.test(numeric) && new Decimal(amount).isNegative() !== outgoing) return null;
        amount = new Decimal(amount).abs().times(outgoing ? -1 : 1).toFixed(2);
      }
    }
    if (!amount || new Decimal(amount).isZero() || !date || date < openingDate || date > closingDate || !description) return null;
    rows.push({ date, amount, description: description.slice(0, 500), reference: "" });
  }
  if (!rows.length || !rows.reduce((sum, row) => sum.plus(row.amount), new Decimal(opening)).eq(closing)) return null;
  return { account, openingDate, closingDate, opening, closing, rows };
}
