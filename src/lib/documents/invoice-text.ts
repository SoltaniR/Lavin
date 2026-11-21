import { labeled, sourceDate, sourceMoney } from "./fields";

export const foldInvoiceText = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i").toLowerCase();

const referenceLabel = /^(?:factuur[\s-]*(?:nummer|nr\.?|#)|invoice[\s-]*(?:number|no\.?|#|id)|(?:e[- ]?)?(?:arsiv\s+)?fatura[\s-]*(?:numarasi|no\.?|num\.?))(?=$|[\s:#])|^(?:factuur|invoice|fatura)\s*:/;
const issueDateLabel = /^(?:factuur\s*datum|datum factuur|invoice date|issue date|date of issue|fatura tarihi|duzenleme tarihi)(?=$|[\s:=])/;
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
]);

function invoiceDate(value: string) {
  const text = value.trim().replace(/[\sT]\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm))?$/i, "");
  const numeric = sourceDate(text);
  if (numeric) return numeric;
  // Accept US month/day only when the second number makes the order unambiguous.
  const us = text.match(/^(\d{1,2})\/(1[3-9]|[23]\d)\/(\d{4})$/);
  if (us) return sourceDate([us[3], us[1], us[2]].join("-"));
  const named = foldInvoiceText(text).replace(/[.,]/g, "").match(/^(?:(\d{1,2})\s+([a-z]+)|([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?)\s+(\d{4})$/);
  const month = named && months.get(named[2] ?? named[3]);
  return month && named ? sourceDate([named[5], month, named[1] ?? named[4]].join("-")) : undefined;
}

const money = (amount: string) => sourceMoney(amount
  .replace(/^\(\s*(?:EUR|€)\s*\)\s*/i, "")
  .replace(/([.,])[-–](?=\s*(?:EUR|€)?$)/i, (_, separator) => separator + "00"));
const vatMoney = (amount: string) =>
  money(amount.replace(/^(?:\(\s*%?\s*\d+(?:[.,]\d+)?\s*%?\s*\)|(?:%\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*%)(?=\s|:))[\s:]*/, ""));

export const invoiceTitle = (line: string) => titleLabel.test(foldInvoiceText(line));
export const invoiceIdentityLine = (line: string) => {
  const normalized = foldInvoiceText(line);
  return titleLabel.test(normalized) || referenceLabel.test(normalized) || issueDateLabel.test(normalized);
};
export const invoiceHint = (line: string) => invoiceIdentityLine(line) || grossLabel.test(foldInvoiceText(line));
export const invoiceGross = (lines: string[]) => labeled(lines.map(foldInvoiceText), grossLabel, money);
export function readInvoiceFields(lines: string[]) {
  const normalized = lines.map(foldInvoiceText);
  return {
    date: labeled(normalized, issueDateLabel, invoiceDate) ?? labeled(normalized, dateLabel, invoiceDate),
    amount: labeled(normalized, grossLabel, money),
    invoiceVat: labeled(normalized, taxLabel, vatMoney),
    net: labeled(normalized, netLabel, money),
  };
}

export function invoiceException(lines: string[]) {
  const text = foldInvoiceText(lines.join("\n"));
  if (/\b(?:try|tl|usd|gbp|chf|jpy|cad|aud|sek|nok|pln|dkk|cny|rub|inr)\b(?=\s*[-+]?\d)|\d\s*(?:try|tl|usd|gbp|chf|jpy|cad|aud|sek|nok|pln|dkk|cny|rub|inr)\b|[₺$£¥]|(?:currency|valuta|para birimi)\s*[:=]\s*(?!eur\b|euro\b)[a-z]{3}\b/m.test(text)) {
    return "nonEur" as const;
  }
  if (/\b(?:creditnota|credit note|creditfactuur|reverse charge|btw verlegd|btw-verlegd|iade faturasi|tevkifat)\b/.test(text)) {
    return "special" as const;
  }
}
