import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hashPassword, accessConfig } from "../src/lib/preview-auth.ts";

const origin = process.argv.find(arg => arg.startsWith("--origin="))?.slice(9) || "http://127.0.0.1:3000";
let existing = "";
try { existing = await readFile(".env.local", "utf8"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (/^LAVIN_PASSWORD_HASH=.+/m.test(existing) && !process.argv.includes("--rotate")) {
  throw new Error("Preview access already exists. Use --rotate to replace its password and invalidate sessions.");
}
const password = randomBytes(24).toString("base64url");
const hash = await hashPassword(password);
accessConfig({ LAVIN_PASSWORD_HASH: hash, LAVIN_ORIGIN: origin });
const rest = existing.split(/\r?\n/).filter(line => !/^LAVIN_(PASSWORD_HASH|ORIGIN)=/.test(line)).join("\n").trim();
await mkdir(".private", { recursive: true });
await writeFile(".private/preview-credentials.txt", `Preview password: ${password}\nOrigin: ${origin}\n\nShare the password privately. Everyone with access shares this workspace.\n`, { mode: 0o600 });
await writeFile(".env.local", `${rest}${rest ? "\n" : ""}LAVIN_PASSWORD_HASH=${hash}\nLAVIN_ORIGIN=${origin}\n`, { mode: 0o600 });
console.log("Preview access configured. Password: .private/preview-credentials.txt. Server settings: .env.local. Restart the app to apply.");
