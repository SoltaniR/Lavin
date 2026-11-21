"use client";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { LoaderCircle, Check } from "lucide-react";
import {
  saveProfile,
  saveEntry,
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
  type InvoiceDraft,
} from "@/lib/model";
import { purchaseAccounts } from "@/lib/accounting";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;
export function ActionForm({
  action,
  children,
  label,
  reset = false,
  className = "",
  nextHref,
  successHref,
  submitHidden = false,
  onNext,
}: {
  action: Action;
  children?: ReactNode;
  label: string;
  reset?: boolean;
  className?: string;
  nextHref?: string;
  successHref?: string;
  submitHidden?: boolean;
  onNext?: () => void;
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
      if (successHref) { window.location.assign(successHref); return; }
      if (reset) ref.current?.reset();
      setKey(crypto.randomUUID());
    }
  }, [state, reset, successHref]);
  return (
    <form action={submit} ref={ref} className={className} onSubmit={event => {
      event.preventDefault();
      if (submitHidden) { onNext?.(); return; }
      if (pending || !key) return;
      // Keep inputs available for correction when the action returns a validation error.
      const data = new FormData(event.currentTarget);
      startTransition(() => submit(data));
    }}>
      <input type="hidden" name="requestKey" value={key} />
      <fieldset disabled={pending || Boolean(state.success && successHref)}>
        {children}
        <button
          className="button primary"
          type="submit"
          hidden={submitHidden}
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
      successHref="/?view=overview"
    />
  );
}
export function ProfileForm({ business, guided = false }: { business?: Business; guided?: boolean }) {
  const t = useTranslations(),
    p = business?.profile ?? defaultProfile;
  const savedProfile = business ? JSON.stringify(p) : "new";
  const [step, setStep] = useState(1);
  const firstPanel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const next = () => {
    const name = firstPanel.current?.querySelector<HTMLInputElement>('input[name="name"]');
    if (name) name.value = name.value.trim();
    const fields = firstPanel.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select") ?? [];
    for (const field of fields) if (!field.reportValidity()) return;
    setStep(2);
  };
  useEffect(() => { if (guided) heading.current?.focus(); }, [step, guided]);
  return (
    <ActionForm
      action={saveProfile}
      label={t(guided ? "setup.create" : business ? "common.save" : "business.create")}
      className="profile-form"
      nextHref={business ? "/?view=overview" : "/?view=documents"}
      successHref={guided ? "/?view=documents" : undefined}
      submitHidden={guided && step === 1}
      onNext={next}
    >
      {guided && <div className="setup-heading"><p className="muted">{t("setup.part", { step })}</p>
        <h2 tabIndex={-1} ref={heading}>{t(step === 1 ? "setup.basics" : "setup.records")}</h2>
        <p>{t(step === 1 ? "setup.basicsHelp" : "setup.recordsHelp")}</p></div>}
      {business && <input type="hidden" name="id" value={business.id} />}
      <div key={`basics:${savedProfile}`} ref={firstPanel} hidden={guided && step !== 1}>
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
      </div>
      </div>
      <div key={`records:${savedProfile}`} hidden={guided && step !== 2}>
      <div className="form-grid">
        <label className="wide">
          {t("business.vat")}
          <select name="vatMethod" defaultValue={p.vatMethod}>
            <option value="unknown">{t("business.unknown")}</option>
            <option value="invoice">{t("business.invoice")}</option>
            <option value="cash">{t("business.cashMethod")}</option>
          </select>
        </label>
        <label className="wide">
          {t("business.vatScope")}
          <select name="vatScope" defaultValue={p.vatScope ?? "unknown"}>
            {(["unknown", "ordinaryQuarterly", "other"] as const).map(scope => (
              <option key={scope} value={scope}>{t(`business.vatScope_${scope}`)}</option>
            ))}
          </select>
          <span className="help">{t("business.vatScopeHelp")}</span>
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
      </div>
      {guided && <div className="setup-controls">
        {step === 1 ? <button type="button" className="button primary" onClick={next}>{t("setup.next")}</button>
          : <button type="button" className="button secondary" onClick={() => setStep(1)}>{t("setup.back")}</button>}
        <Link className="text-link" href="/">{t("common.cancel")}</Link>
      </div>}
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
      {initial === "" && <option value="">{t("imports.chooseAccount")}</option>}
      {accounts.filter(filter ?? (() => true)).map((a) => (
        <option value={a.code} key={a.code}>
          {t(`account.${a.code}`)}
        </option>
      ))}
    </select>
  );
}
export function EntryForm({
  businessId,
  profile,
  documents,
  draft,
}: {
  businessId: string;
  profile: Profile;
  documents: Pick<Document, "id" | "name">[];
  draft?: InvoiceDraft;
}) {
  const t = useTranslations(),
    [kind, setKind] = useState<string>(draft ? draft.direction ?? "" : "sale");
  const invoice = ["sale", "purchase"].includes(kind);
  const fields = draft?.fields;
  const invoiceVat = fields?.invoiceVat;
  const vatAmount = useRef<HTMLInputElement>(null);
  return (
    <ActionForm action={saveEntry} label={t("review.post")} reset={!draft}>
      <input type="hidden" name="businessId" value={businessId} />
      {draft && <input type="hidden" name="draftId" value={draft.id} />}
      <div className="form-grid">
        <label>
          {t("review.kind")}
          <select
            name="kind"
            required
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {draft && <option value="">{t("imports.chooseDirection")}</option>}
            {(draft ? ["sale", "purchase"] : ["sale", "purchase", "payment", "opening", "adjustment"]).map(
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
            defaultValue={draft ? fields?.date : profile.year + "-01-01"}
            readOnly={Boolean(fields?.exchange)}
            required
          />
        </label>
        <label className="wide">
          {t("common.description")}
          <input name="description" minLength={3} maxLength={240} required
            defaultValue={fields?.description || (fields?.reference ? t("imports.invoiceDescription", { reference: fields.reference }) : "")} />
        </label>
        <label>
          {t("review.gross")}
          <input
            name="amount"
            inputMode="decimal"
            pattern="[0-9]{1,10}([.,][0-9]{1,2})?"
            placeholder="0.00"
            defaultValue={fields?.amount}
            readOnly={Boolean(fields?.exchange)}
            required
          />
        </label>
        {invoice ? (
          <div>
            <label>
              {t(kind === "purchase" ? "review.deductibleVat" : "review.vat")}
              <input
                key={kind}
                ref={vatAmount}
                name="vat"
                inputMode="decimal"
                pattern="[0-9]{1,10}([.,][0-9]{1,2})?"
                placeholder="0.00"
                defaultValue={kind === "sale" ? invoiceVat : undefined}
                required
              />
            </label>
            {kind === "purchase" && invoiceVat !== undefined &&
              <button className="text-link import-full-vat" type="button" onClick={() => {
                if (vatAmount.current) vatAmount.current.value = invoiceVat;
              }}>{t("imports.useInvoiceVat")}</button>}
          </div>
        ) : (
          <input type="hidden" name="vat" value="0" />
        )}
        {kind === "purchase" && (
          <label className="wide">
            {t("review.category")}
            <AccountSelect
              name="debit"
              initial={draft ? "" : "otherCosts"}
              filter={(a) => purchaseAccounts.includes(a)}
            />
          </label>
        )}
        {!invoice && !draft && (
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
        {draft && !documents.length ? <input type="hidden" name="sourceId" value={draft.document_id} /> : <label className="wide">
          {t(draft ? "imports.originalInvoice" : "common.source")}
          <select name="sourceId">
            <option value={draft?.document_id ?? ""}>{t(draft ? "imports.keepCsv" : "common.noSource")}</option>
            {documents.map((d) => (
              <option value={d.id} key={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>}
      </div>
      {draft && fields?.reference && <details className="import-duplicate">
        <summary>{t("imports.duplicateHelp")}</summary>
        <label className="checkbox"><input type="checkbox" name="confirmDuplicate" />{t("imports.confirmDuplicate")}</label>
      </details>}
      <p className="help">
        {t(kind === "purchase" ? "review.purchaseHelp" : invoice ? "review.invoiceHelp" : "review.journalHelp")}{" "}
        {t("review.amountHelp")}
      </p>
    </ActionForm>
  );
}
export function EvidenceForm({
  businessId,
  requirement,
  note,
}: {
  businessId: string;
  requirement: string;
  note?: string;
}) {
  const t = useTranslations();
  return (
    <ActionForm action={saveEvidence} label={t("yearend.save")}>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="requirement" value={requirement} />
      <label>
        {t("common.notes")}
        <textarea
          key={note}
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
export function BankForm({ row, businessId }: { row: BankRow; businessId: string }) {
  const t = useTranslations();
  return (
    <ActionForm
      action={postBankRow}
      label={t("review.postBank")}
      className="bank-form"
    >
      <input type="hidden" name="rowId" value={row.id} />
      <input type="hidden" name="businessId" value={businessId} />
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
