"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import type { SavedReport } from "@/lib/server/workspace";
import { selectBusiness, setReportTrash } from "@/app/actions";
import { ActionForm } from "./forms";

const viewLabel = { overview: "companies.open", report: "companies.figures", business: "companies.edit" } as const;

export function CompanyPicker({ businesses, editing, trashed }: {
  businesses: SavedReport[];
  editing: boolean;
  trashed: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [year, setYear] = useState("");
  const [sort, setSort] = useState("recent");
  const [confirmation, setConfirmation] = useState<SavedReport | null>(null);
  const [state, changeTrash, pending] = useActionState(setReportTrash, {});
  const dialog = useRef<HTMLDialogElement>(null);
  const status = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (confirmation && !dialog.current?.open) dialog.current?.showModal();
  }, [confirmation]);
  useEffect(() => {
    if (!state.changed) return;
    dialog.current?.close();
    status.current?.focus();
  }, [state]);

  const years = new Set(businesses.map(b => b.profile.year));
  if (year) years.add(Number(year));
  const words = search.trim().toLocaleLowerCase(locale);
  const filtered = businesses.filter(({ profile }) =>
    (!year || String(profile.year) === year) &&
    `${profile.name} ${profile.year}`.toLocaleLowerCase(locale).includes(words),
  );
  const compareName = (a: SavedReport, b: SavedReport) => a.profile.name.localeCompare(b.profile.name, locale);
  if (sort === "name") filtered.sort(compareName);
  if (sort === "year") filtered.sort((a, b) => b.profile.year - a.profile.year || compareName(a, b));

  const title = trashed ? "companies.trash" : editing ? "companies.editTitle" : "companies.title";
  const subtitle = trashed ? "companies.trashHelp" : editing ? "companies.editHelp" : "companies.subtitle";
  const change = state.changed;
  const actions = editing ? ["business", "overview", "report"] as const : ["overview", "report", "business"] as const;
  const error = state.error && !pending ? t(`errors.${state.error}`) : null;

  return (
    <>
      <header className="page-heading">
        <h1>{t(title)}</h1>
        <p>{t(subtitle)}</p>
      </header>
      <div className="report-list-switch" role="group" aria-label={t("nav.companies")}>
        <Link href="/?view=companies" aria-current={!trashed ? "page" : undefined}>{t("nav.companies")}</Link>
        <Link href="/?view=companies&trash=1" aria-current={trashed ? "page" : undefined}>{t("companies.trash")}</Link>
      </div>
      {change && (
        <div className="report-change" role="status" tabIndex={-1} ref={status}>
          <p>{t(change.trashed ? "companies.trashedNotice" : "companies.restoredNotice", { name: change.name, year: String(change.year) })}</p>
          {change.trashed ? (
            <form action={changeTrash}>
              <input type="hidden" name="business" value={change.id} />
              <input type="hidden" name="intent" value="restore" />
              <button className="button secondary" disabled={pending}>{t("companies.undo")}</button>
            </form>
          ) : trashed && <Link className="text-link" href="/?view=companies">{t("companies.backToSaved")}</Link>}
        </div>
      )}
      {!confirmation && error && <p role="alert" className="feedback error">{error}</p>}
      <div className="picker-toolbar">
        <div className="picker-filters">
          <label>{t("companies.search")}
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("companies.searchHint")} />
          </label>
          <label>{t("companies.filterYear")}
            <select value={year} onChange={e => setYear(e.target.value)}>
              <option value="">{t("companies.allYears")}</option>
              {[...years].sort((a, b) => b - a).map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>{t("companies.sort")}
            <select value={sort} onChange={e => setSort(e.target.value)}>
              <option value="recent">{t(trashed ? "companies.recentlyDeleted" : "companies.newest")}</option>
              <option value="name">{t("companies.nameOrder")}</option>
              <option value="year">{t("companies.yearOrder")}</option>
            </select>
          </label>
        </div>
        {!trashed && <Link href="/?view=setup" className="button primary">{t("home.new")}</Link>}
      </div>
      <p className="muted picker-count" role="status">
        {t(trashed ? "companies.trashCount" : "companies.count", { count: filtered.length })}
      </p>
      <div className="company-list">
        {filtered.map(report => (
          <article className="company-row" key={report.id} aria-labelledby={`company-${report.id}`}>
            <div>
              <h2 id={`company-${report.id}`}>{report.profile.name}</h2>
              <p>{t("app.year")} {report.profile.year} {!trashed && <span className="badge">{t("common.draft")}</span>}</p>
            </div>
            {trashed ? (
              <form action={changeTrash}>
                <input type="hidden" name="business" value={report.id} />
                <input type="hidden" name="intent" value="restore" />
                <button className="button secondary" disabled={pending}>{t("companies.restore")}</button>
              </form>
            ) : (
              <div className="company-actions">
                {actions.map((view, index) => (
                  <ActionForm key={view} action={selectBusiness} label={t(viewLabel[view])}
                    successHref={`/?view=${view}`} className={index === 0 ? "" : "quiet-action"}>
                    <input type="hidden" name="business" value={report.id} />
                  </ActionForm>
                ))}
                <button type="button" className="button secondary delete-report" disabled={pending}
                  onClick={() => setConfirmation(report)}>{t("companies.delete")}</button>
              </div>
            )}
          </article>
        ))}
        {!filtered.length && (
          <section className="empty-state">
            <h2>{t(businesses.length ? "companies.noMatch" : trashed ? "companies.emptyTrash" : "companies.empty")}</h2>
            <p>{t(businesses.length ? "companies.trySearch" : trashed ? "companies.emptyTrashHelp" : "companies.emptyHelp")}</p>
            {businesses.length > 0 && (
              <button type="button" className="button secondary" onClick={() => { setSearch(""); setYear(""); }}>
                {t("companies.clearFilters")}
              </button>
            )}
          </section>
        )}
      </div>
      <dialog className="report-delete-dialog" aria-labelledby="delete-report-title" aria-describedby="delete-report-help" ref={dialog}
        onClose={() => setConfirmation(null)} onCancel={event => { if (pending) event.preventDefault(); }}>
        {confirmation && (
          <>
            <h2 id="delete-report-title">{t("companies.confirmTitle", { name: confirmation.profile.name, year: String(confirmation.profile.year) })}</h2>
            <p id="delete-report-help">{t("companies.confirmHelp")}</p>
            {error && <p role="alert" className="feedback error">{error}</p>}
            <form action={changeTrash} className="report-delete-actions">
              <input type="hidden" name="business" value={confirmation.id} />
              <input type="hidden" name="intent" value="trash" />
              <button type="button" className="button secondary" autoFocus disabled={pending} onClick={() => dialog.current?.close()}>
                {t("common.cancel")}
              </button>
              <button className="button danger" disabled={pending}>{t(pending ? "common.saving" : "companies.moveToTrash")}</button>
            </form>
          </>
        )}
      </dialog>
    </>
  );
}
