import "server-only";
import type { InvoiceFields } from "../model";
import { convertInvoice, exchangeCurrencies, selectEcbRate } from "../documents/exchange-rates";

const feeds = new Map<string, { until: number; data: Promise<string> }>();

function ecbFeed(currency: string, year: number) {
  const key = currency + ":" + year;
  const cached = feeds.get(key);
  if (cached && cached.until > Date.now()) return cached.data;
  const url = new URL("https://data-api.ecb.europa.eu/service/data/EXR/D." + currency + ".EUR.SP00.A");
  // A single request covers the year and the last week of the previous year.
  url.searchParams.set("startPeriod", (year - 1) + "-12-25");
  url.searchParams.set("endPeriod", year + "-12-31");
  url.searchParams.set("format", "csvdata");
  const data = fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" }).then(response => {
    if (!response.ok) throw new Error("Exchange rate feed unavailable");
    return response.text();
  }).catch(error => { feeds.delete(key); throw error; });
  feeds.set(key, { until: Date.now() + 60 * 60 * 1000, data });
  return data;
}

export async function withExchangeRate(fields: InvoiceFields, year: number) {
  const currency = exchangeCurrencies.find(code => code === fields.foreign?.currency);
  if (!currency || !fields.foreign?.amount || !fields.date?.startsWith(year + "-") ||
    fields.date > new Date().toISOString().slice(0, 10)) return fields;
  try {
    const rate = selectEcbRate(await ecbFeed(currency, year), currency, fields.date);
    return rate ? convertInvoice(fields, rate) : fields;
  } catch { return fields; }
}
