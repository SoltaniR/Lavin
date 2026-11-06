"use client";
import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { login, logout } from "@/app/login/actions";

export function LoginForm() {
  const t = useTranslations(), [state, action, pending] = useActionState(login, {});
  const [visible, setVisible] = useState(false);
  useEffect(() => { if (state.success) window.location.assign("/"); }, [state.success]);
  return <form action={action} className="login-form">
    <label htmlFor="password">{t("auth.password")}</label>
    <div className="password-field">
      <input id="password" name="password" type={visible ? "text" : "password"}
        autoComplete="current-password" required maxLength={256} autoFocus aria-describedby="login-help" />
      <button type="button" onClick={() => setVisible(!visible)} aria-pressed={visible}>
        {t(visible ? "auth.hide" : "auth.show")}
      </button>
    </div>
    <p id="login-help" className="help">{t("auth.help")}</p>
    <button className="button primary" disabled={pending}>{t(pending ? "auth.signingIn" : "auth.signIn")}</button>
    {state.error && <p className="feedback error" role="alert">{t(`errors.${state.error}`)}</p>}
  </form>;
}

export function LogoutButton() {
  const t = useTranslations();
  return <form action={async () => { await logout(); window.location.assign("/login"); }}>
    <button className="button secondary sign-out">{t("auth.signOut")}</button>
  </form>;
}
