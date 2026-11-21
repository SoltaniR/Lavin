import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Workspace } from "@/lib/model";
import { documentCoverage } from "@/lib/report-intake";

export async function DocumentChecklist({ workspace }: { workspace: Workspace }) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const year = workspace.business.profile.year;
  const { groups, unread } = documentCoverage(workspace);
  const hasGaps = Object.values(groups).flat().some(state => state !== "present") || Object.values(unread).some(Boolean);
  const month = new Intl.DateTimeFormat(locale === "nl" ? "nl-NL" : "en-GB", { month: "long", timeZone: "UTC" });
  const list = new Intl.ListFormat(locale === "nl" ? "nl-NL" : "en-GB", { style: "long", type: "conjunction" });
  return <section className="panel document-checklist" id="document-checklist">
    <h2>{t("intake.title", { year })}</h2>
    <p className="help">{t("intake.help")}</p>
    <ul className="coverage-list">
      {(["sale", "purchase", "bank", "vat"] as const).map(kind => {
        const periods = groups[kind];
        return <li key={kind}>
          <div className="section-heading">
            <h3>{t("imports.purpose." + kind)}</h3>
            <Link className="text-link" href={`/?view=documents&kind=${kind}#upload-documents`}>
              {t("intake.add." + kind)}
            </Link>
          </div>
          {periods.length ? <dl>{(["missing", "partial", "open", "future", "present"] as const).map(state => {
            const labels = periods.flatMap((value, i) => value !== state ? [] : [kind === "vat"
              ? t("vat.period", { quarter: i + 1, year })
              : month.format(new Date(Date.UTC(year, i, 1)))]);
            return labels.length ? <div className={`coverage-${state}`} key={state}>
              <dt>{t("intake." + state)}</dt><dd>{list.format(labels)}</dd>
            </div> : null;
          })}</dl> : <p className="help">{t("intake.vatScope")}{" "}
            <Link className="text-link" href="/?view=business">{t("nav.business")}</Link></p>}
          {unread[kind] > 0 && <p className="help">
            <Link className="text-link" href={kind === "vat" ? "/?view=vat" : kind === "bank"
              ? "/?view=review#bank-imports" : "/?view=review&issue=input#invoice-review"}>
              {t("intake.unverified", { count: unread[kind] })}
            </Link>
          </p>}
        </li>;
      })}
    </ul>
    <p className="help">{t("intake.continueHelp")}</p>
    <Link className="text-link" href="/?view=yearend">{t("intake.yearEndRecords")}</Link>
    <div className="report-next">
      <div>
        <Link className="button secondary" href="/?view=business">{t("flow.back")}</Link>
        <Link className="button primary" href="/?view=review">{t(hasGaps ? "intake.continueWithGaps" : "intake.continue")}</Link>
      </div>
    </div>
  </section>;
}
