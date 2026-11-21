import Decimal from "decimal.js";
import { parse } from "csv-parse/sync";
import type { InvoiceFields, InvoiceRate } from "../model";

export const exchangeCurrencies = [
  "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "GBP", "HKD", "HUF", "IDR", "ILS", "INR",
  "ISK", "JPY", "KRW", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB",
  "TRY", "USD", "ZAR",
] as const;

export function selectEcbRate(csv: string, currency: string, invoiceDate: string): InvoiceRate | undefined {
  const rows = parse(csv, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  const earlier = rows.filter(row => row.CURRENCY === currency && row.CURRENCY_DENOM === "EUR" &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.TIME_PERIOD) && row.TIME_PERIOD <= invoiceDate &&
    /^\d+(?:\.\d+)?$/.test(row.OBS_VALUE) && new Decimal(row.OBS_VALUE).gt(0));
  const row = earlier.reduce<Record<string, string> | undefined>(
    (best, row) => !best || best.TIME_PERIOD < row.TIME_PERIOD ? row : best, undefined,
  );
  if (!row || (Date.parse(invoiceDate) - Date.parse(row.TIME_PERIOD)) / 86400000 > 7) return undefined;
  return { invoiceDate, date: row.TIME_PERIOD, unitsPerEuro: row.OBS_VALUE, currency };
}

export function convertInvoice(fields: InvoiceFields, exchange: InvoiceRate): InvoiceFields {
  const foreign = fields.foreign;
  if (!foreign?.amount || foreign.currency !== exchange.currency || fields.date !== exchange.invoiceDate) return fields;
  const convert = (amount: string) => new Decimal(amount).dividedBy(exchange.unitsPerEuro).toFixed(2, Decimal.ROUND_HALF_UP);
  const amount = convert(foreign.amount);
  if (new Decimal(amount).isZero() || !/^\d{1,10}\.\d{2}$/.test(amount)) return fields;
  return { ...fields, amount, invoiceVat: foreign.vat === undefined ? undefined : convert(foreign.vat), exchange };
}
