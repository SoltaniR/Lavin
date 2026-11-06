import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { accounts, defaultProfile } from "../src/lib/model";

test("PostgreSQL posting boundary: atomicity, idempotency and evidence ownership", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/0001_core.sql", import.meta.url),
        "utf8",
      ),
    );
    for (const a of accounts)
      await db.query("insert into accounts values($1,$2)", [a.code, a.kind]);
    const business = randomUUID(),
      other = randomUUID();
    for (const id of [business, other])
      await db.query("insert into businesses(id,profile) values($1,$2)", [
        id,
        JSON.stringify(defaultProfile),
      ]);
    const lines = [
      { account: "bank", debit: "100.00", credit: "0.00" },
      { account: "capital", debit: "0.00", credit: "100.00" },
    ];
    const key = randomUUID();
    const post = (
      values = lines,
      request = key,
      source: string | null = null,
    ) =>
      db.query<{ post_entry: string }>(
        "select post_entry($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          business,
          "2025-01-01",
          "Opening capital",
          "opening",
          request,
          source,
          JSON.stringify(values),
        ],
      );
    const first = await post(),
      again = await post();
    assert.equal(first.rows[0].post_entry, again.rows[0].post_entry);
    assert.equal((await db.query("select * from entries")).rows.length, 1);
    await assert.rejects(
      post([{ ...lines[0], debit: "99.00" }, lines[1]], randomUUID()),
      /balance/,
    );
    assert.equal((await db.query("select * from entries")).rows.length, 1);
    await assert.rejects(
      post([
        { ...lines[0], debit: "200.00" },
        { ...lines[1], credit: "200.00" },
      ]),
      /duplicateKey/,
    );
    const doc = randomUUID();
    await db.query(
      "insert into documents(id,business_id,name,kind,status,sha256) values($1,$2,$3,$4,$5,$6)",
      [doc, other, "Other business", "pdf", "textReady", "test"],
    );
    await assert.rejects(post(lines, randomUUID(), doc), /foreign key/);
    assert.equal((await db.query("select * from entries")).rows.length, 1);
    const invalid = [
      { account: "bank", debit: "100.001", credit: "0" },
      { account: "capital", debit: "0", credit: "100.001" },
    ];
    await assert.rejects(post(invalid, randomUUID()), /amount/);
  } finally {
    await db.close();
  }
});
