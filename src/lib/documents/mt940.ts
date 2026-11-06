import Decimal from "decimal.js";
import { DomainError } from "../accounting";

export type Statement = {
  account: string;
  opening: string;
  closing: string;
  openingDate: string;
  closingDate: string;
  rows: {
    date: string;
    amount: string;
    reference: string;
    description: string;
  }[];
};
const date = (value: string) => {
  const result = `20${value.slice(0, 2)}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
  const parsed = new Date(`${result}T12:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== result
  )
    throw new DomainError("bankFormat");
  return result;
};
function balance(value: string) {
  const m = value.match(/^([CD])(\d{6})EUR(\d+,\d{0,2})$/);
  if (!m) throw new DomainError("bankFormat");
  return {
    date: date(m[2]),
    amount: new Decimal(m[3].replace(",", "."))
      .mul(m[1] === "D" ? -1 : 1)
      .toFixed(2),
  };
}

// Deliberately bounded: one EUR statement, final opening/closing balances.
// Unknown variants fail explicitly rather than losing rows silently.
export function parseMt940(text: string): Statement {
  const fields = [
    ...text
      .replace(/\r/g, "")
      .matchAll(/^:(\d{2}[A-Z]?):([^]*?)(?=^:\d{2}[A-Z]?:|$(?![^]))/gm),
  ].map((m) => ({ tag: m[1], value: m[2].trim() }));
  const one = (tag: string) => {
    const found = fields.filter((f) => f.tag === tag);
    if (found.length !== 1) throw new DomainError("bankFormat");
    return found[0].value;
  };
  if (fields.some((f) => ["60M", "62M"].includes(f.tag)))
    throw new DomainError("bankFormat");
  const account = one("25"),
    opening = balance(one("60F")),
    closing = balance(one("62F"));
  const rows: Statement["rows"] = [];
  for (const field of fields) {
    if (field.tag === "61") {
      const m = field.value.match(
        /^(\d{6})(\d{4})?(R?[CD])([A-Z])?(\d+,\d{0,2})([A-Z][A-Z0-9]{3})([^\n]*)/,
      );
      if (!m) throw new DomainError("bankFormat");
      const sign =
        (m[3].endsWith("D") ? -1 : 1) * (m[3].startsWith("R") ? -1 : 1);
      // Optional entry date is MMDD; infer year around value date across New Year.
      let booking = date(m[1]);
      if (m[2]) {
        let y = Number(booking.slice(0, 4));
        const month = Number(m[2].slice(0, 2)),
          valueMonth = Number(booking.slice(5, 7));
        if (month - valueMonth > 6) y--;
        else if (valueMonth - month > 6) y++;
        booking = date(`${String(y).slice(2)}${m[2]}`);
      }
      rows.push({
        date: booking,
        amount: new Decimal(m[5].replace(",", ".")).mul(sign).toFixed(2),
        reference: m[7].trim(),
        description: m[7].trim(),
      });
    } else if (field.tag === "86") {
      if (!rows.length) throw new DomainError("bankFormat");
      rows[rows.length - 1].description = field.value
        .replace(/\n/g, " ")
        .slice(0, 500);
    }
  }
  const expected = rows.reduce(
    (s, r) => s.plus(r.amount),
    new Decimal(opening.amount),
  );
  if (!expected.eq(closing.amount)) throw new DomainError("bankBalance");
  return {
    account,
    opening: opening.amount,
    closing: closing.amount,
    openingDate: opening.date,
    closingDate: closing.date,
    rows,
  };
}
