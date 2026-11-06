import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { accessConfig, hashPassword, PreviewSessions, SESSION_SECONDS, verifyPassword } from "../src/lib/preview-auth";

test("preview fails closed without credentials or with an unsafe origin", async () => {
  const hash = await hashPassword("test-only-preview-password");
  assert.throws(() => accessConfig({}));
  assert.throws(() => accessConfig({ LAVIN_LOCAL: "1", LAVIN_PASSWORD_HASH: "broken" }));
  for (const origin of ["http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?x=1"]) {
    assert.throws(() => accessConfig({ LAVIN_PASSWORD_HASH: hash, LAVIN_ORIGIN: origin }));
  }
  assert.equal(accessConfig({ LAVIN_PASSWORD_HASH: hash, LAVIN_ORIGIN: "https://example.com" }).secure, true);
  assert.equal(accessConfig({ LAVIN_LOCAL: "1" }).hash, "");
  assert.equal(await verifyPassword("incorrect", hash), false);
  assert.equal(await verifyPassword("test-only-preview-password", hash), true);
});

test("opaque sessions persist, expire, revoke on logout and reject changed credentials", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lavin-auth-"));
  try {
    const file = path.join(dir, "access.json"), store = new PreviewSessions(file);
    const password = "test-only-password", credential = await hashPassword(password), now = Date.now();
    const wrong = await store.login("incorrect", credential, now);
    assert.equal(wrong.error, "loginInvalid");
    const result = await store.login(password, credential, now);
    assert.ok(result.token);
    const restarted = new PreviewSessions(file);
    assert.equal(await restarted.valid(result.token, credential, now), true);
    assert.equal(await restarted.valid(result.token + "x", credential, now), false);
    assert.equal(await restarted.valid(result.token, credential, now + SESSION_SECONDS * 1000), false);
    assert.equal(await restarted.valid(result.token, await hashPassword(password), now), false);
    const stored = await readFile(file, "utf8");
    assert.ok(!stored.includes(result.token));
    assert.ok(!stored.includes(password));
    await restarted.revoke(result.token);
    assert.equal(await store.valid(result.token, credential, now), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("concurrent login attempts cannot bypass the persistent global limit", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lavin-limit-"));
  try {
    const file = path.join(dir, "access.json"), store = new PreviewSessions(file), now = Date.now();
    // Invalid hash avoids expensive derivation; every submitted attempt still counts.
    const results = await Promise.all(Array.from({ length: 32 }, () => store.login("wrong", "invalid", now)));
    assert.equal(results.filter(result => result.error === "loginLimited").length, 2);
    const restarted = new PreviewSessions(file);
    assert.equal((await restarted.login("wrong", "invalid", now)).error, "loginLimited");
    assert.equal((await restarted.login("wrong", "invalid", now + 300_001)).error, "loginInvalid");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
