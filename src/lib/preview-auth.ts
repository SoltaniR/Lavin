import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const SESSION_SECONDS = 8 * 60 * 60;
export const COOKIE_NAME = "lavin_session";
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const validHash = (value: string) => /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(value);
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) =>
  scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key)));
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string) {
  if (!validHash(hash) || password.length > 256) return false;
  const [, salt, expected] = hash.split(":");
  return timingSafeEqual(await derive(password, salt), Buffer.from(expected, "hex"));
}

export function accessConfig(env: Record<string, string | undefined> = process.env) {
  const hash = env.LAVIN_PASSWORD_HASH ?? "";
  const local = env.LAVIN_LOCAL === "1";
  if (hash && !validHash(hash)) throw new Error("Invalid preview configuration");
  if (!hash && !local) throw new Error("Preview password is required");
  const origin = new URL(env.LAVIN_ORIGIN || (local ? "http://127.0.0.1:3000" : ""));
  const loopback = ["localhost", "127.0.0.1"].includes(origin.hostname);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
    (!loopback && origin.protocol !== "https:") || !["http:", "https:"].includes(origin.protocol))
    throw new Error("Use an HTTPS origin (HTTP is allowed only on loopback)");
  return { hash, origin: origin.origin, secure: origin.protocol === "https:", local };
}

type State = { attempts: number[]; sessions: { hash: string; expires: number; credential: string }[] };
// One Node process and persistent disk, matching the embedded database. Serialize
// read/modify/write so concurrent logins cannot lose revocations or skip limits.
export class PreviewSessions {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {}
  private change<T>(work: (state: State) => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      let state: State;
      try { state = JSON.parse(await readFile(this.file, "utf8")); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        state = { attempts: [], sessions: [] };
      }
      const result = await work(state);
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(state), { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
      return result;
    });
    this.queue = next.catch(() => {});
    return next;
  }
  async login(password: string, credential: string, now = Date.now()) {
    // Global limit intentionally ignores spoofable forwarding headers.
    const allowed = await this.change(state => {
      state.attempts = state.attempts.filter(time => time > now - 5 * 60_000);
      if (state.attempts.length >= 30) return false;
      state.attempts.push(now);
      return true;
    });
    if (!allowed) return { error: "loginLimited" } as const;
    if (!await verifyPassword(password, credential)) return { error: "loginInvalid" } as const;
    const token = randomBytes(32).toString("hex");
    await this.change(state => {
      state.sessions = state.sessions.filter(s => s.expires > now && s.credential === digest(credential)).slice(-99);
      state.sessions.push({ hash: digest(token), expires: now + SESSION_SECONDS * 1000, credential: digest(credential) });
    });
    return { token } as const;
  }
  async valid(token: string | undefined, credential: string, now = Date.now()) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
    // Atomic rename means readers always see a complete state file.
    try {
      const state: State = JSON.parse(await readFile(this.file, "utf8"));
      return state.sessions.some(s => s.hash === digest(token) && s.expires > now && s.credential === digest(credential));
    } catch { return false; }
  }
  async revoke(token: string | undefined) {
    if (token) await this.change(state => { state.sessions = state.sessions.filter(s => s.hash !== digest(token)); });
  }
}
