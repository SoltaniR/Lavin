"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { saveVatReturn } from "@/app/actions";
import type { Document, VatReturn, VatSuggestion } from "@/lib/model";
import { ActionForm } from "./forms";

type Source = Pick<Document, "id" | "name"> & { suggestion: VatSuggestion; usedIn?: number };

export function VatReturnForm({ businessId, quarter, year, filed, sources, selectedSource }: {
  businessId: string;
  quarter: number;
  year: number;
  filed?: VatReturn;
  sources: Source[];
  selectedSource?: string;
}) {
  const t = useTranslations();
  const [sourceId, setSourceId] = useState(filed?.source_id ?? (sources.some(s => s.id === selectedSource) ? selectedSource! : ""));
  const [output, setOutput] = useState(filed?.filed_output ?? "");
  const [input, setInput] = useState(filed?.filed_input ?? "");
  const source = sources.find(s => s.id === sourceId);
  const suggestion = source?.suggestion;
  const wrongPeriod = Boolean(suggestion && (suggestion.quarter && suggestion.quarter !== quarter || suggestion.year && suggestion.year !== year));
  return <ActionForm action={saveVatReturn} label={t("vat.save")}>
    <input type="hidden" name="businessId" value={businessId} />
    <input type="hidden" name="quarter" value={quarter} />
    <div className="form-grid">
      <label className="wide">{t("vat.source")}<select name="sourceId" required value={sourceId}
        onChange={event => {
          const id = event.target.value;
          setSourceId(id);
          setOutput(id === filed?.source_id ? filed.filed_output : "");
          setInput(id === filed?.source_id ? filed.filed_input : "");
        }}>
        <option value="">{t("vat.chooseSource")}</option>
        {sources.map(pdf => <option key={pdf.id} value={pdf.id}>{pdf.name}</option>)}
      </select></label>
      {source && <div className="wide">
        <a className="text-link" target="_blank" rel="noreferrer" href={"/api/documents/" + source.id}>{t("documents.view")}</a>
        {source.usedIn && source.usedIn !== quarter ? <p className="notice">{t("errors.vatSourcePeriod")}</p>
          : wrongPeriod ? <p className="notice">{t("errors.vatWrongPeriod")}</p>
            : suggestion && (suggestion.output !== undefined || suggestion.input !== undefined) ? <>
              <p className="help">{t("imports.vatSuggestion")}</p>
              <button type="button" className="button secondary" onClick={() => {
                if (suggestion.output !== undefined) setOutput(suggestion.output);
                if (suggestion.input !== undefined) setInput(suggestion.input);
              }}>{t("imports.useVatFigures")}</button>
            </> : <p className="help">{t("imports.noVatSuggestion")}</p>}
      </div>}
      <label>{t("vat.output")}<input name="filedOutput" inputMode="text" pattern="-?[0-9]{1,10}" required value={output} onChange={event => setOutput(event.target.value)} /></label>
      <label>{t("vat.input")}<input name="filedInput" inputMode="text" pattern="-?[0-9]{1,10}" required value={input} onChange={event => setInput(event.target.value)} /></label>
      <label className="wide">{t("vat.note")}<textarea name="note" rows={3} maxLength={2000} defaultValue={filed?.note} /></label>
    </div>
  </ActionForm>;
}
