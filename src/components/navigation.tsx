"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  Building2,
  Files,
  BookOpen,
  ListChecks,
  FileChartColumn,
  CircleHelp,
} from "lucide-react";
const items = [
  ["overview", LayoutDashboard],
  ["business", Building2],
  ["documents", Files],
  ["review", BookOpen],
  ["yearend", ListChecks],
  ["report", FileChartColumn],
  ["guide", CircleHelp],
] as const;
export function Navigation() {
  const t = useTranslations(),
    active = useSearchParams().get("view") ?? "overview";
  return (
    <nav aria-label="Lavin">
      {items.map(([key, Icon]) => (
        <Link
          key={key}
          href={`/?view=${key}`}
          className={active === key ? "active" : ""}
          aria-current={active === key ? "page" : undefined}
        >
          <Icon size={19} />
          {t(`nav.${key}`)}
        </Link>
      ))}
    </nav>
  );
}
