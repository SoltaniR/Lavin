import "server-only";
import { PGlite } from "@electric-sql/pglite";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { accounts } from "../model";

const globalDb = globalThis as unknown as { lavinDb?: Promise<PGlite> };
export const dataDir = process.env.LAVIN_DATA_DIR || path.join(process.cwd(), ".data");

export function db() {
  // Only the connection is shared. Never cache a user's data in global state.
  globalDb.lavinDb ??= (async () => {
    await mkdir(dataDir, { recursive: true });
    const connection = new PGlite(path.join(dataDir, "postgres"));
    await connection.exec(
      await readFile(
        path.join(process.cwd(), "supabase/migrations/0001_core.sql"),
        "utf8",
      ),
    );
    for (const a of accounts)
      await connection.query(
        "insert into accounts(code,kind) values($1,$2) on conflict do nothing",
        [a.code, a.kind],
      );
    return connection;
  })();
  return globalDb.lavinDb;
}
