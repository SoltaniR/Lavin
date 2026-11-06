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
  const list = await businesses();
  const selected = (await cookies()).get("business")?.value;
  return list.find((b) => b.id === selected) ?? null;
}
export async function needBusiness() {
  const b = await currentBusiness();
  if (!b) throw new DomainError("business");
  return b;
}
export async function workspace(): Promise<Workspace | null> {
  const business = await currentBusiness();
  if (!business) return null;
  const connection = await db();
  const [documents, entries, bankRows, evidence] = await Promise.all([
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
  ]);
  return {
    business,
    documents: documents.rows,
    entries: entries.rows,
    bankRows: bankRows.rows,
    evidence: evidence.rows,
  };
}
export const uuid = (value: unknown) => z.string().uuid().parse(value);
