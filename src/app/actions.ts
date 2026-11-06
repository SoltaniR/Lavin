"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import Decimal from "decimal.js";
import { z } from "zod";
import { db, dataDir } from "@/lib/server/db";
import { needBusiness, uuid } from "@/lib/server/workspace";
import { requireAccess } from "@/lib/server/access";
import {
  profileSchema,
  defaultProfile,
  requirements,
  type Profile,
} from "@/lib/model";
import {
  entrySchema,
  buildLines,
  DomainError,
  type EntryInput,
} from "@/lib/accounting";
import { parseMt940 } from "@/lib/documents/mt940";

export type ActionState = { error?: string; success?: boolean };
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
    if (!(await (await db()).query("select id from businesses where id=$1", [id])).rows.length)
      throw new DomainError("business");
    (await cookies()).set("business", id, {
      httpOnly: true, sameSite: "strict", path: "/",
    });
  });
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
      await connection.query("update businesses set profile=$1 where id=$2", [
        JSON.stringify(profile),
        business.id,
      ]);
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
    const b = await needBusiness(),
      input = entrySchema.parse(Object.fromEntries(form));
    const lines = buildLines(input, b.profile.year);
    await (
      await db()
    ).query("select post_entry($1,$2,$3,$4,$5,$6,$7,$8)", [
      randomUUID(),
      b.id,
      input.date,
      input.description,
      input.kind,
      input.requestKey,
      input.sourceId || null,
      JSON.stringify(lines),
    ]);
  });
}
export async function saveEvidence(_: ActionState, form: FormData) {
  return run(async () => {
    const b = await needBusiness(),
      requirement = z.string().parse(form.get("requirement"));
    if (!requirements(b.profile).includes(requirement))
      throw new DomainError("validation");
    const note = z.string().trim().min(5).max(2000).parse(form.get("note"));
    await (
      await db()
    ).query(
      `insert into evidence(business_id,requirement,note) values($1,$2,$3)
      on conflict(business_id,requirement) do update set note=$3,updated_at=now()`,
      [b.id, requirement, note],
    );
  });
}
export async function uploadDocument(_: ActionState, form: FormData) {
  return run(async () => {
    const b = await needBusiness(),
      file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024)
      throw new DomainError("fileSize");
    const bytes = Buffer.from(await file.arrayBuffer()),
      sha = createHash("sha256").update(bytes).digest("hex");
    const connection = await db();
    if (
      (
        await connection.query(
          "select id from documents where business_id=$1 and sha256=$2",
          [b.id, sha],
        )
      ).rows.length
    )
      throw new DomainError("duplicate");
    const id = randomUUID(),
      isPdf = bytes.subarray(0, 5).toString() === "%PDF-";
    let text = "",
      status = "textReady",
      metadata: Record<string, unknown> = {};
    let statement: ReturnType<typeof parseMt940> | undefined;
    if (isPdf) {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(bytes) });
      try {
        const info = await parser.getInfo();
        if (info.total > 100) throw new DomainError("pageLimit");
        text = (await parser.getText()).text;
        metadata = { pages: info.total };
        status = text.replace(/\s/g, "").length > 50 ? "textReady" : "needsOcr";
      } catch (e) {
        if (e instanceof DomainError) throw e;
        throw new DomainError("pdf");
      } finally {
        await parser.destroy();
      }
    } else {
      text = bytes.toString("utf8");
      if (!text.includes(":60F:")) throw new DomainError("fileType");
      statement = parseMt940(text);
      if (
        statement.rows.some(
          (r) => Number(r.date.slice(0, 4)) !== b.profile.year,
        )
      )
        throw new DomainError("date");
      metadata = { ...statement, rows: undefined };
      status = "bankReady";
    }
    const uploadDir = path.join(dataDir, "uploads");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, id), bytes, { flag: "wx" });
    try {
      await connection.transaction(async (tx) => {
        // Serialize imports for this business so concurrent requests cannot bypass
        // duplicate/overlap checks. Exact equal payments within one file are retained.
        await tx.query("select id from businesses where id=$1 for update", [
          b.id,
        ]);
        if (
          (
            await tx.query(
              "select id from documents where business_id=$1 and sha256=$2",
              [b.id, sha],
            )
          ).rows.length
        )
          throw new DomainError("duplicate");
        if (statement) {
          const previous = await tx.query<{ metadata: Record<string, string> }>(
            "select metadata from documents where business_id=$1 and kind='mt940'",
            [b.id],
          );
          if (
            previous.rows.some(
              ({ metadata: m }) =>
                m.account === statement!.account &&
                m.openingDate <= statement!.closingDate &&
                m.closingDate >= statement!.openingDate,
            )
          )
            throw new DomainError("overlap");
        }
        await tx.query(
          "insert into documents(id,business_id,name,kind,status,sha256,text_content,metadata) values($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            id,
            b.id,
            file.name.slice(0, 200),
            isPdf ? "pdf" : "mt940",
            status,
            sha,
            text.slice(0, 500000),
            JSON.stringify(metadata),
          ],
        );
        if (statement)
          for (const [i, r] of statement.rows.entries())
            await tx.query(
              "insert into bank_rows(id,business_id,document_id,booking_date,amount,description,reference,position) values($1,$2,$3,$4,$5,$6,$7,$8)",
              [
                randomUUID(),
                b.id,
                id,
                r.date,
                r.amount,
                r.description,
                r.reference,
                i,
              ],
            );
      });
    } catch (error) {
      // Only remove this request's newly created UUID file after a DB rollback.
      await unlink(path.join(uploadDir, id)).catch(() => {});
      throw error;
    }
  });
}
export async function postBankRow(_: ActionState, form: FormData) {
  return run(async () => {
    const b = await needBusiness(),
      id = uuid(form.get("rowId")),
      counterpart = z.string().parse(form.get("account"));
    if (counterpart === "bank") throw new DomainError("account");
    const connection = await db();
    await connection.transaction(async (tx) => {
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
