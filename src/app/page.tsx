import Link from "next/link";
import { redirect } from "next/navigation";
import { hasAccess, configuration } from "@/lib/server/access";
import { LogoutButton } from "@/components/login-form";
import { UserGuide, TaskHelp } from "@/components/user-guide";
import { ReportHome } from "@/components/report-home";
import { CompanyPicker } from "@/components/company-picker";
import { ReportSteps, ReportNext } from "@/components/report-steps";
import { VatReview } from "@/components/vat-review";
import { DocumentManagement, UploadForm } from "@/components/document-upload";
import { InvoiceReview } from "@/components/invoice-review";
import { DocumentChecklist } from "@/components/document-checklist";
import { ReportYear } from "@/components/report-year";
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
import { isInvoicePurpose, requirements, uploadPurposes } from "@/lib/model";
import { documentCoverage } from "@/lib/report-intake";
import { quarters, quarterSchema } from "@/lib/vat";
import { financials, readiness } from "@/lib/accounting";
import { setLocale } from "./actions";
import { Navigation } from "@/components/navigation";
import {
  ProfileForm,
  EntryForm,
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
  const views = ["home", "companies", "setup", "overview", "business", "documents", "review", "vat", "yearend", "report", "guide"];
  const requested = params.view === "business" && params.new ? "setup" : params.view ?? "home";
  const view = views.includes(requested) ? requested : "home";
  const companyView = !["home", "companies", "setup", "guide"].includes(view);
  const trashed = view === "companies" && params.trash === "1";
  const [t, locale, w, list] = await Promise.all([
    getTranslations(),
    getLocale(),
    companyView ? workspace() : Promise.resolve(null),
    view === "companies" ? businesses(trashed) : Promise.resolve([]),
  ]);
  if (companyView && !w) redirect("/?view=companies");
  const p = w?.business.profile;
  const pendingDrafts = w?.invoiceDrafts?.filter(draft => !draft.posted_entry).length ?? 0;
  const bankIssues = w?.documents.filter(document => document.purpose === "bank" && ["bankPdfReview", "needsOcr"].includes(document.status)).length ?? 0;
  const uploadPurpose = uploadPurposes.find(purpose => purpose === params.kind);
  const manualSource = view === "review" ? w?.documents.find(d => d.id === params.manualSource && isInvoicePurpose(d.purpose)) : undefined;
  const coverage = view === "report" && w ? documentCoverage(w) : undefined;
  const coverageGaps = coverage && Object.values(coverage.groups).flat().filter(state => state === "missing" || state === "partial").length;
  const postedDocuments = view === "documents" && w ? new Set([
    ...w.entries.map(entry => entry.source_id),
    ...w.bankRows.filter(row => row.posted_entry).map(row => row.document_id),
    ...(w.invoiceDrafts ?? []).filter(draft => draft.posted_entry).map(draft => draft.document_id),
  ]) : undefined;
  const bookedRates = new Map((w?.invoiceDrafts ?? []).flatMap(draft => {
    const exchange = draft.fields.exchange;
    return draft.posted_entry && exchange ? [[draft.posted_entry, t("imports.exchangeSummary", {
      amount: draft.fields.foreign?.amount ?? "", currency: exchange.currency,
      date: exchange.date, rate: exchange.unitsPerEuro,
    })] as const] : [];
  }));
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
          {view === "companies" && <CompanyPicker key={trashed ? "trash" : "saved"} businesses={list} editing={params.mode === "edit"} trashed={trashed} />}
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
              <ReportYear workspace={w} preview={params.changeYear === "1"} />
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
              <p className="notice">{t("intake.uploadYear", { year: w.business.profile.year })}{" "}
                <Link className="text-link" href="/?view=business#report-year">{t("intake.checkYear")}</Link></p>
              <div className="content-split">
                <section className="panel" id="upload-documents">
                  <h2>{t("documents.upload")}</h2>
                  <UploadForm key={uploadPurpose ?? "auto"} businessId={w.business.id} initial={uploadPurpose} />
                  <p className="help">{t("documents.capability")}</p>
                  <a className="text-link" download="lavin-invoices.csv"
                    href="data:text/csv;charset=utf-8,reference%3Bdate%3Btotal%3Bvat%3Bdescription%0D%0A">
                    {t("imports.csvTemplate")}
                  </a>
                </section>
                <aside className="side-note">
                  <FolderOpen size={30} />
                  <h3 aria-live="polite">{t("documents.count", { count: w.documents.length })}</h3>
                  <p>{t("documents.textNote")}</p>
                  <h3>{t("documents.gather")}</h3>
                  <p>{t("documents.gatherHelp")}</p>
                  <ul className="import-links">
                    <li><Link className="text-link" href="/?view=review#invoice-review">{t("imports.openReview")}</Link></li>
                    <li><Link className="text-link" href="/?view=review#bank-imports">{t("review.bank")}</Link></li>
                  </ul>
                  <h3 id="return-periods">{t("imports.vatReturns")}</h3>
                  {p?.vatScope === "ordinaryQuarterly" ? <ul className="import-quarters">
                    {quarters.map(quarter => {
                      const linked = w.vatReturns.some(filed => filed.quarter === quarter);
                      const found = w.documents.find(d => d.purpose === "vat" && d.vat_suggestion?.quarter === quarter &&
                        d.vat_suggestion.year === p.year);
                      return <li key={quarter}>
                        <Link className="text-link" href={"/?view=vat&quarter=" + quarter + (!linked && found ? "&source=" + found.id : "")}>
                          {t("vat.period", { quarter, year: p.year })}
                        </Link>
                        <span className="muted">{t(linked ? "imports.linked" : found ? "intake.vatUploaded" : "imports.awaitingReturn")}</span>
                      </li>;
                    })}
                  </ul> : <Link className="text-link" href="/?view=vat">{t("nav.vat")}</Link>}
                  <p className="help">{t("imports.missingQuarterHelp")}</p>
                </aside>
              </div>
              <DocumentChecklist workspace={w} />
              <div className="document-list">
                {w.documents.length === 0 ? (
                  <div className="empty-state">
                    <FilesIcon />
                    <h3>{t("documents.empty")}</h3>
                    <p>{t("documents.emptyText")}</p>
                  </div>
                ) : (
                  w.documents.map((d) => (
                    <details className="panel document" key={d.id} id={"document-" + d.id}>
                      <summary>
                        <FileText size={22} />
                        <span>
                          <strong>{d.name}</strong>
                          <small>{t("imports.purpose." + (d.purpose ?? (d.kind === "mt940" ? "bank" : "unclassified")))}{" · "}
                            <span>{t(`documents.${d.status}`)}</span>
                          </small>
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
                        <DocumentManagement businessId={w.business.id} document={{ id: d.id, kind: d.kind, purpose: d.purpose }}
                          posted={postedDocuments?.has(d.id) ?? false}
                          quarter={w.vatReturns.find(filed => filed.source_id === d.id)?.quarter} />
                        <h3>{t("documents.preview")}</h3>
                        <pre>
                          {d.text_content.slice(0, 12000) ||
                            t("documents.noText")}
                        </pre>
                        {d.purpose === "bank" && d.status === "bankPdfReview" && <p className="notice">{t("imports.bankPdfHelp")}</p>}
                        {d.status === "needsOcr" && <p className="notice">{t("imports.scanHelp")}</p>}
                        {d.invoice_issues?.map(issue => <p className="help" key={issue}>{t("imports.invoiceIssue." + issue)}</p>)}
                        {d.purpose === "vat" && <Link className="text-link" href={"/?view=vat&quarter=" + (d.vat_suggestion?.quarter ?? 1) + "&source=" + d.id}>{t("imports.openVat")}</Link>}
                        {(d.status === "invoiceReady" || d.status === "invoicePartial") && <Link className="text-link" href="/?view=review#invoice-review">{t("imports.openReview")}</Link>}
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
              <InvoiceReview workspace={w} locale={locale} selectedId={params.draft} filter={params.issue}
                page={/^\d+$/.test(params.draftPage ?? "") ? Number(params.draftPage) : 1} />
              <details
                className="panel entry-panel"
                id="manual-entry"
                open={!pendingDrafts || Boolean(manualSource)}
              >
                <summary>
                  <Plus size={18} />
                  <strong>{t("review.new")}</strong>
                </summary>
                <EntryForm key={manualSource?.id ?? "manual"} businessId={w.business.id} profile={p!}
                  sourceName={manualSource?.name} initialSource={manualSource?.id}
                  initialKind={manualSource?.purpose === "purchase" ? "purchase" : "sale"}
                  documents={w.documents.map(({ id, name }) => ({ id, name }))} />
              </details>
              <section className="panel" id="bank-imports">
                <div className="section-heading">
                  <h2>{t("review.bank")}</h2>
                  <Link className="text-link" href="/?view=documents&kind=bank">{t("imports.uploadBank")}</Link>
                </div>
                <p className="help">{t("review.bankHelp")}</p>
                {bankIssues > 0 && <p className="notice">{t("imports.bankIssueCount", { count: bankIssues })}</p>}
                {w.bankRows.length ? (
                  <div className="bank-list">
                    {w.bankRows.map((r) => (
                      <div className="bank-row" key={r.id}>
                        <div>
                          <small>{date(r.booking_date)}</small>
                          <strong>{r.description}</strong>
                          <span className="numeric">{money(r.amount)}</span>
                          <a className="source-link" href={"/api/documents/" + r.document_id}
                            target="_blank" rel="noreferrer">{t("common.source")}</a>
                        </div>
                        {r.posted_entry ? (
                          <span className="badge green">
                            <Check size={14} />
                            {t("review.posted")}
                          </span>
                        ) : (
                          <BankForm row={r} businessId={w.business.id} />
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
                                    {bookedRates.has(e.id) && <p className="help">{bookedRates.get(e.id)}</p>}
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
          {w && view === "vat" && (
            <VatReview workspace={w} quarter={quarterSchema.safeParse(params.quarter).data ?? 1} locale={locale} selectedSource={params.source} />
          )}
          {w && view === "yearend" && (
            <>
              {title("yearend")}
              <p className="notice">{t("yearend.notice")}</p>
              <div className="checklist">
                {req.map(key => {
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
                      {key === "vat" && <Link className="text-link" href="/?view=vat">{t("nav.vat")}</Link>}
                      <EvidenceForm businessId={w.business.id} requirement={key} note={evidence?.note} />
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
                  <a className="button secondary" href={`/api/export?reportId=${w.business.id}`}>
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
                  {pendingDrafts > 0 && <li><Link className="guide-link" href="/?view=review#invoice-review">
                    {t("imports.draftWarning", { count: pendingDrafts })}</Link></li>}
                  {bankIssues > 0 && <li><Link className="guide-link" href="/?view=review#bank-imports">
                    {t("imports.bankIssueCount", { count: bankIssues })}</Link></li>}
                  {Boolean(coverageGaps) && <li><Link className="guide-link" href="/?view=documents#document-checklist">
                    {t("intake.reportGaps", { count: coverageGaps! })}</Link></li>}
                  {coverage && Object.values(coverage.groups).flat().some(state => state === "open" || state === "future") &&
                    <li><Link className="guide-link" href="/?view=documents#document-checklist">{t("intake.reportOpen")}</Link></li>}
                  <li><Link className="guide-link" href="/?view=vat">{t("report.vatReview")}</Link></li>
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
          {w && view !== "documents" && <ReportNext view={view} />}
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
