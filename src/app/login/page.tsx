import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { hasAccess } from "@/lib/server/access";
import { LoginForm } from "@/components/login-form";
import { loginLocale } from "./actions";

export default async function LoginPage() {
  let configured = true, allowed = false;
  try { allowed = await hasAccess(); } catch { configured = false; }
  if (allowed) redirect("/");
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  return <main className="login-page">
    <section className="login-card">
      <div className="login-top"><span className="brand">lavin<span className="brand-dot">.</span></span>
        {configured && <form action={loginLocale} className="language-switch" aria-label="Language / Taal">
          {["en", "nl"].map(l => <button key={l} name="locale" value={l} aria-pressed={locale === l} className={locale === l ? "selected" : ""}>{l.toUpperCase()}</button>)}
        </form>}
      </div>
      <LockKeyhole size={30} className="login-lock" />
      <h1>{t("auth.title")}</h1><p className="login-intro">{t("auth.intro")}</p>
      {configured ? <LoginForm /> : <p className="notice">{t("errors.accessConfig")}</p>}
      <p className="login-footnote">{t("auth.shared")}</p>
    </section>
  </main>;
}
