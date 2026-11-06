import Link from "next/link";
import { getTranslations } from "next-intl/server";

const steps = ["business", "documents", "review", "yearend", "report"] as const;
export async function UserGuide() {
  const t = await getTranslations();
  return <>
    <header className="page-heading"><h1>{t("guide.title")}</h1><p>{t("guide.intro")}</p></header>
    <div className="guide-layout">
      <ol className="guide-steps">
        {steps.map((step, index) => <li className="guide-step" key={step}>
          <span className="step-number">{index + 1}</span><div>
            <h2>{t(`guide.${step}.title`)}</h2><p>{t(`guide.${step}.text`)}</p>
            <p className="guide-tip">{t(`guide.${step}.tip`)}</p>
            <Link className="text-link" href={`/?view=${step}`}>{t(`guide.${step}.action`)}</Link>
          </div>
        </li>)}
      </ol>
      <aside className="guide-reference">
        <section className="panel"><h2>{t("guide.prepareTitle")}</h2><p>{t("guide.prepareText")}</p></section>
        <section className="panel"><h2>{t("guide.exampleTitle")}</h2><p>{t("guide.exampleText")}</p></section>
        <section className="panel"><h2>{t("guide.termsTitle")}</h2><dl>
          {["receivables", "payables", "opening"].map(term => <div key={term}><dt>{t(`guide.${term}`)}</dt><dd>{t(`guide.${term}Text`)}</dd></div>)}
        </dl></section>
      </aside>
    </div>
  </>;
}
export async function TaskHelp({ view }: { view: string }) {
  if (!steps.includes(view as typeof steps[number])) return null;
  const t = await getTranslations();
  return <details className="task-help"><summary>{t("guide.help")}</summary>
    <p>{t(`guide.${view}.text`)}</p><p>{t(`guide.${view}.tip`)}</p>
    <Link className="text-link" href="/?view=guide">{t("guide.open")}</Link>
  </details>;
}
