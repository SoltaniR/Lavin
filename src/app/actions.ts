"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Decimal from "decimal.js";
import { z } from "zod";
import { db, dataDir } from "@/lib/server/db";
import { needBusiness, uuid, writeActiveReport } from "@/lib/server/workspace";
import { requireAccess } from "@/lib/server/access";
import {
  profileSchema,
  defaultProfile,
  requirements,
  isInvoicePurpose,
  type Profile,
} from "@/lib/model";
import {
  entrySchema,
  buildLines,
  DomainError,
  type EntryInput,
} from "@/lib/accounting";
import { deleteUnusedDocument, importDocument, maxUploadBytes, purposeSchema } from "@/lib/server/imports";
import { vatFigures } from "@/lib/documents/vat-pdf";
import { filedReturnSchema, isInvoiceOriginal } from "@/lib/vat";

export type ActionState = { error?: string; success?: boolean };
export type ReportTrashState = ActionState & {
  changed?: { id: string; name: string; year: number; trashed: boolean };
};
async function run(work: () => Promise<void>): Promise<ActionState> {
  try {
    await requireAccess();
    await work();
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: "validation" };
    // Do not expose parser/SQL details or raw financial data to the browser/logs.
    return { error: "unexpected" };
  }
}
export async function setLocale(form: FormData) {
  await requireAccess();
  const locale = form.get("locale") === "nl" ? "nl" : "en";
  (await cookies()).set("locale", locale, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
  });
  revalidatePath("/");
}
export async function selectBusiness(_: ActionState, form: FormData) {
  return run(async () => {
    const id = uuid(form.get("business"));
    if (!(await (await db()).query("select id from businesses where id=$1 and trashed_at is null", [id])).rows.length)
      throw new DomainError("reportUnavailable");
    (await cookies()).set("business", id, {
      httpOnly: true, sameSite: "strict", path: "/",
    });
  });
}
export async function setReportTrash(_: ReportTrashState, form: FormData): Promise<ReportTrashState> {
  let changed: ReportTrashState["changed"];
  const result = await run(async () => {
    const id = uuid(form.get("business"));
    const trashed = z.enum(["trash", "restore"]).parse(form.get("intent")) === "trash";
    const updated = await (await db()).query<{ profile: Profile }>(
      `update businesses set trashed_at = case when $2::boolean then now() else null end
       where id=$1 and (trashed_at is null) = $2 returning profile`,
      [id, trashed],
    );
    const profile = updated.rows[0]?.profile;
    if (!profile) throw new DomainError("reportUnavailable");
    const jar = await cookies();
    if (trashed && jar.get("business")?.value === id) jar.delete("business");
    changed = { id, name: profile.name, year: profile.year, trashed };
  });
  return { ...result, changed };
}
export async function saveProfile(_: ActionState, form: FormData) {
  return run(async () => {
    const raw = Object.fromEntries(form);
    const flags = [
      "cash",
      "stock",
      "equipment",
      "premises",
      "staff",
      "loans",
      "firstYear",
    ];
    const profile = profileSchema.parse({
      ...raw,
      ...Object.fromEntries(flags.map((k) => [k, form.get(k) === "on"])),
    });
    const existing = form.get("id");
    const connection = await db();
    if (existing) {
      const business = await needBusiness();
      if (business.id !== existing) throw new DomainError("business");
      if (profile.year !== business.profile.year) throw new DomainError("year");
      await writeActiveReport(business.id, tx => tx.query("update businesses set profile=$1 where id=$2", [
        JSON.stringify(profile),
        business.id,
      ]));
    } else {
      const id = randomUUID();
      await connection.query(
        "insert into businesses(id,profile) values($1,$2)",
        [id, JSON.stringify(profile)],
      );
      (await cookies()).set("business", id, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
      });
    }
  });
}
export async function saveEntry(_: ActionState, form: FormData) {
  return run(async () => {
    const b = await needBusiness(form),
      input = entrySchema.parse(Object.fromEntries(form));
    const lines = buildLines(input, b.profile.year);
    const draftId = form.has("draftId") ? uuid(form.get("draftId")) : null;
    await writeActiveReport(b.id, async tx => {
      if (draftId) {
        if (input.kind !== "sale" && input.kind !== "purchase") throw new DomainError("validation");
        const { rows: [draft] } = await tx.query<{ document_id: string; reference: string | null; kind: string }>(
          "select d.document_id,d.fields->>'reference' as reference,o.kind from invoice_drafts d join documents o on o.id=d.document_id " +
          "where d.id=$1 and d.business_id=$2 and d.posted_entry is null and not d.dismissed",
          [draftId, b.id],
        );
        if (!draft) throw new DomainError("draftDone");
        if (draft.document_id !== input.sourceId) {
          if (draft.kind !== "csv") throw new DomainError("sourceUsed");
          const { rows: [original] } = await tx.query<Parameters<typeof isInvoiceOriginal>[0]>(
            "select d.kind,d.metadata->>'purpose' as purpose from documents d where d.id=$1 and d.business_id=$2 " +
            "and not exists (select 1 from vat_returns v where v.business_id=$2 and v.source_id=d.id)",
            [input.sourceId || null, b.id],
          );
          if (!original || !isInvoiceOriginal(original)) throw new DomainError("sourceUsed");
        }
        if (draft.reference && !form.has("confirmDuplicate")) {
          const existing = await tx.query(
            "select 1 from invoice_drafts d join entries e on e.id=d.posted_entry " +
            "where d.business_id=$1 and d.direction=$2 and lower(d.fields->>'reference')=lower($3) " +
            "and e.entry_date=$4 and (select max(greatest(debit,credit)) from lines where entry_id=e.id)=$5::numeric limit 1",
            [b.id, input.kind, draft.reference, input.date, input.amount],
          );
          if (existing.rows.length) throw new DomainError("invoiceDuplicate");
        }
      }
      const { rows: [entry] } = await tx.query<{ post_entry: string }>("select post_entry($1,$2,$3,$4,$5,$6,$7,$8)", [
        randomUUID(), b.id, input.date, input.description, input.kind, draftId ?? input.requestKey,
        input.sourceId || null, JSON.stringify(lines),
      ]);
      if (draftId) await tx.query(
        "update invoice_drafts set posted_entry=$1,direction=$2 where id=$3 and business_id=$4",
        [entry.post_entry, input.kind, draftId, b.id],
      );
    });
  });
}
export async function dismissInvoice(_: ActionState, form: FormData) {
  return run(async () => {
    const b = await needBusiness(form), draft = uuid(form.get("draftId"));
    const updated = await writeActiveReport(b.id, tx => tx.query(
      "update invoice_drafts set dismissed=true where business_id=$1 and id=$2 and posted_entry is null and not dismissed returning id",
      [b.id, draft],
    ));
    if (!updated.rows.length) throw new DomainError("draftDone");
  });
}
export async function saveEvidence(_: ActionState, form: FormData) {
  return run(async () => {
    const b = await needBusiness(form),
      requirement = z.string().parse(form.get("requirement"));
    if (!requirements(b.profile).includes(requirement))
      throw new DomainError("validation");
    const note = z.string().trim().min(5).max(2000).parse(form.get("note"));
    await writeActiveReport(b.id, tx => tx.query(
      `insert into evidence(business_id,requirement,note) values($1,$2,$3)
      on conflict(business_id,requirement) do update set note=$3,updated_at=now()`,
      [b.id, requirement, note],
    ));
  });
}
export async function saveVatReturn(_: ActionState, form: FormData) {
  return run(async () => {
    const b = await needBusiness(form);
    const filed = filedReturnSchema.parse(Object.fromEntries(form));
    await writeActiveReport(b.id, async tx => {
      const { rows: [source] } = await tx.query<{ purpose: string | null; text_content: string }>(
        "select metadata->>'purpose' as purpose,text_content from documents where business_id=$1 and id=$2 and kind='pdf'",
        [b.id, filed.sourceId],
      );
      if (!source || (source.purpose && source.purpose !== "vat" && source.purpose !== "evidence")) throw new DomainError("vatSource");
      const otherPeriod = await tx.query(
        "select quarter from vat_returns where business_id=$1 and source_id=$2 and quarter<>$3",
        [b.id, filed.sourceId, filed.quarter],
      );
      if (otherPeriod.rows.length) throw new DomainError("vatSourcePeriod");
      const { quarter, year } = vatFigures(source.text_content);
      if ((year && year !== b.profile.year) || (quarter && quarter !== filed.quarter)) throw new DomainError("vatWrongPeriod");
      const saved = await tx.query(
        `insert into vat_returns(business_id,quarter,source_id,filed_output,filed_input,note)
         select business_id,$2::smallint,id,$4::bigint,$5::bigint,$6 from documents where business_id=$1 and id=$3 and kind='pdf'
         on conflict(business_id,quarter) do update set
           source_id=excluded.source_id,filed_output=excluded.filed_output,
           filed_input=excluded.filed_input,note=excluded.note,updated_at=now()
         returning quarter`,
        [b.id, filed.quarter, filed.sourceId, filed.filedOutput, filed.filedInput, filed.note],
      );
      if (!saved.rows.length) throw new DomainError("vatSource");
    });
  });
}
export async function uploadDocument(_: ActionState, form: FormData) {
  let imported: Awaited<ReturnType<typeof importDocument>> | undefined;
  const result = await run(async () => {
    const b = await needBusiness(form), file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > maxUploadBytes) throw new DomainError("fileSize");
    const purpose = purposeSchema.parse(form.get("purpose") ?? "auto");
    imported = await importDocument(b, Buffer.from(await file.arrayBuffer()), file.name, purpose);
  });
  return { ...result, imported };
}
export async function changeDocumentCategory(_: ActionState, form: FormData) {
  return run(async () => {
    const b = await needBusiness(form), id = uuid(form.get("documentId"));
    const reread = form.get("reread") === "invoice";
    const { rows: [document] } = await (await db()).query<{ name: string; kind: string; purpose: string | null }>(
      "select name,kind,metadata->>'purpose' as purpose from documents where business_id=$1 and id=$2",
      [b.id, id],
    );
    if (!document) throw new DomainError("documentMissing");
    if (reread && (document.kind !== "pdf" || !isInvoicePurpose(document.purpose))) throw new DomainError("documentCategoryChanged");
    const purpose = reread && isInvoicePurpose(document.purpose) ? document.purpose : purposeSchema.parse(form.get("purpose"));
    const bytes = await readFile(path.join(dataDir, "uploads", id)).catch(error => {
      if (error.code === "ENOENT") throw new DomainError("documentMissing");
      throw error;
    });
    await importDocument(b, bytes, document.name, purpose, { id, reread });
  });
}
export async function removeDocument(_: ActionState, form: FormData) {
  return run(async () => {
    const b = await needBusiness(form);
    await deleteUnusedDocument(b.id, uuid(form.get("documentId")));
  });
}
export async function postBankRow(_: ActionState, form: FormData) {
  return run(async () => {
    const b = await needBusiness(form),
      id = uuid(form.get("rowId")),
      counterpart = z.string().parse(form.get("account"));
    if (counterpart === "bank") throw new DomainError("account");
    await writeActiveReport(b.id, async tx => {
      const row = (
        await tx.query<{
          booking_date: string;
          amount: string;
          description: string;
          document_id: string;
          posted_entry: string | null;
        }>(
          "select booking_date::text,amount::text,description,document_id,posted_entry from bank_rows where id=$1 and business_id=$2 for update",
          [id, b.id],
        )
      ).rows[0];
      if (!row || row.posted_entry) throw new DomainError("posted");
      const positive = new Decimal(row.amount).gt(0);
      const input: EntryInput = {
        date: row.booking_date,
        description: row.description.slice(0, 240) || "Bank",
        kind: "payment",
        amount: new Decimal(row.amount).abs().toFixed(2),
        vat: "0",
        debit: positive ? "bank" : counterpart,
        credit: positive ? counterpart : "bank",
        requestKey: id,
        sourceId: row.document_id,
      };
      const entryId = randomUUID(),
        lines = buildLines(input, b.profile.year);
      await tx.query("select post_entry($1,$2,$3,$4,$5,$6,$7,$8)", [
        entryId,
        b.id,
        input.date,
        input.description,
        input.kind,
        id,
        row.document_id,
        JSON.stringify(lines),
      ]);
      await tx.query(
        "update bank_rows set posted_entry=$1 where id=$2 and business_id=$3",
        [entryId, id, b.id],
      );
    });
  });
}
export async function loadDemo(_: ActionState, _form: FormData) {
  return run(async () => {
    const connection = await db();
    const id = randomUUID();
    const profile: Profile = {
      ...defaultProfile,
      name: "Studio Noord · Demo",
      year: 2025,
      activity: "salon",
      vatMethod: "invoice",
      premises: true,
      firstYear: true,
    };
    await connection.transaction(async (tx) => {
      await tx.query("insert into businesses(id,profile) values($1,$2)", [
        id,
        JSON.stringify(profile),
      ]);
      const samples: Omit<EntryInput, "requestKey" | "sourceId">[] = [
        {
          date: "2025-01-01",
          description: "Opening contribution / startkapitaal",
          kind: "opening",
          debit: "bank",
          credit: "capital",
          amount: "5000",
          vat: "0",
        },
        {
          date: "2025-01-15",
          description: "Services invoice / dienstenfactuur",
          kind: "sale",
          debit: "",
          credit: "",
          amount: "1210",
          vat: "210",
        },
        {
          date: "2025-01-18",
          description: "Customer payment / klantbetaling",
          kind: "payment",
          debit: "bank",
          credit: "receivables",
          amount: "1210",
          vat: "0",
        },
        {
          date: "2025-01-20",
          description: "Rent invoice / huurfactuur",
          kind: "purchase",
          debit: "rent",
          credit: "",
          amount: "600",
          vat: "0",
        },
        {
          date: "2025-01-25",
          description: "Rent payment / huurbetaling",
          kind: "payment",
          debit: "payables",
          credit: "bank",
          amount: "600",
          vat: "0",
        },
        {
          date: "2025-02-01",
          description: "Owner withdrawal / prive-opname",
          kind: "payment",
          debit: "drawings",
          credit: "bank",
          amount: "200",
          vat: "0",
        },
      ];
      for (const sample of samples) {
        const input = { ...sample, requestKey: randomUUID(), sourceId: "" };
        await tx.query("select post_entry($1,$2,$3,$4,$5,$6,$7,$8)", [
          randomUUID(),
          id,
          input.date,
          input.description,
          input.kind,
          input.requestKey,
          null,
          JSON.stringify(buildLines(input, 2025)),
        ]);
      }
    });
    (await cookies()).set("business", id, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
  });
}
