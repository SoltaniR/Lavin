"use client";

import { useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { UploadCloud } from "lucide-react";
import Link from "next/link";
import { changeDocumentCategory, removeDocument, uploadDocument } from "@/app/actions";
import { isInvoicePurpose, uploadPurposes, type Document, type DocumentPurpose } from "@/lib/model";
import { ActionForm } from "./forms";

function PurposeSelect({ initial = "auto", document }: {
  initial?: string;
  document?: Pick<Document, "kind" | "purpose">;
}) {
  const t = useTranslations();
  const choices = uploadPurposes.filter(purpose =>
    purpose !== document?.purpose && (!document || document.kind === "pdf" ||
      purpose === "auto" || purpose === "evidence" ||
      (document.kind === "mt940" ? purpose === "bank" : purpose === "sale" || purpose === "purchase")),
  );
  return <label>{t(document ? "imports.newCategory" : "imports.type")}
    <select name="purpose" defaultValue={document ? "" : initial} required>
      {document && <option value="">{t("imports.chooseCategory")}</option>}
      {choices.map(purpose =>
        <option key={purpose} value={purpose}>{t("imports.purpose." + purpose)}</option>
      )}
    </select>
  </label>;
}

export function UploadForm({ businessId, initial }: { businessId: string; initial?: string }) {
  const t = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<{
    name: string;
    error?: string;
    imported?: { status: string; purpose: DocumentPurpose };
  }[]>([]);
  const [pending, setPending] = useState(false);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !files.length) return;
    const selected = new FormData(event.currentTarget).get("purpose");
    setPending(true);
    setResults([]);
    const failed: File[] = [];
    try {
      for (const file of files) {
        const form = new FormData();
        form.set("businessId", businessId);
        form.set("purpose", String(selected));
        form.set("file", file);
        // Keep each request within the per-file upload limit.
        const result = file.size > 20 * 1024 * 1024
          ? { error: "fileSize" }
          : await uploadDocument({}, form).catch(() => ({ error: "unexpected" }));
        if (result.error) failed.push(file);
        setResults(previous => [...previous, { name: file.name, ...result }]);
      }
    } finally {
      setPending(false);
      setFiles(failed);
      if (input.current) input.current.value = "";
    }
  }

  return <form onSubmit={upload} className="import-upload">
    <fieldset disabled={pending}>
      <PurposeSelect initial={initial} />
      <label className="upload-zone">
        <UploadCloud size={28} />
        <strong>{t("documents.choose")}</strong>
        <span>{t("documents.accept")}</span>
        <input ref={input} type="file" multiple accept=".pdf,.mt940,.sta,.940,.txt,.xml,.ubl,.csv"
          aria-label={t("documents.choose")} onChange={event => {
            setFiles(Array.from(event.currentTarget.files ?? []));
            setResults([]);
          }} />
      </label>
      {files.length > 0 && <p className="muted">{t("imports.selected", { count: files.length })}</p>}
      <button className="button primary" disabled={!files.length}>
        {pending ? t("imports.processing", { done: results.length, total: files.length }) : t("documents.submit")}
      </button>
    </fieldset>
    {results.length > 0 && <ul className="import-results" aria-live="polite">
      {results.map(({ name, error, imported }, index) =>
        <li key={index} className={"feedback " + (error ? "error" : "success")} role={error ? "alert" : undefined}>
          {name} · {error ? t("errors." + error) : imported ? t("documents." + imported.status) : t("imports.saved")}
        </li>
      )}
    </ul>}
    {!pending && <div className="import-pagination">
      {results.some(result => ["invoice", "sale", "purchase"].includes(result.imported?.purpose ?? "")) &&
        <Link className="text-link" href="/?view=review#invoice-review">{t("imports.openReview")}</Link>}
      {results.some(result => result.imported?.purpose === "bank") &&
        <Link className="text-link" href="/?view=review#bank-imports">{t("review.bank")}</Link>}
      {results.some(result => result.imported?.purpose === "vat") &&
        <Link className="text-link" href="#return-periods">{t("nav.vat")}</Link>}
    </div>}
  </form>;
}

export function DocumentManagement({ businessId, document, posted, quarter }: {
  businessId: string;
  document: Pick<Document, "id" | "kind" | "purpose">;
  posted: boolean;
  quarter?: number;
}) {
  const t = useTranslations();
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (posted || quarter !== undefined) {
    return <div className="document-management">
      {posted && <p className="help">{t("imports.usedByBooking")}{" "}
        <Link className="text-link" href="/?view=review">{t("nav.review")}</Link>
      </p>}
      {quarter !== undefined && <p className="help">{t("imports.usedByVat")}{" "}
        <Link className="text-link" href={"/?view=vat&quarter=" + quarter}>{t("nav.vat")}</Link>
      </p>}
    </div>;
  }
  return <div className="document-management">
    <ActionForm action={changeDocumentCategory} label={t("imports.changeCategory")} className="document-category" reset>
      <input name="businessId" value={businessId} type="hidden" />
      <input name="documentId" value={document.id} type="hidden" />
      <PurposeSelect document={document} />
    </ActionForm>
    {document.kind === "pdf" && isInvoicePurpose(document.purpose) &&
      <ActionForm action={changeDocumentCategory} label={t("imports.rereadPdf")} className="quiet-action">
        <input name="businessId" value={businessId} type="hidden" />
        <input name="documentId" value={document.id} type="hidden" />
        <input name="reread" value="invoice" type="hidden" />
      </ActionForm>}
    {confirmDelete ? <div className="document-delete-prompt">
      <p>{t("imports.deleteHelp")}</p>
      <ActionForm action={removeDocument} label={t("imports.confirmDelete")} className="document-remove">
        <input name="businessId" value={businessId} type="hidden" />
        <input name="documentId" value={document.id} type="hidden" />
        <button type="button" className="button secondary" onClick={() => setConfirmDelete(false)}>{t("common.cancel")}</button>
      </ActionForm>
    </div> : <button type="button" className="button secondary" onClick={() => setConfirmDelete(true)}>
      {t("imports.deleteDocument")}
    </button>}
  </div>;
}

export function RereadInvoicePdfs({ businessId, documentIds }: { businessId: string; documentIds: string[] }) {
  const t = useTranslations();
  const [progress, setProgress] = useState<{ total: number; done: number; failed: number }>();
  const running = progress && progress.done < progress.total;
  if (!documentIds.length && !progress) return null;

  async function reread() {
    const total = documentIds.length;
    if (running || !total) return;
    let done = 0, failed = 0;
    setProgress({ total, done, failed });
    for (const id of documentIds) {
      const form = new FormData();
      form.set("businessId", businessId);
      form.set("documentId", id);
      form.set("reread", "invoice");
      const result = await changeDocumentCategory({}, form).catch(() => ({ success: false }));
      if (!result.success) failed++;
      setProgress({ total, done: ++done, failed });
    }
  }

  return <div className="import-reread">
    {documentIds.length > 0 && <button type="button" className="button secondary" onClick={reread} disabled={running}>
      {t("imports.rereadBatch", { count: documentIds.length })}
    </button>}
    {progress && <p className="help" role="status">{running
      ? t("imports.processing", { done: progress.done, total: progress.total })
      : t("imports.rereadResult", { count: progress.total - progress.failed, failed: progress.failed })}</p>}
  </div>;
}
