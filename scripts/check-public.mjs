import { execFileSync } from "node:child_process";

const files = execFileSync("git", ["ls-files", "--cached", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const forbidden = file => /(^|\/)(\.private|\.data|docs|documentation|output|\.playwright-cli|node_modules|\.next)(\/|$)/i.test(file) ||
  /\.(md|mdx|rst|pdf|docx?|pem|key|p12|pfx|log)$/i.test(file) ||
  /(^|\/)\.env/.test(file) && file !== ".env.example";
const history = execFileSync("git", ["log", "--all", "--format=", "--name-only", "--diff-filter=A"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
const blocked = [...new Set([...files, ...history].filter(forbidden))];
if (blocked.length) {
  console.error("Private files are in the Git index or commit history. Remove them before publishing:\n" + blocked.join("\n"));
  process.exit(1);
}
console.log(`Public-file check passed (${files.length} indexed files). Source code remains public when published.`);
