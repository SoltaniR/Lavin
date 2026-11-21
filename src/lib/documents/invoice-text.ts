import { labeled, labeledValues, sourceDate, sourceMoney } from "./fields";
import { invoiceDateAliases, type DateSuggestion, type ForeignAmount } from "../model";
import { exchangeCurrencies } from "./exchange-rates";

export const foldInvoiceText = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i").toLowerCase();

const referenceLabel = /^(?:factuur|invoice|fatura)\s*#|^(?:factuur[\s-]*(?:nummer|nr\.?)|invoice[\s-]*(?:number|no\.?|id)|(?:e[- ]?)?(?:arsiv\s+)?fatura[\s-]*(?:numarasi|no\.?|num\.?))(?=$|[\s:#])|^(?:factuur|invoice|fatura)\s*:/;
const issueDateLabel = /^(?:factuur\s*datum|datum factuur|datum van (?:afgifte|uitgifte)|invoice date|issue date|date of issue|fatura tarihi|duzenleme tarihi)(?=$|[\s:=])/;
const dateLabel = /^(?:datum|date|tarih)(?=$|[\s:=])/;
const netLabel = /^(?:sub[ -]?total|subtotaal|netto totaal|net amount|(?:(?:totaal|total|bedrag)\s+)?excl(?:usief|uding|\.)?\s*(?:btw|vat)|(?:mal\s*(?:\/\s*)?hizmet\s+)?toplam tutar[i]?|ara toplam|kdv haric (?:toplam|tutar))(?=$|[\s:=])/;
const grossLabel = /^(?:(?:(?:totaal(?:bedrag)?|total(?: amount)?)\s*)?(?:incl\.?\s*(?:btw|vat)|inclusief btw|including vat|incl\.?\s*tax)|invoice total|factuurtotaal|totaal factuur|grand total|(?:vergiler|kdv) dahil(?: toplam)?(?: tutar[i]?)?|genel toplam|total|totaal(?:bedrag)?)(?=$|[\s:=€])/;
const taxLabel = /^(?:(?:total|totaal)\s+(?:btw|vat)|(?:btw|vat)[\s-]*(?:totaal|total|bedrag|amount)?|(?:toplam|hesaplanan)\s+kdv(?:\s+tutar[i]?)?|kdv tutar[i]?|kdv)(?=$|[\s:=(%])/;
const titleLabel = /^(?:(?:sales |purchase )?invoice|(?:verkoop|inkoop)?factuur|(?:e[- ]?)?(?:arsiv\s+)?fatura)$/;

export function invoiceReference(lines: string[], index: number) {
  const line = lines[index];
  const match = foldInvoiceText(line).match(referenceLabel);
  if (!match) return undefined;
  const inline = line.slice(match[0].length).replace(/^[\s:#=]+/, "").trim();
  const value = inline || lines[index + 1];
  return value && /^[\p{L}\d][\p{L}\d._/-]{0,79}$/u.test(value) && (inline || /\d/.test(value)) ? value : undefined;
}

const monthNames = [
  "january januari ocak", "february februari subat", "march maart mart", "april nisan",
  "may mei mayis", "june juni haziran", "july juli temmuz", "august augustus agustos",
  "september eylul", "october oktober ekim", "november kasim", "december aralik",
].flatMap((names, index) => names.split(" ").map(name => [name, String(index + 1)] as const));
const months = new Map<string, string>([
  ...monthNames,
  ...monthNames.map(([name, month]) => [name.slice(0, 3), month] as const),
  ["sept", "9"],
]);
const weekday = /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar)\s+/;

export function readPrintedDate(value: string) {
  const text = value.trim().replace(/[\sT]\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm))?$/i, "");
  const numeric = sourceDate(text);
  if (numeric) return numeric;
  // Accept US month/day only when the second number makes the order unambiguous.
  const us = text.match(/^(\d{1,2})\/(1[3-9]|[23]\d)\/(\d{4})$/);
  if (us) return sourceDate([us[3], us[1], us[2]].join("-"));
  const named = foldInvoiceText(text).replace(/[.,]/g, "").replace(weekday, "")
    .match(/^(?:(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)|([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?)\s+(\d{4})$/);
  const month = named && months.get(named[2] ?? named[3]);
  return month && named ? sourceDate([named[5], month, named[1] ?? named[4]].join("-")) : undefined;
}

const currencies = [...exchangeCurrencies, "RUB", "AED", "SAR", "UAH", "TWD", "VND", "NGN", "KES", "ARS", "CLP", "COP", "EGP", "PKR", "MAD"];
const foreignCode = currencies.join("|") + "|TL";
const currencyToken = new RegExp("^(?:" + foreignCode + ")\\s*|\\s*(?:" + foreignCode + ")$", "i");
const currencyAmount = new RegExp("(?:\\b(" + foreignCode + ")\\s*[-+]?\\d|\\d\\s*(" + foreignCode + ")\\b)", "gi");
const readCurrencyCode = (code: string) => code.toUpperCase() === "TL" ? "TRY" : code.toUpperCase();

export function invoiceCurrency(lines: string[]): ForeignAmount | undefined {
  const text = lines.join("\n");
  const header = labeled(lines.map(foldInvoiceText), /^(?:(?:invoice )?currency(?: code)?|valuta|para birimi)(?=$|\s|[:=])/, value =>
    /^[a-z]{3}$/i.test(value) ? readCurrencyCode(value) : undefined,
  );
  if (header) return header === "EUR" ? undefined : { currency: header };
  // A currency printed on the invoice total takes precedence over payment and fee details.
  const totals = labeledValues(lines.map(foldInvoiceText), grossLabel, value => {
    const code = value.match(/^\(([a-z]{3})\)/i)?.[1] ?? value.match(currencyToken)?.[0].trim();
    const currency = code && (currencies.includes(readCurrencyCode(code)) || ["EUR", "TL"].includes(code.toUpperCase())) ? readCurrencyCode(code)
      : /^\s*(?:EUR\b|€)|(?:\bEUR|€)\s*$/i.test(value) ? "EUR"
      : /\bus\$/i.test(value) ? "USD" : /\b(?:ca|c)\$/i.test(value) ? "CAD" : /\b(?:au|a)\$/i.test(value) ? "AUD"
      : /£/.test(value) ? "GBP" : /₺/.test(value) ? "TRY" : /[$¥]/.test(value) ? "ambiguous" : undefined;
    const foreign = currency === "EUR" ? undefined : { currency: currency === "ambiguous" ? undefined : currency };
    return currency && money(value, foreign) !== undefined ? currency : undefined;
  });
  if (totals.size === 1 && totals.has("EUR")) return undefined;
  if (totals.size > 1) return {};
  if (totals.size === 1 && !totals.has("ambiguous")) return { currency: [...totals][0] };
  const codes = new Set([...text.matchAll(currencyAmount)].map(match => readCurrencyCode(match[1] ?? match[2])));
  if (/\bUS\$/i.test(text)) codes.add("USD");
  if (/\b(?:CA|C)\$/i.test(text)) codes.add("CAD");
  if (/\b(?:AU|A)\$/i.test(text)) codes.add("AUD");
  if (/₺/.test(text)) codes.add("TRY");
  if (/£/.test(text)) codes.add("GBP");
  if (codes.size || /[$¥]/.test(text)) return { currency: codes.size === 1 ? [...codes][0] : undefined };
}

function money(value: string, foreign?: ForeignAmount) {
  let amount = value.replace(/^\(\s*(?:EUR|€)\s*\)\s*/i, "");
  if (foreign) {
    if (/€|\bEUR\b/i.test(amount)) return undefined;
    const code = amount.match(/^\(([a-z]{3})\)/i)?.[1] ?? amount.match(currencyToken)?.[0].trim();
    if (code && foreign.currency && readCurrencyCode(code) !== foreign.currency) return undefined;
    amount = amount.replace(/^\([a-z]{3}\)\s*/i, "").replace(currencyToken, "")
      .replace(/^\s*(?:US|CA|AU|C|A)?[$£¥₺]\s*|\s*[$£¥₺]\s*$/gi, "");
  }
  return sourceMoney(amount.replace(/([.,])[-–](?=\s*(?:EUR|€)?$)/i, (_, separator) => separator + "00"));
}
const withoutRate = (amount: string) =>
  amount.replace(/^(?:\(\s*%?\s*\d+(?:[.,]\d+)?\s*%?\s*\)|(?:%\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*%)(?=\s|:))[\s:]*/, "");

export function joinInvoiceColumns(lines: string[]) {
  const result: string[] = [];
  for (let i = 0; i < lines.length;) {
    const start = i;
    while (i < lines.length && /^[\p{L}][\p{L} .#/-]{0,35}:$/u.test(lines[i])) i++;
    const labels = lines.slice(start, i);
    const values = lines.slice(i, i + labels.length);
    // Some PDF exports emit a column of headings followed by a column of values.
    const dateIndex = labels.findIndex(label => issueDateLabel.test(foldInvoiceText(label)) ||
      invoiceDateAliases.includes(foldInvoiceText(label.slice(0, -1)) as DateSuggestion["label"]));
    const referenceIndex = labels.findIndex(label => referenceLabel.test(foldInvoiceText(label)));
    if (labels.length > 1 && referenceIndex >= 0 && dateIndex >= 0 && values.length === labels.length &&
      readPrintedDate(values[dateIndex]) && /^[\p{L}\d][\p{L}\d._/-]{0,79}$/u.test(values[referenceIndex])) {
      result.push(...labels.map((label, index) => label + " " + values[index]));
      i += labels.length;
    } else {
      if (labels.length) result.push(...labels);
      else result.push(lines[i++]);
    }
  }
  return result;
}

function identifySupplier(lines: string[]) {
  // A contact domain corroborated by the issuer's website is used as a stable key.
  const text = lines.join("\n");
  const mail = new Set([...text.matchAll(/\b[\w.+-]+@([a-z\d-]+(?:\.[a-z\d-]+)+)\b/gi)].map(match => match[1].toLowerCase()));
  const web = new Set([...text.matchAll(/https?:\/\/(?:www\.)?([a-z\d-]+(?:\.[a-z\d-]+)+)\b/gi)].map(match => match[1].toLowerCase()));
  const domains = [...mail].filter(domain => web.has(domain));
  if (domains.length !== 1) return undefined;
  const domain = domains[0], brand = domain.split(".")[0];
  const header = lines.slice(0, 12).find(line => foldInvoiceText(line).includes(brand) && !/https?:|@/.test(line));
  if (header) return { key: domain, name: header.split(" - ")[0].slice(0, 90) };
}

export const invoiceTitle = (line: string) => titleLabel.test(foldInvoiceText(line));
export const invoiceIdentityLine = (line: string) => {
  const normalized = foldInvoiceText(line);
  return titleLabel.test(normalized) || referenceLabel.test(normalized) || issueDateLabel.test(normalized);
};
export const invoiceHint = (line: string) => invoiceIdentityLine(line) || grossLabel.test(foldInvoiceText(line));
export const invoiceGross = (lines: string[]) => labeled(lines.map(foldInvoiceText), grossLabel, value => money(value, invoiceCurrency(lines)));
export function readInvoiceFields(lines: string[]) {
  const normalized = lines.map(foldInvoiceText);
  const foreign = invoiceCurrency(lines);
  const date = labeled(normalized, issueDateLabel, readPrintedDate) ?? labeled(normalized, dateLabel, readPrintedDate);
  const alternatives = invoiceDateAliases.flatMap(label => {
    const value = labeled(normalized, new RegExp("^" + label + "(?=$|[\\s:=])"), readPrintedDate);
    return value ? [{ label, date: value }] : [];
  });
  const dateSuggestion = !date && alternatives.length === 1 ? { ...alternatives[0], supplier: identifySupplier(lines) } : undefined;
  const tax = (value: string) => money(withoutRate(value), foreign);
  return {
    date, dateSuggestion, foreign,
    amount: labeled(normalized, grossLabel, value => money(value, foreign)),
    invoiceVat: labeled(normalized, taxLabel, value => /[€$£¥₺%]|\b[A-Z]{3}\b/i.test(value) ? tax(value) : undefined)
      ?? labeled(normalized, taxLabel, tax),
    net: labeled(normalized, netLabel, value => money(value, foreign)),
  };
}

export function invoiceException(lines: string[]) {
  const text = foldInvoiceText(lines.join("\n"));
  if (/\b(?:creditnota|credit note|creditfactuur|reverse charge|btw verlegd|btw-verlegd|iade faturasi|tevkifat)\b/.test(text)) {
    return "special" as const;
  }
}
