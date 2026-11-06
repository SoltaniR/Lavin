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
  House,
  Plus,
} from "lucide-react";
const items = [
  ["home", House],
  ["companies", Building2],
  ["setup", Plus],
  ["overview", LayoutDashboard],
  ["business", Building2],
  ["documents", Files],
  ["review", BookOpen],
  ["yearend", ListChecks],
  ["report", FileChartColumn],
  ["guide", CircleHelp],
] as const;
export function Navigation({ selected = false }: { selected?: boolean }) {
  const t = useTranslations(),
    active = useSearchParams().get("view") ?? "home";
  return (
    <nav aria-label="Lavin">
      {items.filter(([key]) => selected ? !["setup", "guide"].includes(key) : ["home", "companies", "setup", "guide"].includes(key)).map(([key, Icon]) => (
        <Link
          key={key}
          href={key === "home" ? "/" : `/?view=${key}`}
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
