import "server-only";
import { cookies, headers } from "next/headers";
import path from "node:path";
import { accessConfig, COOKIE_NAME, PreviewSessions } from "../preview-auth";
import { DomainError } from "../accounting";

const shared = globalThis as unknown as { lavinSessions?: PreviewSessions };
export const sessions = shared.lavinSessions ??= new PreviewSessions(
  path.join(process.env.LAVIN_DATA_DIR || path.join(process.cwd(), ".data"), "access.json"),
);
export function configuration() {
  try { return accessConfig(); }
  catch { throw new DomainError("accessConfig"); }
}
export async function checkRequest(requireOrigin = false) {
  const config = configuration(), h = await headers();
  const host = h.get("host") ?? "";
  const expected = new URL(config.origin);
  // Use the configured origin, never an untrusted forwarded host.
  const localHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  if (host !== expected.host && !(config.local && localHost && !config.hash))
    throw new DomainError("accessDenied");
  const origin = h.get("origin");
  const allowedOrigin = config.local && !config.hash ? `http://${host}` : config.origin;
  if ((requireOrigin && !origin) || (origin && origin !== allowedOrigin))
    throw new DomainError("accessDenied");
  return config;
}
export async function hasAccess() {
  const config = await checkRequest();
  return !config.hash || sessions.valid((await cookies()).get(COOKIE_NAME)?.value, config.hash);
}
export async function requireAccess() {
  if (!await hasAccess()) throw new DomainError("sessionExpired");
}
