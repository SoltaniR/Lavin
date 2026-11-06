"use client";
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Business } from "@/lib/model";
import { selectBusiness } from "@/app/actions";
import { ActionForm } from "./forms";

export function CompanyPicker({ businesses, editing }: { businesses: Business[]; editing: boolean }) {
  const t = useTranslations(), [search, setSearch] = useState("");
  const filtered = businesses.filter(b => `${b.profile.name} ${b.profile.year}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <>
    <header className="page-heading"><h1>{t(editing ? "companies.editTitle" : "companies.title")}</h1><p>{t(editing ? "companies.editHelp" : "companies.subtitle")}</p></header>
    <div className="picker-toolbar"><label>{t("companies.search")}<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("companies.searchHint")} /></label>
      <Link href="/?view=setup" className="button primary">{t("home.new")}</Link></div>
    <p className="muted picker-count" role="status">{t("companies.count", { count: filtered.length })}</p>
    <div className="company-list">
      {filtered.map(b => <article className="company-row" key={b.id} aria-labelledby={`company-${b.id}`}>
        <div><h2 id={`company-${b.id}`}>{b.profile.name}</h2><p>{t("app.year")} {b.profile.year} <span className="badge">{t("common.draft")}</span></p></div>
        <div className="company-actions">{(editing ? ["business", "overview"] : ["overview", "business"]).map(view =>
          <ActionForm key={view} action={selectBusiness} label={t(view === "overview" ? "companies.open" : "companies.edit")}
            successHref={`/?view=${view}`} className={view === (editing ? "business" : "overview") ? "" : "quiet-action"}>
            <input type="hidden" name="business" value={b.id} />
          </ActionForm>)}
        </div>
      </article>)}
      {!filtered.length && <section className="empty-state"><h2>{t(businesses.length ? "companies.noMatch" : "companies.empty")}</h2><p>{t(businesses.length ? "companies.trySearch" : "companies.emptyHelp")}</p>
        {!businesses.length && <Link className="button primary" href="/?view=setup">{t("home.new")}</Link>}</section>}
    </div>
  </>;
}
