import "server-only";
import { cookies } from "next/headers";
import { requireAccess } from "./access";
import { z } from "zod";
import type { Transaction } from "@electric-sql/pglite";
import { db } from "./db";
import type {
  Business,
  Document,
  Journal,
  BankRow,
  Evidence,
  VatReturn,
  InvoiceDraft,
  Workspace,
} from "../model";
import { DomainError } from "../accounting";

export type SavedReport = Business & { trashed_at: string | null };

export async function businesses(trashed = false) {
  await requireAccess();
  const result = await (await db()).query<SavedReport>(
    `select id,profile,created_at::text,trashed_at::text from businesses
     where (trashed_at is not null) = $1 order by trashed_at desc nulls last, created_at desc, id`,
    [trashed],
  );
  return result.rows;
}
export async function currentBusiness(reportId?: string): Promise<Business | null> {
  await requireAccess();
  const selected = reportId ?? (await cookies()).get("business")?.value;
  if (!z.string().uuid().safeParse(selected).success) return null;
  const result = await (await db()).query<Business>(
    "select id,profile,created_at from businesses where id=$1 and trashed_at is null",
    [selected],
  );
  return result.rows[0] ?? null;
}

export async function writeActiveReport<T>(id: string, work: (tx: Transaction) => Promise<T>) {
  return (await db()).transaction(async tx => {
    // The same row is updated by Trash and Restore. A save either completes
    // before the report moves to Trash or sees that it is no longer active.
    const active = await tx.query("select id from businesses where id=$1 and trashed_at is null for update", [id]);
    if (!active.rows.length) throw new DomainError("reportUnavailable");
    return work(tx);
  });
}
export async function needBusiness(form?: FormData) {
  const b = await currentBusiness();
  if (!b) throw new DomainError("business");
  if (form && form.get("businessId") !== b.id) throw new DomainError("workspaceChanged");
  return b;
}
export async function workspace(reportId?: string): Promise<Workspace | null> {
  const business = await currentBusiness(reportId);
  if (!business) return null;
  const connection = await db();
  const [documents, entries, bankRows, evidence, vatReturns, invoiceDrafts] = await Promise.all([
    connection.query<Document>(
      "select id,name,kind,status,left(text_content,12000) as text_content,sha256,created_at::text," +
      "metadata->>'purpose' as purpose,metadata->'vat' as vat_suggestion,metadata->'invoiceIssues' as invoice_issues," +
      "metadata->'invoiceReadVersion' as invoice_read_version from documents where business_id=$1 order by created_at desc, id",
      [business.id],
    ),
    connection.query<Journal>(
      `select e.id,e.entry_date::text,e.description,e.kind,e.source_id,
      jsonb_agg(jsonb_build_object('account',l.account,'debit',l.debit::text,'credit',l.credit::text) order by l.id) as lines
      from entries e join lines l on l.entry_id=e.id where e.business_id=$1 group by e.id order by e.entry_date,e.created_at`,
      [business.id],
    ),
    connection.query<BankRow>(
      "select id,document_id,booking_date::text,amount::text,description,reference,posted_entry from bank_rows where business_id=$1 order by booking_date,position",
      [business.id],
    ),
    connection.query<Evidence>(
      "select requirement,note from evidence where business_id=$1",
      [business.id],
    ),
    connection.query<VatReturn>(
      "select quarter,source_id,filed_output::text,filed_input::text,note from vat_returns where business_id=$1 order by quarter",
      [business.id],
    ),
    connection.query<InvoiceDraft>(
      "select id,document_id,direction,fields,posted_entry from invoice_drafts where business_id=$1 and not dismissed order by document_id,position",
      [business.id],
    ),
  ]);
  return {
    business,
    documents: documents.rows,
    entries: entries.rows,
    bankRows: bankRows.rows,
    evidence: evidence.rows,
    vatReturns: vatReturns.rows,
    invoiceDrafts: invoiceDrafts.rows,
  };
}
export const uuid = (value: unknown) => z.string().uuid().parse(value);
