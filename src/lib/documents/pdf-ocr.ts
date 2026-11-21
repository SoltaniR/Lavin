import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { PDFParse } from "pdf-parse";

const languages = ["eng", "nld", "tur"];
const maxScanPages = 8;
let models: Promise<string> | undefined;

function languageModels() {
  models ??= (async () => {
    const directory = path.join(process.env.LAVIN_DATA_DIR || path.join(process.cwd(), ".data"), "ocr-models");
    await mkdir(directory, { recursive: true });
    await Promise.all(languages.map(language => {
      const file = language + ".traineddata.gz";
      const bundled = path.join(process.cwd(), "node_modules", "@tesseract.js-data", language, "4.0.0_best_int", file);
      return copyFile(bundled, path.join(directory, file));
    }));
    return directory;
  })().catch(error => { models = undefined; throw error; });
  return models;
}

export async function readScannedPages(parser: PDFParse, pages: { num: number; text: string }[]) {
  const sparse = pages.filter(page => (page.text.match(/[\p{L}\d]/gu)?.length ?? 0) < 24);
  if (!sparse.length) return false;
  const [{ createWorker, OEM, PSM }, langPath] = await Promise.all([import("tesseract.js"), languageModels()]);
  const worker = await createWorker(languages, OEM.LSTM_ONLY, { langPath, cacheMethod: "none", errorHandler: () => {} });
  let incomplete = sparse.length > maxScanPages;
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: "185" });
    for (const page of sparse.slice(0, maxScanPages)) {
      const image = (await parser.getScreenshot({ partial: [page.num], desiredWidth: 1600, imageDataUrl: false })).pages[0];
      if (!image) { incomplete = true; continue; }
      const { data } = await worker.recognize(Buffer.from(image.data));
      if (data.text.trim().length > page.text.trim().length) page.text = data.text;
      else incomplete = true;
    }
    return incomplete;
  } finally { await worker.terminate(); }
}
