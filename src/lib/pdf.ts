import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Book } from "./types";

/** 仕上がり A5よこ(210×148mm)+ 塗り足し 3mm */
export const TRIM_W_MM = 210;
export const TRIM_H_MM = 148;
export const BLEED_MM = 3;
const SAFE_MM = 10; // 文字は仕上がり線から10mm内側に置く

const mm = (v: number) => (v * 72) / 25.4;
const PAGE_W = mm(TRIM_W_MM + BLEED_MM * 2);
const PAGE_H = mm(TRIM_H_MM + BLEED_MM * 2);
const B = mm(BLEED_MM);
const IMAGE_RATIO = 0.7; // 本文ページで絵が占める高さ(仕上がりに対して)

const CREAM = rgb(1, 0.98, 0.94);
const INK = rgb(0.25, 0.2, 0.16);
const SOFT = rgb(0.5, 0.42, 0.36);

/** 画像を指定の縦横比で中央切り抜きして JPEG にする */
async function cropToAspect(dataUrl: string, aspect: number): Promise<Uint8Array> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  let sw = img.naturalWidth;
  let sh = sw / aspect;
  if (sh > img.naturalHeight) {
    sh = img.naturalHeight;
    sw = sh * aspect;
  }
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;
  const outW = Math.min(2600, Math.round(sw)); // 300dpi で A5よこ ≒ 2550px
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = Math.round(outW / aspect);
  canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.92));
  return new Uint8Array(await blob.arrayBuffer());
}

const NO_LINE_START = "、。,.!?!?」』)ー〜ぁぃぅぇぉっゃゅょァィゥェォッャュョ";

/** 日本語の折り返し。スペース(分かち書き)と句読点で区切り、行頭禁則を守る */
export function wrapJapanese(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const segs = para.match(/[^ 、。!?!?]+[ 、。!?!?」]*|[ 、。!?!?」]+/g) ?? [""];
    let line = "";
    const width = (s: string) => font.widthOfTextAtSize(s, size);
    for (const seg of segs) {
      if (width(line + seg.trimEnd()) <= maxWidth) {
        line += seg;
        continue;
      }
      if (line) lines.push(line.trimEnd());
      line = "";
      // 1つの区切りが長すぎるときは文字単位で折る
      for (const ch of seg) {
        if (width(line + ch) > maxWidth && line && !NO_LINE_START.includes(ch)) {
          lines.push(line);
          line = "";
        }
        line += ch;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines.map((l) => l.trimStart());
}

function drawCentered(page: PDFPage, lines: string[], font: PDFFont, size: number, centerY: number, color = INK) {
  const lh = size * 1.7;
  const top = centerY + ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => {
    const w = font.widthOfTextAtSize(l, size);
    page.drawText(l, { x: PAGE_W / 2 - w / 2, y: top - i * lh - size * 0.35, size, font, color });
  });
}

function newPage(doc: PDFDocument) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.setBleedBox(0, 0, PAGE_W, PAGE_H);
  page.setTrimBox(B, B, PAGE_W - B * 2, PAGE_H - B * 2);
  return page;
}

function fillCream(page: PDFPage) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: CREAM });
}

function fitSize(text: string, font: PDFFont, start: number, maxW: number, maxLines: number) {
  let size = start;
  while (size > 10 && wrapJapanese(text, font, size, maxW).length > maxLines) size -= 1;
  return size;
}

export async function buildBookPdf(book: Book): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(book.title);
  doc.setCreator("まごえほん");
  const [medBytes, boldBytes] = await Promise.all([
    fetch("/fonts/ZenMaruGothic-Medium.ttf").then((r) => r.arrayBuffer()),
    fetch("/fonts/ZenMaruGothic-Bold.ttf").then((r) => r.arrayBuffer()),
  ]);
  const font = await doc.embedFont(medBytes, { subset: false });
  const bold = await doc.embedFont(boldBytes, { subset: false });
  const textW = PAGE_W - B * 2 - mm(SAFE_MM) * 2;
  const from = book.memo.from || "";
  const to = book.memo.to || "";

  // 1. 表紙
  {
    const page = newPage(doc);
    fillCream(page);
    if (book.coverImage) {
      const jpg = await doc.embedJpg(await cropToAspect(book.coverImage, PAGE_W / PAGE_H));
      page.drawImage(jpg, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
    }
    const size = fitSize(book.title, bold, 30, textW - mm(16), 2);
    const lines = wrapJapanese(book.title, bold, size, textW - mm(16));
    const boxH = lines.length * size * 1.7 + mm(10);
    const boxY = PAGE_H - B - mm(SAFE_MM) - boxH;
    page.drawRectangle({
      x: B + mm(SAFE_MM), y: boxY, width: textW, height: boxH,
      color: rgb(1, 1, 1), opacity: 0.85, borderColor: rgb(1, 1, 1), borderWidth: 0,
    });
    drawCentered(page, lines, bold, size, boxY + boxH / 2);
    if (from) {
      const label = `${from} より`;
      const w = font.widthOfTextAtSize(label, 14);
      const y = B + mm(SAFE_MM);
      page.drawRectangle({ x: PAGE_W / 2 - w / 2 - mm(4), y: y - mm(2), width: w + mm(8), height: 14 + mm(4), color: rgb(1, 1, 1), opacity: 0.85 });
      page.drawText(label, { x: PAGE_W / 2 - w / 2, y: y + 1, size: 14, font, color: INK });
    }
  }

  // 2. とびら(献辞)
  {
    const page = newPage(doc);
    fillCream(page);
    drawCentered(page, [`${to || "あなた"} へ`], bold, 26, PAGE_H / 2 + mm(12));
    drawCentered(page, wrapJapanese(book.title, font, 16, textW), font, 16, PAGE_H / 2 - mm(10), SOFT);
  }

  // 3. 本文
  for (const [i, p] of book.pages.entries()) {
    const page = newPage(doc);
    fillCream(page);
    const trimH = PAGE_H - B * 2;
    const imgH = trimH * IMAGE_RATIO + B; // 上の塗り足しまで
    if (p.image) {
      const jpg = await doc.embedJpg(await cropToAspect(p.image, PAGE_W / imgH));
      page.drawImage(jpg, { x: 0, y: PAGE_H - imgH, width: PAGE_W, height: imgH });
    }
    const textAreaTop = PAGE_H - imgH;
    const textAreaH = textAreaTop - B - mm(6);
    const size = fitSize(p.text, font, 17, textW, Math.max(1, Math.floor(textAreaH / (17 * 1.7))));
    drawCentered(page, wrapJapanese(p.text, font, size, textW), font, size, B + mm(6) + textAreaH / 2);
    const num = String(i + 1);
    page.drawText(num, { x: PAGE_W / 2 - font.widthOfTextAtSize(num, 9) / 2, y: B + mm(4), size: 9, font, color: SOFT });
  }

  // 4. メッセージ
  {
    const page = newPage(doc);
    fillCream(page);
    const msg = book.memo.message || "";
    const size = fitSize(msg, bold, 22, textW, 4);
    drawCentered(page, [`${to || "あなた"} へ`], font, 16, PAGE_H - B - mm(SAFE_MM + 12), SOFT);
    drawCentered(page, wrapJapanese(msg, bold, size, textW), bold, size, PAGE_H / 2);
    if (from) {
      const label = `${from} より`;
      page.drawText(label, {
        x: PAGE_W - B - mm(SAFE_MM) - font.widthOfTextAtSize(label, 16),
        y: B + mm(SAFE_MM + 6), size: 16, font, color: INK,
      });
    }
  }

  // 5. うら表紙(奥付)
  {
    const page = newPage(doc);
    fillCream(page);
    const d = new Date(book.updatedAt);
    const date = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    drawCentered(page, [book.title, `さく: ${from || ""}`, `${date} につくりました`], font, 12, B + mm(SAFE_MM + 14), SOFT);
  }

  return doc.save();
}

export const PDF_SPEC = `A5よこ ${TRIM_W_MM}×${TRIM_H_MM}mm、塗り足し各${BLEED_MM}mm(PDFのページは${TRIM_W_MM + BLEED_MM * 2}×${TRIM_H_MM + BLEED_MM * 2}mm)`;
