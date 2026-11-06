import Link from "next/link";
import { redirect } from "next/navigation";
import { hasAccess, configuration } from "@/lib/server/access";
import { LogoutButton } from "@/components/login-form";
import { UserGuide, TaskHelp } from "@/components/user-guide";
import { ReportHome } from "@/components/report-home";
import { CompanyPicker } from "@/components/company-picker";
import { ReportSteps, ReportNext } from "@/components/report-steps";
import Decimal from "decimal.js";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Circle,
  FileText,
  FolderOpen,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { businesses, workspace } from "@/lib/server/workspace";
import { requirements } from "@/lib/model";
import { financials, readiness } from "@/lib/accounting";
import { setLocale } from "./actions";
import { Navigation } from "@/components/navigation";
import {
  ProfileForm,
  EntryForm,
  UploadForm,
  EvidenceForm,
  BankForm,
  PrintButton,
} from "@/components/forms";
import { Report } from "@/components/report";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  let allowed = false;
  try { allowed = await hasAccess(); } catch { /* Fail closed to setup message. */ }
  if (!allowed) redirect("/login");
  const protectedPreview = Boolean(configuration().hash);
  const params = await searchParams;
  const views = ["home", "companies", "setup", "overview", "business", "documents", "review", "yearend", "report", "guide"];
  const requested = params.view === "business" && params.new ? "setup" : params.view ?? "home";
  const view = views.includes(requested) ? requested : "home";
  const companyView = !["home", "companies", "setup", "guide"].includes(view);
  const [t, locale, w, list] = await Promise.all([
    getTranslations(),
    getLocale(),
    companyView ? workspace() : Promise.resolve(null),
    view === "companies" ? businesses() : Promise.resolve([]),
  ]);
  if (companyView && !w) redirect("/?view=companies");
  const p = w?.business.profile;
  const money = (v: string) =>
    new Intl.NumberFormat(locale === "nl" ? "nl-NL" : "en-GB", {
      style: "currency",
      currency: "EUR",
    }).format(Number(v));
  const date = (v: string) =>
    new Intl.DateTimeFormat(locale === "nl" ? "nl-NL" : "en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${v}T12:00:00Z`));
  const req = p ? requirements(p) : [],
    supplied = req.filter((k) =>
      w?.evidence.some((e) => e.requirement === k),
    ).length;
  const f = financials(w?.entries ?? []),
    unposted = w?.bankRows.filter((r) => !r.posted_entry) ?? [];
  const recent = w?.entries.slice(-5).reverse() ?? [];
  const title = (key: string) => (
    <header className="page-heading">
      <h1>{t(`${key}.title`)}</h1>
      <p>{t(`${key}.subtitle`)}</p>
    </header>
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {t("app.skip")}
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Lavin">
          <span className="brand-icon">l</span>lavin
          <span className="brand-dot">.</span>
        </Link>
        <p className="brand-caption">{t("app.tagline")}</p>
        {p && <div className="business-chip">
          <span className="business-avatar">{p?.name.charAt(0) ?? "L"}</span>
          <div>
            <strong>{p?.name ?? "Lavin"}</strong>
            <span>{p ? `${t("app.year")} ${p.year}` : t("app.local")}</span>
          </div>
        </div>}
        <Suspense>
          <Navigation selected={Boolean(w)} />
        </Suspense>
        <div className="sidebar-bottom">
          <div className="local-label">
            <ShieldCheck size={17} />
            {t(protectedPreview ? "auth.preview" : "app.local")}
          </div>
          <p>{t(protectedPreview ? "auth.shared" : "app.localNote")}</p>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Lavin <span>/</span>{" "}
            {t(
              `nav.${view}`,
            )}
          </div>
          <div className="topbar-actions">
            <Link className="guide-link" href="/?view=guide">{t("nav.guide")}</Link>
            {p && <span className="year-pill">{p.year}</span>}
            <form
              action={setLocale}
              className="language-switch"
              aria-label="Language / Taal"
            >
              {["en", "nl"].map((l) => (
                <button
                  name="locale"
                  value={l}
                  key={l}
                  aria-pressed={locale === l}
                  className={locale === l ? "selected" : ""}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </form>
            {protectedPreview && <LogoutButton />}
          </div>
        </header>
        <main id="main">
          {view === "home" && <ReportHome />}
          {view === "companies" && <CompanyPicker businesses={list} editing={params.mode === "edit"} />}
          {(w || view === "setup") && <ReportSteps view={view} ready={Boolean(w)} />}
          {view === "setup" && <div className="setup-layout"><header className="page-heading"><h1>{t("setup.title")}</h1><p>{t("setup.subtitle")}</p></header>
            <section className="panel setup-panel"><ProfileForm guided /></section></div>}
          {view === "guide" && <UserGuide />}
          {view !== "guide" && view !== "overview" && <TaskHelp view={view} />}
          {w && view === "business" && (
            <>
              {title("business")}
              <div className="content-split">
                <section className="panel">
                  <ProfileForm key={w.business.id} business={w.business} />
                </section>
                <aside className="side-note">
                  <h3>{t("app.switch")}</h3>
                  <Link className="text-link" href="/?view=companies">{t("companies.title")}</Link>
                  <Link className="text-link" href="/?view=setup">
                    <Plus size={16} />
                    {t("app.new")}
                  </Link>
                </aside>
              </div>
            </>
          )}
          {w && view === "overview" && (
            <>
              {title("overview")}
              <div className="start-banner"><div><strong>{t("guide.quickTitle")}</strong><p>{t("guide.quickText")}</p></div><Link className="button secondary" href="/?view=guide">{t("guide.open")}</Link></div>
              <div className="overview-grid">
                <section className="panel next-steps">
                  <div className="section-heading">
                    <div>
                      <h2>{t("overview.next")}</h2>
                      <p>{t("overview.nextText")}</p>
                    </div>
                    <span className="badge blue">{p!.year}</span>
                  </div>
                  {(["upload", "reconcile", "check", "preview"] as const).map(
                    (step, i) => (
                      <Link
                        className="step"
                        key={step}
                        href={`/?view=${["documents", "review", "yearend", "report"][i]}`}
                      >
                        <span className="step-number">{i + 1}</span>
                        <span>
                          <strong>{t(`overview.${step}`)}</strong>
                          <small>{t(`overview.${step}Text`)}</small>
                        </span>
                        <ArrowUpRight size={19} />
                      </Link>
                    ),
                  )}
                </section>
                <aside className="year-summary">
                  <span className="summary-title">
                    {t("overview.snapshot")}
                  </span>
                  <div className="profit-number">
                    <small>{t("overview.profit")}</small>
                    <strong>{money(f.profit)}</strong>
                  </div>
                  <div className="summary-row">
                    <span>{t("overview.revenue")}</span>
                    <strong>{money(f.revenue)}</strong>
                  </div>
                  <div className="summary-row">
                    <span>{t("overview.expenses")}</span>
                    <strong>{money(f.expenses)}</strong>
                  </div>
                  <p className="summary-note">{t("overview.based")}</p>
                  <Link href="/?view=report" className="button summary-button">
                    {t("nav.report")}
                    <ArrowRight size={16} />
                  </Link>
                </aside>
              </div>
              <div className="progress-section">
                <div>
                  <h3>{t("overview.progress")}</h3>
                  <p>
                    {t("overview.progressText", {
                      done: supplied,
                      total: req.length,
                    })}
                  </p>
                </div>
                <progress
                  value={supplied}
                  max={req.length || 1}
                  aria-label={t("overview.progress")}
                />
                <span>
                  {supplied}/{req.length}
                </span>
              </div>
              <section className="panel">
                <div className="section-heading">
                  <h2>{t("overview.recent")}</h2>
                  <Link href="/?view=review" className="text-link">
                    {t("overview.all")}
                    <ArrowRight size={16} />
                  </Link>
                </div>
                {recent.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("common.date")}</th>
                          <th>{t("common.description")}</th>
                          <th className="numeric">{t("common.amount")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recent.map((e) => (
                          <tr key={e.id}>
                            <td className="date-cell">{date(e.entry_date)}</td>
                            <td>{e.description}</td>
                            <td className="numeric">
                              {money(
                                e.lines
                                  .reduce(
                                    (sum, l) => sum.plus(l.debit),
                                    new Decimal(0),
                                  )
                                  .toFixed(2),
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="empty-inline">{t("overview.empty")}</p>
                )}
              </section>
            </>
          )}
          {w && view === "documents" && (
            <>
              {title("documents")}
              <div className="content-split">
                <section className="panel">
                  <h2>{t("documents.upload")}</h2>
                  <UploadForm />
                  <p className="help">{t("documents.capability")}</p>
                </section>
                <aside className="side-note">
                  <FolderOpen size={30} />
                  <h3>{t("documents.count", { count: w.documents.length })}</h3>
                  <p>{t("documents.textNote")}</p>
                </aside>
              </div>
              <div className="document-list">
                {w.documents.length === 0 ? (
                  <div className="empty-state">
                    <FilesIcon />
                    <h3>{t("documents.empty")}</h3>
                    <p>{t("documents.emptyText")}</p>
                  </div>
                ) : (
                  w.documents.map((d) => (
                    <details className="panel document" key={d.id}>
                      <summary>
                        <FileText size={22} />
                        <span>
                          <strong>{d.name}</strong>
                          <small>{t(`documents.${d.status}`)}</small>
                        </span>
                        <span className="badge">{d.kind.toUpperCase()}</span>
                      </summary>
                      <div className="document-body">
                        <a
                          href={`/api/documents/${d.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="button secondary"
                        >
                          {t("documents.view")}
                          <ArrowUpRight size={15} />
                        </a>
                        <h3>{t("documents.preview")}</h3>
                        <pre>
                          {d.text_content.slice(0, 12000) ||
                            t("documents.noText")}
                        </pre>
                      </div>
                    </details>
                  ))
                )}
              </div>
            </>
          )}
          {w && view === "review" && (
            <>
              {title("review")}
              <details
                className="panel entry-panel"
                open
              >
                <summary>
                  <Plus size={18} />
                  <strong>{t("review.new")}</strong>
                </summary>
                <EntryForm profile={p!} documents={w.documents} />
              </details>
              <section className="panel">
                <div className="section-heading">
                  <h2>{t("review.bank")}</h2>
                  <span className="badge blue">{unposted.length}</span>
                </div>
                <p className="help">{t("review.bankHelp")}</p>
                {w.bankRows.length ? (
                  <div className="bank-list">
                    {w.bankRows.map((r) => (
                      <div className="bank-row" key={r.id}>
                        <div>
                          <small>{date(r.booking_date)}</small>
                          <strong>{r.description}</strong>
                          <span className="numeric">{money(r.amount)}</span>
                        </div>
                        {r.posted_entry ? (
                          <span className="badge green">
                            <Check size={14} />
                            {t("review.posted")}
                          </span>
                        ) : (
                          <BankForm row={r} />
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-inline">{t("review.noBank")}</p>
                )}
              </section>
              <section className="panel ledger">
                <div className="section-heading">
                  <h2>{t("review.ledger")}</h2>
                  <span className="muted">
                    {t("review.lines", { count: w.entries.length })}
                  </span>
                </div>
                {!w.entries.length ? (
                  <p className="empty-inline">{t("review.empty")}</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("common.date")}</th>
                          <th>{t("common.description")}</th>
                          <th>{t("common.account")}</th>
                          <th className="numeric">{t("common.debit")}</th>
                          <th className="numeric">{t("common.credit")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {w.entries.toReversed().flatMap((e) =>
                          e.lines.map((l, i) => (
                            <tr
                              key={`${e.id}-${i}`}
                              className={i === 0 ? "entry-first" : ""}
                            >
                              <td>{i === 0 ? date(e.entry_date) : ""}</td>
                              <td>
                                {i === 0 ? (
                                  <>
                                    {e.description}
                                    {e.source_id && (
                                      <a
                                        className="source-link"
                                        href={`/api/documents/${e.source_id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        <FileText size={13} />
                                        {t("common.source")}
                                      </a>
                                    )}
                                  </>
                                ) : (
                                  ""
                                )}
                              </td>
                              <td>{t(`account.${l.account}`)}</td>
                              <td className="numeric">
                                {l.debit === "0.00" ? "—" : money(l.debit)}
                              </td>
                              <td className="numeric">
                                {l.credit === "0.00" ? "—" : money(l.credit)}
                              </td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
          {w && view === "yearend" && (
            <>
              {title("yearend")}
              <p className="notice">{t("yearend.notice")}</p>
              <div className="checklist">
                {req.map((key, i) => {
                  const evidence = w.evidence.find(
                    (e) => e.requirement === key,
                  );
                  return (
                    <details className="panel requirement" key={key}>
                      <summary>
                        {evidence ? (
                          <Check className="complete-icon" size={20} />
                        ) : (
                          <Circle size={20} className="muted" />
                        )}
                        <span>
                          <strong>{t(`yearend.${key}`)}</strong>
                          <small>{t(`yearend.${key}Help`)}</small>
                        </span>
                        <span className={`badge ${evidence ? "green" : ""}`}>
                          {t(evidence ? "common.supplied" : "common.pending")}
                        </span>
                      </summary>
                      <EvidenceForm requirement={key} note={evidence?.note} />
                    </details>
                  );
                })}
              </div>
            </>
          )}
          {w && view === "report" && (
            <>
              {title("report")}
              <div className="report-toolbar">
                <form method="get">
                  <input name="view" type="hidden" value="report" />
                  <label>
                    {t("report.language")}
                    <select
                      name="reportLocale"
                      defaultValue={params.reportLocale ?? locale}
                    >
                      <option value="nl">Nederlands</option>
                      <option value="en">English</option>
                    </select>
                  </label>
                  <button className="button secondary">
                    {t("common.open")}
                  </button>
                </form>
                <div>
                  <a className="button secondary" href="/api/export">
                    {t("report.csv")}
                  </a>
                  <PrintButton />
                </div>
              </div>
              <aside className="notice report-readiness">
                <strong>{t("report.readiness")}</strong>
                <ul>
                  {readiness(
                    p!,
                    w.entries.length,
                    req.length - supplied,
                    unposted.length,
                  ).map((k) => (
                    <li key={k}>{t(`report.${k}`)}</li>
                  ))}
                </ul>
              </aside>
              <Report
                workspace={w}
                locale={
                  params.reportLocale === "nl"
                    ? "nl"
                    : params.reportLocale === "en"
                      ? "en"
                      : locale
                }
              />
            </>
          )}
          {w && <ReportNext view={view} />}
        </main>
        <footer className="app-footer">
          <span>{t("app.footer")}</span>
          <span>Lavin · 0.1</span>
        </footer>
      </div>
    </div>
  );
}
function FilesIcon() {
  return <FolderOpen size={32} strokeWidth={1.4} />;
}
