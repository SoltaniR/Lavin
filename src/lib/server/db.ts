import "server-only";
import { PGlite } from "@electric-sql/pglite";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { accounts } from "../model";

const migrations = ["0001_core.sql", "0002_vat_returns.sql", "0003_report_trash.sql", "0004_document_imports.sql"];
const schemaVersion = migrations.join(",");
const globalDb = globalThis as typeof globalThis & {
  lavinDb?: Promise<PGlite>;
  lavinSchema?: { version: string; ready: Promise<PGlite> };
};
export const dataDir = process.env.LAVIN_DATA_DIR || path.join(process.cwd(), ".data");

export function db() {
  globalDb.lavinDb ??= mkdir(dataDir, { recursive: true })
    .then(() => new PGlite(path.join(dataDir, "postgres")))
    .catch(error => { delete globalDb.lavinDb; throw error; });

  // Next.js can reload this module while the database connection stays open.
  if (globalDb.lavinSchema?.version !== schemaVersion) {
    const ready = (globalDb.lavinSchema?.ready ?? globalDb.lavinDb).then(async connection => {
      const scripts = await Promise.all(migrations.map(file =>
        readFile(path.join(process.cwd(), "supabase/migrations", file), "utf8"),
      ));
      await connection.transaction(async tx => {
        for (const sql of scripts) await tx.exec(sql);
        for (const a of accounts)
          await tx.query(
            "insert into accounts(code,kind) values($1,$2) on conflict do nothing",
            [a.code, a.kind],
          );
      });
      return connection;
    }).catch(error => {
      if (globalDb.lavinSchema?.ready === ready) delete globalDb.lavinSchema;
      throw error;
    });
    globalDb.lavinSchema = { version: schemaVersion, ready };
  }
  return globalDb.lavinSchema.ready;
}
