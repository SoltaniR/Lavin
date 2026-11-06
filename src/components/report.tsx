import Decimal from "decimal.js";
import { accounts, type Workspace } from "@/lib/model";
import { financials } from "@/lib/accounting";
import en from "@/messages/en.json";
import nl from "@/messages/nl.json";

export function Report({
  workspace,
  locale,
}: {
  workspace: Workspace;
  locale: string;
}) {
  const m = locale === "nl" ? nl : en,
    f = financials(workspace.entries),
    p = workspace.business.profile;
  const money = (value: string) =>
    new Intl.NumberFormat(locale === "nl" ? "nl-NL" : "en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value));
  function rows(kind: string) {
    return accounts
      .filter(
        (a) => a.kind === kind && new Decimal(f.balances[a.code]).abs().gt(0),
      )
      .map((a) => {
        const value = ["liability", "equity", "income"].includes(kind)
          ? new Decimal(f.balances[a.code]).negated().toFixed(2)
          : f.balances[a.code];
        return (
          <tr key={a.code}>
            <td>{m.account[a.code as keyof typeof m.account]}</td>
            <td>{money(value)}</td>
          </tr>
        );
      });
  }
  const total = (label: string, value: string) => (
    <tr className="total">
      <th scope="row">{label}</th>
      <td>{money(value)}</td>
    </tr>
  );
  return (
    <article className="report-paper" lang={locale}>
      <div className="report-top">
        <span className="report-wordmark">
          lavin<span>.</span>
        </span>
        <span className="badge amber">{m.common.draft}</span>
      </div>
      <p className="report-year">{p.year}</p>
      <h2>{m.report.annual}</h2>
      <h3>{p.name}</h3>
      <p className="muted">{m.report.scope}</p>
      <p className="report-basis">{m.report.basis}</p>
      <section>
        <h3>{m.report.profitLoss}</h3>
        <table className="statement">
          <thead>
            <tr>
              <th>{m.common.description}</th>
              <th>EUR</th>
            </tr>
          </thead>
          <tbody>
            {rows("income")}
            {total(m.overview.revenue, f.revenue)}
            {rows("expense")}
            {total(m.overview.expenses, f.expenses)}
            {total(m.overview.profit, f.profit)}
          </tbody>
        </table>
      </section>
      <section>
        <h3>{m.report.balance}</h3>
        <table className="statement">
          <thead>
            <tr>
              <th>{m.report.assets}</th>
              <th>EUR</th>
            </tr>
          </thead>
          <tbody>
            {rows("asset")}
            {total(m.report.totalAssets, f.assets)}
          </tbody>
        </table>
        <table className="statement">
          <thead>
            <tr>
              <th>{m.report.liabilities}</th>
              <th>EUR</th>
            </tr>
          </thead>
          <tbody>
            {rows("liability")}
            {total(m.report.liabilities, f.liabilities)}
            {total(m.report.equity, f.equity)}
            {total(
              m.report.totalFunding,
              new Decimal(f.liabilities).plus(f.equity).toFixed(2),
            )}
          </tbody>
        </table>
        <p className="balance-check">
          {m.report.check}: € {money(f.difference)}
        </p>
      </section>
      <p className="report-basis">{m.report.reportNote}</p>
      <footer>
        {m.report.prepared}:{" "}
        {new Intl.DateTimeFormat(locale === "nl" ? "nl-NL" : "en-GB", {
          timeZone: "Europe/Amsterdam",
        }).format(new Date())}{" "}
        · Lavin
      </footer>
    </article>
  );
}
