import Link from "next/link";
import { getTranslations } from "next-intl/server";

const steps = ["business", "documents", "review", "yearend", "report"];
export async function ReportSteps({ view, ready }: { view: string; ready: boolean }) {
  const t = await getTranslations();
  const active = view === "setup" ? 0 : steps.indexOf(view);
  if (active < 0) return null;
  return <div className="report-steps" aria-label={t("flow.label")}>
    <p>{t("flow.position", { step: active + 1 })}</p>
    <ol>{steps.map((step, i) => <li key={step} aria-current={active === i ? "step" : undefined}>
      {ready ? <Link href={`/?view=${step}`}><span>{i + 1}</span>{t(`flow.${step}`)}</Link>
        : <span className="future-step"><span>{i + 1}</span>{t(`flow.${step}`)}</span>}
    </li>)}</ol>
  </div>;
}
export async function ReportNext({ view }: { view: string }) {
  const t = await getTranslations(), index = steps.indexOf(view);
  if (index < 0) return null;
  return <div className="report-next">
    <p>{t("flow.saveFirst")}</p>
    <div><Link className="button secondary" href={index === 0 ? "/?view=overview" : `/?view=${steps[index - 1]}`}>{t("flow.back")}</Link>
      <Link className="button primary" href={index === 4 ? "/?view=companies" : `/?view=${steps[index + 1]}`}>
        {index === 4 ? t("flow.return") : t("flow.next", { name: t(`flow.${steps[index + 1]}`) })}
      </Link></div>
  </div>;
}
