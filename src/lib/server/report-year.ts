import "server-only";
import type { Transaction } from "@electric-sql/pglite";
import { DomainError } from "../accounting";
import type { BankRow, Business, Document, InvoiceDraft, InvoiceFields, Profile, VatReturn } from "../model";
import { yearConflicts } from "../report-intake";
import { db } from "./db";
import { withExchangeRate } from "./invoice-exchange";
import { writeActiveReport } from "./workspace";

export async function openInvoiceDrafts(business: Business, id?: string) {
  return (await (await db()).query<InvoiceDraft>(
    "select id,document_id,direction,fields,posted_entry from invoice_drafts where business_id=$1 and not dismissed and posted_entry is null " +
    "and ($2::uuid is null or id=$2)",
    [business.id, id ?? null],
  )).rows;
}

export async function saveDraftFields(tx: Transaction, businessId: string, drafts: { draft: InvoiceDraft; fields: InvoiceFields }[]) {
  if (!drafts.length) return 0;
  const rows = drafts.map(({ draft, fields }) => ({ id: draft.id, prior: draft.fields, fields }));
  const result = await tx.query(
    "update invoice_drafts d set fields=r.fields from jsonb_to_recordset($2::jsonb) as r(id uuid,prior jsonb,fields jsonb) " +
    "where d.business_id=$1 and d.id=r.id and d.fields=r.prior and d.posted_entry is null and not d.dismissed returning d.id",
    [businessId, JSON.stringify(rows)],
  );
  return result.rows.length;
}

export async function pendingConversions(business: Business, year = business.profile.year) {
  const open = await openInvoiceDrafts(business);
  const eligible = open.filter(({ fields }) => fields.foreign && !fields.exchange && fields.date?.startsWith(year + "-"));
  const resolved = await Promise.all(eligible.map(async draft => ({ draft, fields: await withExchangeRate(draft.fields, year) })));
  return resolved.filter(({ fields }) => fields.exchange);
}

export async function correctReportYear(business: Business, target: Profile["year"]) {
  const changes = await pendingConversions(business, target);
  await writeActiveReport(business, async tx => {
    const [entries, bank, vat, documents] = await Promise.all([
      tx.query("select 1 from entries where business_id=$1 limit 1", [business.id]),
      tx.query<Pick<BankRow, "document_id" | "booking_date">>(
        "select distinct document_id, booking_date::text from bank_rows where business_id=$1 and extract(year from booking_date)<>$2",
        [business.id, target],
      ),
      tx.query<Pick<VatReturn, "quarter" | "source_id">>("select quarter,source_id from vat_returns where business_id=$1", [business.id]),
      tx.query<Pick<Document, "id" | "text_content" | "vat_suggestion">>(
        "select d.id,d.text_content,d.metadata->'vat' as vat_suggestion from vat_returns v join documents d " +
        "on d.id=v.source_id and d.business_id=v.business_id where v.business_id=$1", [business.id],
      ),
    ]);
    const conflicts = yearConflicts({ entries: entries.rows, bankRows: bank.rows, vatReturns: vat.rows, documents: documents.rows }, target);
    if (conflicts.posted || conflicts.bank || conflicts.vat) throw new DomainError("reportYearBlocked");
    await tx.query("update businesses set profile=jsonb_set(profile,'{year}',to_jsonb($2::int)) where id=$1", [business.id, target]);
    await saveDraftFields(tx, business.id, changes);
  });
}
