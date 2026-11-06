import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { hasAccess } from "@/lib/server/access";
import { LoginForm } from "@/components/login-form";
import { loginLocale } from "./actions";
import { DomainError } from "@/lib/accounting";

export default async function LoginPage() {
  let issue: "accessDenied" | "accessConfig" | undefined, allowed = false;
  try { allowed = await hasAccess(); }
  catch (error) { issue = error instanceof DomainError && error.message === "accessDenied" ? "accessDenied" : "accessConfig"; }
  if (allowed) redirect("/");
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  return <main className="login-page">
    <section className="login-card">
      <div className="login-top"><span className="brand">lavin<span className="brand-dot">.</span></span>
        {!issue && <form action={loginLocale} className="language-switch" aria-label="Language / Taal">
          {["en", "nl"].map(l => <button key={l} name="locale" value={l} aria-pressed={locale === l} className={locale === l ? "selected" : ""}>{l.toUpperCase()}</button>)}
        </form>}
      </div>
      <LockKeyhole size={30} className="login-lock" />
      <h1>{t("auth.title")}</h1><p className="login-intro">{t("auth.intro")}</p>
      {issue ? <p className="notice">{t(`errors.${issue}`)}</p> : <LoginForm />}
      <p className="login-footnote">{t("auth.shared")}</p>
    </section>
  </main>;
}
