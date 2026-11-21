import { DomainError } from "../accounting";
import { isInvoicePurpose, type Document, type DocumentPurpose, type InvoiceFields, type InvoiceIssue, type uploadPurposes, type VatSuggestion } from "../model";
import { csvInvoices, pdfInvoices, ublInvoice } from "./invoices";
import { parseMt940, type Statement } from "./mt940";
import { pdfStatement } from "./bank-pdf";
import { vatFigures } from "./vat-pdf";
import { invoiceIdentityLine } from "./invoice-text";

export type ImportPurpose = (typeof uploadPurposes)[number] | "invoice";
type PreparedUpload = {
  kind: Document["kind"];
  purpose: DocumentPurpose;
  status: string;
  text: string;
  pages?: number;
  statement?: Statement;
  invoices?: InvoiceFields[];
  invoiceIssues?: InvoiceIssue[];
  vat?: VatSuggestion;
};

export async function prepareUpload(bytes: Buffer, name: string, requested: ImportPurpose): Promise<PreparedUpload> {
  if (bytes.subarray(0, 5).toString() === "%PDF-") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    try {
      const { total } = await parser.getInfo();
      if (total > 100) throw new DomainError("pageLimit");
      const { pages } = await parser.getText({ cellSeparator: "\t" });
      const incompleteOcr = (isInvoicePurpose(requested) || requested === "auto") &&
        await (await import("./pdf-ocr")).readScannedPages(parser, pages).catch(() => true);
      const text = pages.map(page => page.text).join("\n\n");
      let purpose: DocumentPurpose = requested === "auto" ? "evidence" : requested;
      if (requested === "auto") {
        if (/\b(?:opening balance|beginsaldo|begin saldo|vorig saldo)\b/i.test(text)) purpose = "bank";
        else if (/\b(?:btw-aangifte|aangifte omzetbelasting|vat return)\b/i.test(text)) purpose = "vat";
        else if (text.split(/\r?\n|\t+/).some(line => invoiceIdentityLine(line.trim()))) purpose = "invoice";
      }
      const base = { kind: "pdf" as const, purpose, text, pages: total };
      if (!pages.some(page => /\p{L}|\d/u.test(page.text))) return { ...base, status: "needsOcr" };
      if (purpose === "bank") {
        const statement = pdfStatement(pages.map(page => page.text).join("\n"));
        return { ...base, status: statement ? "bankReady" : "bankPdfReview", statement: statement ?? undefined };
      }
      if (purpose === "vat") return { ...base, status: "textReady", vat: vatFigures(text) };
      if (isInvoicePurpose(purpose)) {
        const { invoices, issues } = pdfInvoices(pages);
        if (incompleteOcr && !issues.includes("unreadable")) issues.push("unreadable");
        return { ...base, status: issues.length || !invoices.length ? "invoicePartial" : "invoiceReady", invoices, invoiceIssues: issues };
      }
      return { ...base, status: "textReady" };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("pdf");
    } finally { await parser.destroy(); }
  }

  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  if (text.includes(":60F:") || /\.(?:mt940|sta|940)$/i.test(name)) {
    if (requested === "evidence") return { kind: "mt940", purpose: requested, status: "textReady", text };
    if (requested !== "bank" && requested !== "auto") throw new DomainError("sourcePurpose");
    return { kind: "mt940", purpose: "bank", status: "bankReady", text, statement: parseMt940(text) };
  }
  if (!/\.(?:xml|ubl|csv)$/i.test(name)) throw new DomainError("fileType");
  const kind = /\.(?:xml|ubl)$/i.test(name) ? "xml" : "csv";
  if (requested === "evidence") return { kind, purpose: requested, status: "textReady", text };
  if (requested !== "auto" && requested !== "sale" && requested !== "purchase") throw new DomainError("sourcePurpose");
  const purpose = requested === "auto" ? "invoice" : requested;
  return { kind, purpose, status: "invoiceReady", text, invoices: kind === "xml" ? [ublInvoice(text)] : csvInvoices(text) };
}
