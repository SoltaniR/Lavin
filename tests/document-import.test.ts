import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfInvoices, csvInvoices, ublInvoice } from "../src/lib/documents/invoices";
import { normalizedBankAccount, pdfStatement } from "../src/lib/documents/bank-pdf";
import { vatFigures } from "../src/lib/documents/vat-pdf";

test("invoice bundles separate references and keep continuation totals with the source", () => {
  const result = pdfInvoices([
    { num: 1, text: "Factuur\nFactuurnummer: F-001\nFactuurdatum: 31-03-2025\nTotaal excl. btw: 1.000,00" },
    { num: 2, text: "BTW-bedrag: € 210,00\nTotaal incl. btw: € 1.210,00" },
    { num: 3, text: "Invoice\nInvoice number: F-002\nInvoice date: 2025-04-01\nVAT amount: EUR 0.00\nGrand total: EUR 12.00" },
    { num: 4, text: "Credit note\nInvoice number: F-003\nInvoice date: 2025-04-01\nGrand total: EUR 12.00" },
  ]);
  assert.equal(result.skipped, true);
  assert.deepEqual(result.invoices.map(({ reference, date, amount, invoiceVat, page, lastPage }) =>
    [reference, date, amount, invoiceVat, page, lastPage]), [
    ["F-001", "2025-03-31", "1210.00", "210.00", 1, 2],
    ["F-002", "2025-04-01", "12.00", "0.00", 3, 3],
  ]);
});

test("PDF invoice fields recognize Dutch, English and Turkish layouts", () => {
  const result = pdfInvoices([
    { num: 1, text: "Invoice\nInvoice No.\tEN-11\nDate of issue\tNovember 14, 2025\nVAT amount: 21.00 EUR\nInvoice total 121.00 EUR\nDue date: November 28, 2025" },
    { num: 2, text: "Factuur\nFactuurnr.: NL-12\nFactuurdatum 14 november 2025\nBTW-bedrag: € 0,-\nTotaalbedrag: € 121,-" },
    { num: 3, text: "E-ARŞİV FATURA\nFatura No: TR-13\nFatura Tarihi: 14 Kasım 2025\nMal Hizmet Toplam Tutarı: 1.000,00 EUR\nHesaplanan KDV (%20): 200,00 EUR\nVergiler Dahil Toplam Tutar: 1.200,00 EUR" },
  ]);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.invoices.map(({ reference, date, amount, invoiceVat }) => [reference, date, amount, invoiceVat]), [
    ["EN-11", "2025-11-14", "121.00", "21.00"],
    ["NL-12", "2025-11-14", "121.00", "0.00"],
    ["TR-13", "2025-11-14", "1200.00", "200.00"],
  ]);
});

test("foreign currency and unclear amounts are surfaced without inventing EUR bookings", () => {
  const turkish = "Fatura\nFatura No: TR-14\nFatura Tarihi: 18.11.2025 13:24\nVergiler Dahil Toplam Tutar: 1.200,00 TRY";
  const foreign = pdfInvoices([{ num: 1, text: turkish }]);
  assert.deepEqual(foreign.invoices, []);
  assert.deepEqual(foreign.issues, ["nonEur"]);
  const incomplete = pdfInvoices([{ num: 1, text: turkish.replace("TRY", "EUR") }]);
  assert.equal(incomplete.invoices[0].invoiceVat, undefined);
  assert.deepEqual(incomplete.issues, ["missingFields"]);
});

test("UBL and spreadsheet CSV preserve references, VAT and exact totals", () => {
  const xml = '<Invoice xmlns:cbc="urn:basic" xmlns:cac="urn:aggregate"><cbc:ID>0004</cbc:ID><cbc:IssueDate>2025-03-05</cbc:IssueDate>' +
    '<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode><cac:TaxTotal><cbc:TaxAmount currencyID="EUR">21.25</cbc:TaxAmount></cac:TaxTotal>' +
    '<cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount>100.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount>121.25</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal></Invoice>';
  assert.deepEqual(ublInvoice(xml), { reference: "0004", date: "2025-03-05", amount: "121.25", invoiceVat: "21.25" });
  assert.throws(() => ublInvoice(xml.replace("EUR", "USD")), /invoiceXml/);
  assert.throws(() => ublInvoice("<!DOCTYPE Invoice>" + xml), /invoiceXml/);
  const csv = '\uFEFFreference;date;total;vat;description\r\n0004;05-03-2025;121,25;21,25;"Service; March"\r\n';
  assert.deepEqual(csvInvoices(csv), [{ reference: "0004", date: "2025-03-05", amount: "121.25", invoiceVat: "21.25", description: "Service; March", row: 2 }]);
  assert.throws(() => csvInvoices(csv.replace("21,25", "")), /invoiceCsv/);
});

test("bank PDF movements import only when dated amounts explain both balances", () => {
  const text = [
    "Bankafschrift", "IBAN: NL00 TEST 0123 4567 89", "Periode: 01-03-2025 t/m 31-03-2025",
    "Begin saldo: EUR 5.410,00", "Datum Omschrijving Bedrag", "05-03-2025 Klantbetaling +121,00",
    "10-03-2025 Bankkosten -11,00", "Eindsaldo: EUR 5.520,00",
  ].join("\n");
  const statement = pdfStatement(text);
  assert.equal(statement?.account, normalizedBankAccount("NL00TEST0123456789"));
  assert.deepEqual(statement?.rows.map(row => row.amount), ["121.00", "-11.00"]);
  assert.equal(pdfStatement(text.replace("-11,00", "")), null);
  assert.equal(pdfStatement(text.replace("5.520,00", "5.521,00")), null);
  assert.equal(pdfStatement(text.replace("10-03-2025", "10-04-2025")), null);
  assert.equal(pdfStatement(text.replace("EUR", "USD")), null);
});

test("VAT extraction keeps signed zero and negative amounts and leaves ambiguity blank", () => {
  const text = "Btw-aangifte\n3e kwartaal 2025\n5a. Btw verschuldigd: -42\n5b. Voorbelasting: 0";
  assert.deepEqual(vatFigures(text), { quarter: 3, year: 2025, output: "-42", input: "0" });
  assert.equal(vatFigures("5a Verschuldigde btw (rubrieken 1 t/m 4) € 210").output, "210");
  assert.equal(vatFigures("5a -42\n5a 43").output, undefined);
  assert.equal(vatFigures("5b 1,23").input, undefined);
});
