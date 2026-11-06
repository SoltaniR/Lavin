import { workspace } from "@/lib/server/workspace";
const cell = (value: string) =>
  `"${(/^[=+\-@\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
export async function GET() {
  try {
    const w = await workspace();
    if (!w) return new Response(null, { status: 404 });
    const rows = [
      [
        "date",
        "description",
        "account",
        "debit_EUR",
        "credit_EUR",
        "entry_id",
        "source_document_id",
      ],
      ...w.entries.flatMap((e) =>
        e.lines.map((l) => [
          e.entry_date,
          e.description,
          l.account,
          l.debit,
          l.credit,
          e.id,
          e.source_id ?? "",
        ]),
      ),
    ];
    return new Response(
      "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n"),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="lavin-journal-${w.business.profile.year}.csv"`,
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch {
    return new Response(null, { status: 403 });
  }
}
