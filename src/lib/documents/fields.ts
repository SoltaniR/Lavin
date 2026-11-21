import Decimal from "decimal.js";

export function sourceDate(value: string | undefined) {
  const raw = typeof value === "string" ? value.trim() : "";
  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const local = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  const parts = iso ? iso.slice(1) : local ? [local[3], local[2], local[1]] : null;
  if (!parts) return undefined;
  const result = parts.map((part, i) => i ? part.padStart(2, "0") : part).join("-");
  const date = new Date(result + "T12:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === result ? result : undefined;
}

// A grouped amount must include cents so "1,234" cannot be read two ways.
export function sourceMoney(value: string | undefined) {
  if (typeof value !== "string") return undefined;
  const raw = value.trim().replace(/−/g, "-")
    .replace(/^(?:EUR|€)\s*|\s*(?:EUR|€)$/gi, "").trim();
  const compact = raw.replace(/(?<=\d)[ \u00a0\u202f](?=\d)/g, "");
  const normalized = /^[-+]?\d{1,3}(?:\.\d{3})+,\d{2}$/.test(compact)
    ? compact.replaceAll(".", "").replace(",", ".")
    : /^[-+]?\d{1,3}(?:,\d{3})+\.\d{2}$/.test(compact)
      ? compact.replaceAll(",", "")
      : compact.replace(",", ".");
  if (!/^[+-]?\d{1,10}(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  return new Decimal(normalized).toFixed(2);
}

export function labeledValues(lines: string[], label: RegExp, parse: (value: string) => string | undefined) {
  return new Set(lines.flatMap((line, index) => {
    const match = line.match(label);
    const remainder = match && line.slice(match[0].length).replace(/^\s*[:=·]\s*/, "").trim();
    const value = match && parse(remainder || lines[index + 1] || "");
    return value === undefined || value === null ? [] : [value];
  }));
}

export function labeled(lines: string[], label: RegExp, parse: (value: string) => string | undefined) {
  const values = labeledValues(lines, label, parse);
  return values.size === 1 ? values.values().next().value : undefined;
}
