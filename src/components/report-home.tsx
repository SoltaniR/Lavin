import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, FolderOpen, PencilLine, Plus } from "lucide-react";
import { DemoForm } from "./forms";

export async function ReportHome() {
  const t = await getTranslations();
  return <div className="report-home">
    <header className="page-heading"><h1>{t("home.title")}</h1><p>{t("home.subtitle")}</p></header>
    <div className="home-choices">
      <Link className="home-choice home-create" href="/?view=setup">
        <Plus size={30} /><div><h2>{t("home.new")}</h2><p>{t("home.newHelp")}</p><span>{t("home.start")}</span></div><ArrowRight size={22} />
      </Link>
      <Link className="home-choice" href="/?view=companies">
        <FolderOpen size={26} /><div><h2>{t("home.existing")}</h2><p>{t("home.existingHelp")}</p></div><ArrowRight size={20} />
      </Link>
      <Link className="home-choice" href="/?view=companies&mode=edit">
        <PencilLine size={26} /><div><h2>{t("home.edit")}</h2><p>{t("home.editHelp")}</p></div><ArrowRight size={20} />
      </Link>
    </div>
    <details className="sample-option"><summary>{t("home.sample")}</summary><p>{t("home.sampleHelp")}</p><DemoForm /></details>
  </div>;
}
