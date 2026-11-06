import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, copyFile, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

test("private files are ignored and forced staging is rejected by the publish guard", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lavin-public-"));
  try {
    await copyFile(".gitignore", path.join(dir, ".gitignore"));
    await copyFile("scripts/check-public.mjs", path.join(dir, "check.mjs"));
    await mkdir(path.join(dir, ".private"));
    await writeFile(path.join(dir, ".private/README.md"), "Private test documentation");
    await writeFile(path.join(dir, ".env.local"), "TEST_ONLY=1");
    execFileSync("git", ["init", "--quiet"], { cwd: dir });
    execFileSync("git", ["add", "."], { cwd: dir });
    const files = execFileSync("git", ["ls-files"], { cwd: dir, encoding: "utf8" });
    assert.ok(!files.includes("README"));
    assert.ok(!files.includes(".env.local"));
    assert.equal(spawnSync(process.execPath, ["check.mjs"], { cwd: dir }).status, 0);
    execFileSync("git", ["add", "-f", ".private/README.md"], { cwd: dir });
    assert.equal(spawnSync(process.execPath, ["check.mjs"], { cwd: dir }).status, 1);
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "Test private history"], { cwd: dir });
    execFileSync("git", ["rm", "--cached", ".private/README.md"], { cwd: dir });
    assert.equal(spawnSync(process.execPath, ["check.mjs"], { cwd: dir }).status, 1, "Removing a file from the index must not hide private history");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
