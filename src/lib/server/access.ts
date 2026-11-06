import "server-only";
import { cookies, headers } from "next/headers";
import path from "node:path";
import { accessConfig, COOKIE_NAME, PreviewSessions, validRequestOrigin } from "../preview-auth";
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
  if (!validRequestOrigin(config, h.get("host") ?? "", h.get("origin"), requireOrigin))
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
