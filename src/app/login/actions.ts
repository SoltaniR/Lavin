"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { checkRequest, sessions } from "@/lib/server/access";
import { COOKIE_NAME, SESSION_SECONDS } from "@/lib/preview-auth";

export async function login(_: { error?: string; success?: boolean }, form: FormData): Promise<{ error?: string; success?: boolean }> {
  try {
    const config = await checkRequest(true);
    const password = form.get("password");
    if (!config.hash) return { error: "accessConfig" };
    if (typeof password !== "string" || password.length > 256) return { error: "loginInvalid" };
    const result = await sessions.login(password, config.hash);
    if (result.error) return { error: result.error };
    (await cookies()).set(COOKIE_NAME, result.token!, {
      httpOnly: true, secure: config.secure, sameSite: "strict", path: "/", maxAge: SESSION_SECONDS,
    });
    (await cookies()).delete("business");
  } catch { return { error: "accessDenied" }; }
  return { success: true };
}
export async function logout() {
  await checkRequest(true);
  const jar = await cookies();
  await sessions.revoke(jar.get(COOKIE_NAME)?.value);
  jar.delete(COOKIE_NAME);
  jar.delete("business");
}
export async function loginLocale(form: FormData) {
  const config = await checkRequest(true);
  (await cookies()).set("locale", form.get("locale") === "nl" ? "nl" : "en", {
    httpOnly: true, secure: config.secure, sameSite: "strict", path: "/",
  });
  revalidatePath("/", "layout");
}
