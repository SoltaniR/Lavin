import Decimal from "decimal.js";
import { parse } from "csv-parse/sync";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { DomainError } from "../accounting";
import type { InvoiceFields, InvoiceIssue } from "../model";
import { sourceDate, sourceMoney } from "./fields";
import { invoiceException, invoiceGross, invoiceHint, invoiceReference, invoiceTitle, readInvoiceFields } from "./invoice-text";

function checked(fields: InvoiceFields, net?: string) {
  const { amount, invoiceVat } = fields;
  if ((amount && new Decimal(amount).lte(0)) || (invoiceVat && new Decimal(invoiceVat).lt(0))) return null;
  if (amount && invoiceVat && (new Decimal(invoiceVat).gte(amount) || (net && !new Decimal(net).plus(invoiceVat).eq(amount)))) {
    return { ...fields, amount: undefined, invoiceVat: undefined };
  }
  return fields;
}

export function pdfInvoices(pages: { num: number; text: string }[]) {
  const blocks: { page: number; lastPage: number; reference?: string; lines: string[] }[] = [];
  const issues = new Set<InvoiceIssue>();
  for (const page of pages) {
    const lines = page.text.normalize("NFC").split(/\r?\n|\t+/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) { issues.add("unreadable"); continue; }
    const starts = lines.flatMap((line, i) => {
      const reference = invoiceReference(lines, i);
      return reference ? [{ i, reference }] : [];
    });
    const title = lines.findIndex(invoiceTitle);
    if (!starts.length) {
      const current = blocks.at(-1);
      if (current && title < 0) { current.lines.push(...lines); current.lastPage = page.num; }
      else if (lines.some(invoiceHint)) {
        blocks.push({ page: page.num, lastPage: page.num, lines });
      } else issues.add("layout");
      continue;
    }
    let offset = 0;
    for (const [index, start] of starts.entries()) {
      const next = starts[index + 1];
      const nextTitle = next ? lines.findIndex((line, i) => i > start.i && i < next.i && invoiceTitle(line)) : -1;
      const end = next ? (nextTitle >= 0 ? nextTitle : next.i) : lines.length;
      const current = blocks.at(-1);
      const section = lines.slice(offset, end);
      const repeatedHeader = current?.reference === start.reference &&
        !(section.some(invoiceTitle) && invoiceGross(section) && invoiceGross(current.lines));
      if (repeatedHeader) {
        current.lines.push(...section);
        current.lastPage = page.num;
      } else blocks.push({ page: page.num, lastPage: page.num, reference: start.reference, lines: section });
      offset = end;
    }
  }
  const invoices = blocks.flatMap(({ lines, page, lastPage, reference }) => {
    const exception = invoiceException(lines);
    if (exception) { issues.add(exception); return []; }
    const { date, amount, invoiceVat, net } = readInvoiceFields(lines);
    const fields = checked({ page, lastPage, reference, date, amount, invoiceVat }, net);
    if (!fields) { issues.add("special"); return []; }
    if (amount && !fields.amount) issues.add("totalsConflict");
    else if (!fields.date || !fields.amount || fields.invoiceVat === undefined || !reference) issues.add("missingFields");
    return [fields];
  });
  return { invoices, skipped: issues.size > 0, issues: [...issues] };
}

export function ublInvoice(text: string): InvoiceFields {
  if (/<!(?:DOCTYPE|ENTITY)\b/i.test(text) || XMLValidator.validate(text) !== true) throw new DomainError("invoiceXml");
  const { Invoice } = new XMLParser({ removeNSPrefix: true, parseTagValue: false, processEntities: false }).parse(text);
  if (!Invoice || Invoice.DocumentCurrencyCode !== "EUR" || ["381", "384"].includes(Invoice.InvoiceTypeCode)) throw new DomainError("invoiceXml");
  const taxes = (Array.isArray(Invoice.TaxTotal) ? Invoice.TaxTotal : [Invoice.TaxTotal]).filter(Boolean);
  const reference = typeof Invoice.ID === "string" ? Invoice.ID.slice(0, 120) : undefined;
  const date = sourceDate(Invoice.IssueDate);
  const total = Invoice.LegalMonetaryTotal;
  const fields = checked({
    reference, date, amount: sourceMoney(total?.TaxInclusiveAmount),
    invoiceVat: taxes.length === 1 ? sourceMoney(taxes[0]?.TaxAmount) : undefined,
  }, sourceMoney(total?.TaxExclusiveAmount));
  if (!fields || !reference || !date || !fields.amount) throw new DomainError("invoiceXml");
  return fields;
}

export function csvInvoices(text: string) {
  const header = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
  try {
    const rows = parse(text, {
      bom: true, trim: true, skip_empty_lines: true, delimiter: header.includes(";") ? ";" : ",",
      columns: headers => {
        const keys = headers.map((name: string) => name.toLowerCase());
        if (new Set(keys).size !== keys.length || !["reference", "date", "total", "vat"].every(key => keys.includes(key))) throw new Error();
        return keys;
      },
    }) as Record<string, string>[];
    if (!rows.length || rows.length > 1000) throw new Error();
    if (rows.some(row => row.currency && row.currency.toUpperCase() !== "EUR")) throw new Error();
    const invoices = rows.map((row, index) => checked({
      reference: row.reference.slice(0, 120),
      date: sourceDate(row.date),
      amount: sourceMoney(row.total),
      invoiceVat: sourceMoney(row.vat),
      description: row.description?.slice(0, 240),
      row: index + 2,
    }));
    if (invoices.some(fields => !fields?.reference || !fields.date || !fields.amount || !fields.invoiceVat)) throw new Error();
    return invoices as InvoiceFields[];
  } catch { throw new DomainError("invoiceCsv"); }
}
