import type { VatSuggestion } from "../model";
import { sourceDate, sourceMoney } from "./fields";

export function vatFigures(text: string): VatSuggestion {
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const readBox = (number: string, label: RegExp) => {
    const figures = new Set(lines.flatMap(line => {
      if (!new RegExp("^" + number + "\\b", "i").test(line)) return [];
      const rest = line.slice(number.length).trim().replace(/^(?:[.:]\s*|-\s+)/, "");
      const description = rest.match(label);
      if (!description && !/^[-−€\d]|^EUR\b/i.test(rest)) return [];
      const amount = sourceMoney((description ? rest.slice(description[0].length).replace(/^\s*\([^)]*\)/, "") : rest)
        .replace(/^[\s:=·]+/, ""));
      return amount?.endsWith(".00") ? [amount.slice(0, -3)] : [];
    }));
    return figures.size === 1 ? [...figures][0] : undefined;
  };
  const periods = new Set([...text.matchAll(/\b(?:[QK]([1-4])\s+(20\d{2})|([1-4])(?:e|de|ste|st|nd|rd|th)?\s+(?:kwartaal|quarter)\s+(20\d{2})|(?:quarter|kwartaal)\s+([1-4])\s+(20\d{2}))\b/gi)]
    .map(match => (match[1] ?? match[3] ?? match[5]) + ":" + (match[2] ?? match[4] ?? match[6])));
  const dateRange = /^(?:tijdvak|tax period|aangiftetijdvak)\s*:?\s*([\d./-]+)\s*(?:t\/m|tot(?: en met)?|to|–|—)\s*([\d./-]+)$/i;
  for (const line of lines) {
    const match = dateRange.exec(line);
    if (!match) continue;
    const start = sourceDate(match[1]), end = sourceDate(match[2]);
    if (!start || !end) continue;
    const year = Number(start.slice(0, 4));
    const month = Number(start.slice(5, 7));
    if ((month - 1) % 3 === 0 && start.endsWith("-01") &&
      end === new Date(Date.UTC(year, month + 2, 0)).toISOString().slice(0, 10)) {
      periods.add(((month + 2) / 3) + ":" + year);
    }
  }
  const [quarter, year] = periods.size === 1 ? [...periods][0].split(":").map(Number) : [];
  return {
    quarter, year,
    output: readBox("5a", /^(?:verschuldigde (?:btw|omzetbelasting)|btw verschuldigd|vat due|output vat)\b/i),
    input: readBox("5b", /^(?:voorbelasting|aftrekbare (?:btw|omzetbelasting)|input vat|vat deductible)\b/i),
  };
}
