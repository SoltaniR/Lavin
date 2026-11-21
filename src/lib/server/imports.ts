import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Transaction } from "@electric-sql/pglite";
import { z } from "zod";
import { DomainError } from "../accounting";
import { invoiceReadVersion, isInvoicePurpose, uploadPurposes, type Business, type InvoiceDateAlias, type InvoiceFields } from "../model";
import { normalizedBankAccount } from "../documents/bank-pdf";
import { prepareUpload, type ImportPurpose } from "../documents/prepare";
import { db, dataDir } from "./db";
import { writeActiveReport } from "./workspace";
import { withExchangeRate } from "./invoice-exchange";

export const purposeSchema = z.enum(uploadPurposes);
export const maxUploadBytes = 20 * 1024 * 1024;

async function editableDocument(tx: Transaction, businessId: string, id: string) {
  const { rows: [document] } = await tx.query<{
    sha256: string; status: string; purpose: string | null; in_use: boolean;
  }>(
    "select sha256,status,metadata->>'purpose' as purpose, (" +
    "exists (select 1 from vat_returns where business_id=$1 and source_id=$2) or " +
    "exists (select 1 from entries where business_id=$1 and source_id=$2) or " +
    "exists (select 1 from invoice_drafts where business_id=$1 and document_id=$2 and posted_entry is not null) or " +
    "exists (select 1 from bank_rows where business_id=$1 and document_id=$2 and posted_entry is not null)" +
    ") as in_use from documents where business_id=$1 and id=$2",
    [businessId, id],
  );
  if (!document) throw new DomainError("documentMissing");
  if (document.in_use) throw new DomainError("documentInUse");
  return document;
}

async function clearDocumentImports(tx: Transaction, businessId: string, id: string) {
  await tx.query("delete from invoice_drafts where business_id=$1 and document_id=$2 and posted_entry is null", [businessId, id]);
  await tx.query("delete from bank_rows where business_id=$1 and document_id=$2 and posted_entry is null", [businessId, id]);
}

export async function deleteUnusedDocument(businessId: string, id: string) {
  await writeActiveReport(businessId, async tx => {
    await editableDocument(tx, businessId, id);
    await clearDocumentImports(tx, businessId, id);
    await tx.query("delete from documents where business_id=$1 and id=$2", [businessId, id]);
  });
  // Remove the bytes only after the database has committed the deletion.
  await unlink(path.join(dataDir, "uploads", id)).catch(error => {
    if (error.code !== "ENOENT") console.warn("Could not remove deleted upload bytes.", error.code);
  });
}

export async function importDocument(business: Business, bytes: Buffer, name: string, purpose: ImportPurpose, existing?: {
  id: string;
  reread?: boolean;
}) {
  const existingId = existing?.id;
  const sha = createHash("sha256").update(bytes).digest("hex");
  const connection = await db();
  if (!existingId && (await connection.query(
    "select 1 from documents where business_id=$1 and sha256=$2", [business.id, sha],
  )).rows.length) throw new DomainError("duplicate");

  const { kind, text, status, statement, invoices, vat, purpose: detected, pages, invoiceIssues } = await prepareUpload(bytes, name, purpose);
  const suppliers = [...new Set((invoices ?? []).flatMap(invoice => invoice.dateSuggestion?.supplier ? [invoice.dateSuggestion.supplier.key] : []))];
  const rules = suppliers.length ? (await connection.query<{ supplier_key: string; date_label: InvoiceDateAlias }>(
    "select supplier_key,date_label from invoice_date_rules where supplier_key=any($1::text[])", [suppliers],
  )).rows : [];
  const bySupplier = new Map(rules.map(rule => [rule.supplier_key, rule.date_label]));
  const resolvedInvoices = await Promise.all((invoices ?? []).map(invoice => {
    const suggestion = invoice.dateSuggestion;
    const date = invoice.date ?? (suggestion?.supplier && bySupplier.get(suggestion.supplier.key) === suggestion.label
      ? suggestion.date : undefined);
    return invoice.foreign ? withExchangeRate({ ...invoice, date }, business.profile.year) : { ...invoice, date };
  }));
  const issues = invoiceIssues?.filter(issue =>
    issue === "fxPending" ? resolvedInvoices.some(invoice => invoice.foreign && !invoice.exchange)
      : issue === "missingFields" ? resolvedInvoices.some(invoice => !invoice.date || !invoice.reference ||
        (invoice.foreign ? !invoice.foreign.amount || invoice.foreign.vat === undefined
          : !invoice.amount || invoice.invoiceVat === undefined))
        : true,
  );
  const finalStatus = status === "invoicePartial" && resolvedInvoices.length && !issues?.length ? "invoiceReady" : status;
  if (statement?.rows.some(row => !row.date.startsWith(business.profile.year + "-"))) throw new DomainError("date");
  const id = existingId ?? randomUUID();
  const original = path.join(dataDir, "uploads", id);
  if (!existingId) {
    await mkdir(path.dirname(original), { recursive: true });
    await writeFile(original, bytes, { flag: "wx" });
  }
  try {
    await writeActiveReport(business.id, async tx => {
      let dismissedFields: InvoiceFields[] = [];
      if (existingId) {
        const current = await editableDocument(tx, business.id, existingId);
        if (current.sha256 !== sha) throw new DomainError("documentMissing");
        if (existing?.reread) {
          if (current.purpose !== purpose) throw new DomainError("documentCategoryChanged");
          const dismissed = await tx.query<{ fields: InvoiceFields }>(
            "select fields from invoice_drafts where business_id=$1 and document_id=$2 and dismissed",
            [business.id, id],
          );
          dismissedFields = dismissed.rows.map(row => row.fields);
        } else if (current.purpose === detected && current.status === finalStatus) return;
        await clearDocumentImports(tx, business.id, existingId);
      } else if ((await tx.query(
        "select 1 from documents where business_id=$1 and sha256=$2", [business.id, sha],
      )).rows.length) throw new DomainError("duplicate");

      const metadata = JSON.stringify({
        ...statement, rows: undefined, purpose: detected, pages, vat, invoiceIssues: issues,
        invoiceReadVersion: kind === "pdf" && isInvoicePurpose(detected) ? invoiceReadVersion : undefined,
      });
      if (statement) {
        const previous = await tx.query<{ metadata: { account: string; openingDate: string; closingDate: string } }>(
          "select metadata from documents where business_id=$1 and metadata ? 'account' and id<>$2",
          [business.id, id],
        );
        const account = normalizedBankAccount(statement.account);
        if (previous.rows.some(({ metadata: prior }) =>
          normalizedBankAccount(prior.account) === account &&
          prior.openingDate <= statement.closingDate && prior.closingDate >= statement.openingDate
        )) throw new DomainError("overlap");
      }
      if (existingId) {
        await tx.query("update documents set kind=$1,status=$2,text_content=$3,metadata=$4 where id=$5 and business_id=$6",
          [kind, finalStatus, text.slice(0, 500000), metadata, id, business.id]);
      } else {
        await tx.query(
          "insert into documents(id,business_id,name,kind,status,sha256,text_content,metadata) values($1,$2,$3,$4,$5,$6,$7,$8)",
          [id, business.id, name.slice(0, 200), kind, finalStatus, sha, text.slice(0, 500000), metadata],
        );
      }

      if (statement?.rows.length) {
        const rows = statement.rows.map((row, position) => ({ ...row, id: randomUUID(), position }));
        await tx.query(
          "insert into bank_rows(id,business_id,document_id,booking_date,amount,description,reference,position) " +
          "select id,$1,$2,date,amount,description,reference,position from " +
          "jsonb_to_recordset($3::jsonb) as r(id uuid,date date,amount numeric,description text,reference text,position int)",
          [business.id, id, JSON.stringify(rows)],
        );
      }
      if (resolvedInvoices.length) {
        const rows = resolvedInvoices.map((fields, position) => ({
          id: randomUUID(), fields, position,
          dismissed: dismissedFields.some(prior => prior.page === fields.page && prior.reference === fields.reference),
        }));
        const direction = detected === "sale" || detected === "purchase" ? detected : null;
        await tx.query(
          "insert into invoice_drafts(id,business_id,document_id,direction,position,fields,dismissed) " +
          "select id,$1,$2,$3,position,fields,dismissed from jsonb_to_recordset($4::jsonb) as r(id uuid,position int,fields jsonb,dismissed boolean)",
          [business.id, id, direction, JSON.stringify(rows)],
        );
      }
    });
  } catch (error) {
    if (!existingId) await unlink(original).catch(() => {});
    throw error;
  }
  return { status: finalStatus, purpose: detected };
}
