import { PDFDocument } from "pdf-lib";
import { listSheets } from "./design";
import { BLEED_MM, PAGE_H_MM, PAGE_W_MM, TRIM_H_MM, TRIM_W_MM, renderSheet } from "./render";
import type { Book } from "./types";

const mm = (v: number) => (v * 72) / 25.4;
const DPI = 300;
const PX_PER_MM = DPI / 25.4;

/**
 * 印刷用PDF。ページは編集画面と同じ関数(renderSheet)で 300dpi の画像にして並べる。
 * 仕上がり A5よこ + 塗り足し。TrimBox / BleedBox を設定する。
 */
export async function buildBookPdf(book: Book, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(book.title);
  doc.setCreator("まごえほん");
  const sheets = listSheets(book);
  const canvas = document.createElement("canvas");
  for (const [i, s] of sheets.entries()) {
    await renderSheet(canvas, book, s.ref, { pxPerMm: PX_PER_MM, bleed: true });
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.95));
    const jpg = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const page = doc.addPage([mm(PAGE_W_MM), mm(PAGE_H_MM)]);
    page.drawImage(jpg, { x: 0, y: 0, width: mm(PAGE_W_MM), height: mm(PAGE_H_MM) });
    page.setBleedBox(0, 0, mm(PAGE_W_MM), mm(PAGE_H_MM));
    page.setTrimBox(mm(BLEED_MM), mm(BLEED_MM), mm(TRIM_W_MM), mm(TRIM_H_MM));
    onProgress?.(i + 1, sheets.length);
  }
  return doc.save();
}

export const PDF_SPEC = `A5よこ ${TRIM_W_MM}×${TRIM_H_MM}mm、塗り足し各${BLEED_MM}mm(PDFのページは${PAGE_W_MM}×${PAGE_H_MM}mm、${DPI}dpi)`;
