import "server-only";
import { cookies } from "next/headers";
import { requireAccess } from "./access";
import { z } from "zod";
import { db } from "./db";
import type {
  Business,
  Document,
  Journal,
  BankRow,
  Evidence,
  VatReturn,
  Workspace,
} from "../model";
import { DomainError } from "../accounting";

export async function businesses() {
  await requireAccess();
  return (
    await (
      await db()
    ).query<Business>("select * from businesses order by created_at")
  ).rows;
}
export async function currentBusiness(): Promise<Business | null> {
  await requireAccess();
  const selected = (await cookies()).get("business")?.value;
  if (!z.string().uuid().safeParse(selected).success) return null;
  const result = await (await db()).query<Business>("select * from businesses where id=$1", [selected]);
  return result.rows[0] ?? null;
}
export async function needBusiness(form?: FormData) {
  const b = await currentBusiness();
  if (!b) throw new DomainError("business");
  if (form && form.get("businessId") !== b.id) throw new DomainError("workspaceChanged");
  return b;
}
export async function workspace(): Promise<Workspace | null> {
  const business = await currentBusiness();
  if (!business) return null;
  const connection = await db();
  const [documents, entries, bankRows, evidence, vatReturns] = await Promise.all([
    connection.query<Document>(
      "select id,name,kind,status,left(text_content,12000) as text_content,sha256,created_at::text from documents where business_id=$1 order by created_at desc",
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
  ]);
  return {
    business,
    documents: documents.rows,
    entries: entries.rows,
    bankRows: bankRows.rows,
    evidence: evidence.rows,
    vatReturns: vatReturns.rows,
  };
}
export const uuid = (value: unknown) => z.string().uuid().parse(value);
