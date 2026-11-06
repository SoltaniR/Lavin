import { z } from "zod";

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  year: z.coerce.number().int().min(2025).max(2026),
  kvk: z.string().regex(/^(\d{8})?$/),
  activity: z.enum(["services", "salon"]),
  vatMethod: z.enum(["invoice", "cash", "unknown"]),
  cash: z.boolean(),
  stock: z.boolean(),
  equipment: z.boolean(),
  premises: z.boolean(),
  staff: z.boolean(),
  loans: z.boolean(),
  firstYear: z.boolean(),
});
export type Profile = z.infer<typeof profileSchema>;
export type Business = { id: string; profile: Profile; created_at: string };
export type AccountKind =
  "asset" | "liability" | "equity" | "income" | "expense";
export const accounts: { code: string; kind: AccountKind }[] = [
  { code: "bank", kind: "asset" },
  { code: "cash", kind: "asset" },
  { code: "receivables", kind: "asset" },
  { code: "inventory", kind: "asset" },
  { code: "equipment", kind: "asset" },
  { code: "deposit", kind: "asset" },
  { code: "prepayments", kind: "asset" },
  { code: "vatInput", kind: "asset" },
  { code: "payables", kind: "liability" },
  { code: "vatOutput", kind: "liability" },
  { code: "loan", kind: "liability" },
  { code: "accruals", kind: "liability" },
  { code: "capital", kind: "equity" },
  { code: "drawings", kind: "equity" },
  { code: "sales", kind: "income" },
  { code: "purchases", kind: "expense" },
  { code: "rent", kind: "expense" },
  { code: "utilities", kind: "expense" },
  { code: "personnel", kind: "expense" },
  { code: "otherCosts", kind: "expense" },
  { code: "depreciation", kind: "expense" },
];
export type Line = { account: string; debit: string; credit: string };
export type Journal = {
  id: string;
  entry_date: string;
  description: string;
  kind: string;
  lines: Line[];
  source_id: string | null;
};
export type Document = {
  id: string;
  name: string;
  kind: "pdf" | "mt940";
  status: string;
  text_content: string;
  sha256: string;
  created_at: string;
};
export type BankRow = {
  id: string;
  document_id: string;
  booking_date: string;
  amount: string;
  description: string;
  reference: string;
  posted_entry: string | null;
};
export type Evidence = { requirement: string; note: string };
export type Workspace = {
  business: Business;
  documents: Document[];
  entries: Journal[];
  bankRows: BankRow[];
  evidence: Evidence[];
};

export const defaultProfile: Profile = {
  name: "",
  year: 2025,
  kvk: "",
  activity: "services",
  vatMethod: "unknown",
  cash: false,
  stock: false,
  equipment: false,
  premises: false,
  staff: false,
  loans: false,
  firstYear: false,
};

export function requirements(p: Profile): string[] {
  return [
    "opening",
    "bank",
    "sales",
    "purchases",
    "vat",
    "owner",
    "cutoff",
    ...(!p.firstYear ? ["comparatives"] : []),
    ...(
      ["cash", "stock", "equipment", "premises", "staff", "loans"] as const
    ).filter((k) => p[k]),
  ];
}
