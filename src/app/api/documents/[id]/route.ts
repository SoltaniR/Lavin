import { readFile } from "node:fs/promises";
import path from "node:path";
import { needBusiness, uuid } from "@/lib/server/workspace";
import { db, dataDir } from "@/lib/server/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const b = await needBusiness(),
      id = uuid((await params).id);
    const doc = (
      await (
        await db()
      ).query<{ name: string; kind: string }>(
        "select name,kind from documents where id=$1 and business_id=$2",
        [id, b.id],
      )
    ).rows[0];
    if (!doc) return new Response(null, { status: 404 });
    const bytes = await readFile(path.join(dataDir, "uploads", id));
    return new Response(bytes, {
      headers: {
        "Content-Type":
          doc.kind === "pdf" ? "application/pdf" : "text/plain; charset=utf-8",
        "Content-Disposition": `${doc.kind === "pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
