"use client";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { LoaderCircle, Check, UploadCloud } from "lucide-react";
import {
  saveProfile,
  saveEntry,
  uploadDocument,
  saveEvidence,
  postBankRow,
  loadDemo,
  type ActionState,
} from "@/app/actions";
import {
  accounts,
  defaultProfile,
  type Business,
  type Document,
  type Profile,
  type BankRow,
} from "@/lib/model";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;
export function ActionForm({
  action,
  children,
  label,
  reset = false,
  className = "",
  nextHref,
}: {
  action: Action;
  children?: ReactNode;
  label: string;
  reset?: boolean;
  className?: string;
  nextHref?: string;
}) {
  const t = useTranslations(),
    [state, submit, pending] = useActionState(action, {}),
    ref = useRef<HTMLFormElement>(null);
  const [key, setKey] = useState("");
  useEffect(() => {
    setKey(crypto.randomUUID());
  }, []);
  useEffect(() => {
    if (state.success) {
      if (reset) ref.current?.reset();
      setKey(crypto.randomUUID());
    }
  }, [state, reset]);
  return (
    <form action={submit} ref={ref} className={className}>
      <input type="hidden" name="requestKey" value={key} />
      <fieldset disabled={pending}>
        {children}
        <button
          className="button primary"
          type="submit"
          disabled={!key || pending}
        >
          {pending ? <LoaderCircle size={17} className="spin" /> : null}
          {pending ? t("common.saving") : label}
        </button>
      </fieldset>
      <div aria-live="polite">
        {state.error && (
          <p className="feedback error" role="alert">
            {t(`errors.${state.error}`)}
          </p>
        )}
        {state.success && (
          <p className="feedback success">
            <Check size={15} />
            {t("common.saved")}
            {nextHref && <Link className="text-link" href={nextHref}>{t("common.continue")}</Link>}
          </p>
        )}
      </div>
    </form>
  );
}
export function DemoForm() {
  const t = useTranslations();
  return (
    <ActionForm
      action={loadDemo}
      label={t("app.sample")}
      className="demo-form"
    />
  );
}
export function ProfileForm({ business }: { business?: Business }) {
  const t = useTranslations(),
    p = business?.profile ?? defaultProfile;
  return (
    <ActionForm
      action={saveProfile}
      label={t(business ? "common.save" : "business.create")}
      className="profile-form"
      nextHref="/?view=documents"
    >
      {business && <input type="hidden" name="id" value={business.id} />}
      <div className="form-grid">
        <label className="wide">
          {t("business.name")}
          <input
            name="name"
            required
            minLength={2}
            maxLength={120}
            defaultValue={p.name}
            autoComplete="organization"
          />
        </label>
        <label>
          {t("business.kvk")}{" "}
          <span className="muted">({t("common.optional")})</span>
          <input
            name="kvk"
            pattern="[0-9]{8}"
            maxLength={8}
            defaultValue={p.kvk}
            inputMode="numeric"
          />
        </label>
        <label>
          {t("business.year")}
          <select name="year" defaultValue={p.year}>
            {(business ? [p.year] : [2025, 2026]).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <label>
          {t("business.activity")}
          <select name="activity" defaultValue={p.activity}>
            <option value="services">{t("business.services")}</option>
            <option value="salon">{t("business.salon")}</option>
          </select>
        </label>
        <label>
          {t("business.vat")}
          <select name="vatMethod" defaultValue={p.vatMethod}>
            <option value="unknown">{t("business.unknown")}</option>
            <option value="invoice">{t("business.invoice")}</option>
            <option value="cash">{t("business.cashMethod")}</option>
          </select>
        </label>
      </div>
      <p className="help">{t("business.vatHelp")}</p>
      <h3>{t("business.features")}</h3>
      <div className="check-grid">
        {(
          [
            "cash",
            "stock",
            "equipment",
            "premises",
            "staff",
            "loans",
            "firstYear",
          ] as const
        ).map((key) => (
          <label className="checkbox" key={key}>
            <input type="checkbox" name={key} defaultChecked={p[key]} />
            {t(`business.${key}`)}
          </label>
        ))}
      </div>
      {business && <p className="help">{t("business.yearFixed")}</p>}
    </ActionForm>
  );
}
function AccountSelect({
  name,
  filter,
  initial,
}: {
  name: string;
  filter?: (a: (typeof accounts)[number]) => boolean;
  initial?: string;
}) {
  const t = useTranslations();
  return (
    <select name={name} defaultValue={initial} required>
      {accounts.filter(filter ?? (() => true)).map((a) => (
        <option value={a.code} key={a.code}>
          {t(`account.${a.code}`)}
        </option>
      ))}
    </select>
  );
}
export function EntryForm({
  profile,
  documents,
}: {
  profile: Profile;
  documents: Document[];
}) {
  const t = useTranslations(),
    [kind, setKind] = useState("sale");
  const invoice = ["sale", "purchase"].includes(kind);
  return (
    <ActionForm action={saveEntry} label={t("review.post")}>
      <div className="form-grid">
        <label>
          {t("review.kind")}
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {["sale", "purchase", "payment", "opening", "adjustment"].map(
              (k) => (
                <option key={k} value={k}>
                  {t(`review.${k}`)}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          {t("common.date")}
          <input
            type="date"
            name="date"
            min={`${profile.year}-01-01`}
            max={`${profile.year}-12-31`}
            defaultValue={`${profile.year}-01-01`}
            required
          />
        </label>
        <label className="wide">
          {t("common.description")}
          <input name="description" minLength={3} maxLength={240} required />
        </label>
        <label>
          {t("review.gross")}
          <input
            name="amount"
            inputMode="decimal"
            pattern="[0-9]+(\.[0-9]{1,2})?"
            placeholder="0.00"
            required
          />
        </label>
        {invoice ? (
          <label>
            {t("review.vat")}
            <input
              name="vat"
              inputMode="decimal"
              pattern="[0-9]+(\.[0-9]{1,2})?"
              defaultValue="0"
              required
            />
          </label>
        ) : (
          <input type="hidden" name="vat" value="0" />
        )}
        {kind === "purchase" && (
          <label className="wide">
            {t("review.category")}
            <AccountSelect
              name="debit"
              initial="otherCosts"
              filter={(a) => ["expense", "asset"].includes(a.kind)}
            />
          </label>
        )}
        {!invoice && (
          <>
            <label>
              {t("common.debit")}
              <AccountSelect
                name="debit"
                initial="bank"
                filter={(a) =>
                  kind !== "opening" || !["expense", "income"].includes(a.kind)
                }
              />
            </label>
            <label>
              {t("common.credit")}
              <AccountSelect
                name="credit"
                initial="capital"
                filter={(a) =>
                  kind !== "opening" || !["expense", "income"].includes(a.kind)
                }
              />
            </label>
          </>
        )}
        {kind === "sale" && (
          <input type="hidden" name="debit" value="receivables" />
        )}
        {invoice && <input type="hidden" name="credit" value="payables" />}
        <label className="wide">
          {t("common.source")}
          <select name="sourceId">
            <option value="">{t("common.noSource")}</option>
            {documents.map((d) => (
              <option value={d.id} key={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="help">
        {t(invoice ? "review.invoiceHelp" : "review.journalHelp")}{" "}
        {t("review.amountHelp")}
      </p>
    </ActionForm>
  );
}
export function UploadForm() {
  const t = useTranslations();
  return (
    <ActionForm action={uploadDocument} label={t("documents.submit")} reset nextHref="/?view=review">
      <label className="upload-zone">
        <UploadCloud size={30} />
        <strong>{t("documents.choose")}</strong>
        <span>{t("documents.accept")}</span>
        <input
          type="file"
          name="file"
          accept=".pdf,.mt940,.sta,.940,.txt"
          required
          aria-label={t("documents.choose")}
        />
      </label>
    </ActionForm>
  );
}
export function EvidenceForm({
  requirement,
  note,
}: {
  requirement: string;
  note?: string;
}) {
  const t = useTranslations();
  return (
    <ActionForm action={saveEvidence} label={t("yearend.save")}>
      <input type="hidden" name="requirement" value={requirement} />
      <label>
        {t("common.notes")}
        <textarea
          name="note"
          rows={3}
          minLength={5}
          maxLength={2000}
          required
          defaultValue={note}
          placeholder={t("yearend.placeholder")}
        />
      </label>
    </ActionForm>
  );
}
export function BankForm({ row }: { row: BankRow }) {
  const t = useTranslations();
  return (
    <ActionForm
      action={postBankRow}
      label={t("review.postBank")}
      className="bank-form"
    >
      <input type="hidden" name="rowId" value={row.id} />
      <label>
        <span className="sr-only">{t("common.account")}</span>
        <AccountSelect
          name="account"
          initial={row.amount.startsWith("-") ? "payables" : "receivables"}
          filter={(a) => a.code !== "bank"}
        />
      </label>
    </ActionForm>
  );
}
export function PrintButton() {
  const t = useTranslations();
  return (
    <button className="button primary" onClick={() => window.print()}>
      {t("report.print")}
    </button>
  );
}
