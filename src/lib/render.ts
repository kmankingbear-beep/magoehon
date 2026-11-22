/**
 * ページを canvas に描く。編集画面の見本と印刷用PDFの両方がこの関数を使うので、
 * 画面で見たとおりに印刷される。
 */
import { getSheet, imageRect, resolveText, sheetImage, type SheetRef } from "./design";
import type { Book, TextBox } from "./types";

export const TRIM_W_MM = 210;
export const TRIM_H_MM = 148;
export const BLEED_MM = 3;
export const PAGE_W_MM = TRIM_W_MM + BLEED_MM * 2;
export const PAGE_H_MM = TRIM_H_MM + BLEED_MM * 2;
export const FONT = '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", sans-serif';
const LINE = 1.6;

const imgCache = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(src: string) {
  let p = imgCache.get(src);
  if (!p) {
    p = new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
    imgCache.set(src, p);
    if (imgCache.size > 80) imgCache.delete(imgCache.keys().next().value!);
  }
  return p;
}

let fontsReady: Promise<unknown> | null = null;
export function loadFonts() {
  fontsReady ??= Promise.all([document.fonts.load(`500 40px ${FONT}`, "あ"), document.fonts.load(`700 40px ${FONT}`, "あ")]);
  return fontsReady;
}

const NO_LINE_START = "、。,.!?!?」』)ー〜ぁぃぅぇぉっゃゅょァィゥェォッャュョ";

/** 日本語の折り返し。スペース(分かち書き)と句読点で区切り、行頭禁則を守る */
export function wrap(text: string, measure: (s: string) => number, max: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const segs = para.match(/[^ 、。!?!?]+[ 、。!?!?」]*|[ 、。!?!?」]+/g) ?? [""];
    let line = "";
    for (const seg of segs) {
      if (measure(line + seg.trimEnd()) <= max) {
        line += seg;
        continue;
      }
      if (line) lines.push(line.trimEnd());
      line = "";
      for (const ch of seg) {
        if (measure(line + ch) > max && line && !NO_LINE_START.includes(ch)) {
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

/** 文字の箱の場所(仕上がりに対する割合)。編集画面でつかむ範囲に使う */
export type BoxRect = { id: string; x: number; y: number; w: number; h: number };

type Ctx = CanvasRenderingContext2D;

const ROTATE = "「」『』()()ー〜…―-";
const SHIFT = "、。,.";

function drawTextBox(ctx: Ctx, t: TextBox, text: string, mmToPx: number, ox: number, oy: number, trimWpx: number, trimHpx: number): BoxRect {
  const size = t.size * mmToPx;
  ctx.font = `${t.bold ? 700 : 500} ${size}px ${FONT}`;
  ctx.textBaseline = "middle";
  const left = ox + t.x * trimWpx;
  const top = oy + t.y * trimHpx;
  const pad = size * 0.5;

  let rect: { x: number; y: number; w: number; h: number };
  let paint: () => void;

  if (!t.vertical) {
    const maxW = t.len * trimWpx;
    const lines = wrap(text || " ", (s) => ctx.measureText(s).width, maxW);
    const textW = Math.max(...lines.map((l) => ctx.measureText(l).width), size);
    const h = lines.length * size * LINE;
    rect = { x: left + (maxW - textW) / 2, y: top, w: textW, h };
    paint = () => {
      ctx.textAlign = "center";
      lines.forEach((l, i) => {
        const y = top + size * LINE * (i + 0.5);
        if (t.decor === "outline") {
          ctx.lineWidth = size * 0.36;
          ctx.lineJoin = "round";
          ctx.strokeStyle = t.color === "#ffffff" ? "#3d3027" : "#ffffff";
          ctx.strokeText(l, left + maxW / 2, y);
        }
        ctx.fillText(l, left + maxW / 2, y);
      });
    };
  } else {
    // たて書き: 右から左へ列をならべる
    const maxH = t.len * trimHpx;
    const adv = (s: string) => [...s].reduce((a, c) => a + (c === " " ? 0.5 : 1), 0) * size;
    const cols = wrap(text || " ", adv, maxH);
    const colW = size * LINE;
    const w = cols.length * colW;
    const h = Math.max(...cols.map(adv), size);
    rect = { x: left, y: top, w, h };
    paint = () => {
      ctx.textAlign = "center";
      cols.forEach((col, ci) => {
        const cx = left + w - colW * (ci + 0.5);
        let y = top;
        for (const ch of col) {
          if (ch === " ") { y += size * 0.5; continue; }
          const cy = y + size / 2;
          ctx.save();
          if (ROTATE.includes(ch)) {
            ctx.translate(cx, cy);
            ctx.rotate(Math.PI / 2);
            ctx.translate(-cx, -cy);
          } else if (SHIFT.includes(ch)) {
            ctx.translate(size * 0.6, -size * 0.6);
          }
          if (t.decor === "outline") {
            ctx.lineWidth = size * 0.36;
            ctx.lineJoin = "round";
            ctx.strokeStyle = t.color === "#ffffff" ? "#3d3027" : "#ffffff";
            ctx.strokeText(ch, cx, cy);
          }
          ctx.fillText(ch, cx, cy);
          ctx.restore();
          y += size;
        }
      });
    };
  }

  // かざり
  if (t.decor === "plate" || t.decor === "bubble") {
    const bx = rect.x - pad, by = rect.y - pad * 0.6, bw = rect.w + pad * 2, bh = rect.h + pad * 1.2;
    ctx.save();
    ctx.fillStyle = t.decor === "plate" ? "rgba(255,255,255,0.88)" : "#ffffff";
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, t.decor === "plate" ? size * 0.5 : size * 1.2);
    if (t.decor === "bubble") {
      // しっぽ
      const tx = bx + bw * 0.22;
      ctx.moveTo(tx, by + bh - 1);
      ctx.lineTo(tx - size * 0.6, by + bh + size * 1.1);
      ctx.lineTo(tx + size * 0.9, by + bh - 1);
    }
    ctx.fill();
    if (t.decor === "bubble") {
      ctx.lineWidth = Math.max(1, size * 0.09);
      ctx.strokeStyle = "#3d3027";
      ctx.stroke();
      // しっぽのつけねの線を消す
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(bx + bw * 0.22 - size * 0.05, by + bh - size * 0.1, size * 0.9, size * 0.2);
    }
    ctx.restore();
  }
  ctx.fillStyle = t.color;
  paint();

  return {
    id: t.id,
    x: (rect.x - ox) / trimWpx,
    y: (rect.y - oy) / trimHpx,
    w: rect.w / trimWpx,
    h: rect.h / trimHpx,
  };
}

function coverDraw(ctx: Ctx, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const ar = w / h;
  let sw = img.width, sh = sw / ar;
  if (sh > img.height) { sh = img.height; sw = sh * ar; }
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

export type RenderOptions = {
  /** 1mmあたりのピクセル数 */
  pxPerMm: number;
  /** true なら塗り足しまで描く(印刷用)。false なら仕上がりの大きさだけ(画面用) */
  bleed: boolean;
};

export async function renderSheet(canvas: HTMLCanvasElement, book: Book, ref: SheetRef, opt: RenderOptions): Promise<BoxRect[]> {
  await loadFonts();
  const sheet = getSheet(book, ref);
  const imageSrc = sheetImage(book, ref);
  const r = imageRect(sheet);
  const img = imageSrc && r ? await loadImage(imageSrc) : null;

  const k = opt.pxPerMm;
  const b = opt.bleed ? BLEED_MM * k : 0;
  const trimW = TRIM_W_MM * k, trimH = TRIM_H_MM * k;
  canvas.width = Math.round(trimW + b * 2);
  canvas.height = Math.round(trimH + b * 2);
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = sheet.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (img && r) {
    // 仕上がりの端にふれる辺は塗り足しまでのばす
    const E = 0.001;
    const x0 = r.x <= E ? 0 : b + r.x * trimW;
    const y0 = r.y <= E ? 0 : b + r.y * trimH;
    const x1 = r.x + r.w >= 1 - E ? canvas.width : b + (r.x + r.w) * trimW;
    const y1 = r.y + r.h >= 1 - E ? canvas.height : b + (r.y + r.h) * trimH;
    const framed = x0 > 0 && y0 > 0 && x1 < canvas.width && y1 < canvas.height;
    if (framed) {
      // まわりに すきまがある絵は、角を まるくして 額のように
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x0, y0, x1 - x0, y1 - y0, 3 * k);
      ctx.clip();
      coverDraw(ctx, img, x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
    } else {
      coverDraw(ctx, img, x0, y0, x1 - x0, y1 - y0);
    }
  }

  const rects: BoxRect[] = [];
  for (const t of sheet.texts) {
    const text = resolveText(book, ref, t);
    if (!text && t.role !== "free") continue;
    rects.push(drawTextBox(ctx, t, text, k, b, b, trimW, trimH));
  }

  // ページ番号
  if (ref.kind === "page") {
    ctx.font = `500 ${3 * k}px ${FONT}`;
    ctx.fillStyle = "#7a6a5d";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(ref.index + 1), b + trimW / 2, b + trimH - 4 * k);
  }
  return rects;
}
