import type { Book, ImageLayout, Sheet, TextBox } from "./types";

export type SheetRef =
  | { kind: "cover" }
  | { kind: "dedication" }
  | { kind: "page"; index: number }
  | { kind: "message" }
  | { kind: "back" };

export type Rect = { x: number; y: number; w: number; h: number };

/** 絵の大きさの はんい */
export const IMAGE_SIZE_MIN = 0.3;
export const IMAGE_SIZE_MAX = 1;

/** ならべ方ごとの、はじめの絵の大きさ */
export const DEFAULT_IMAGE_SIZE: Record<ImageLayout, number> = {
  top: 0.7, bottom: 0.7, full: 1, left: 0.6, right: 0.6, none: 1,
};

export const clampImageSize = (v: number) => Math.max(IMAGE_SIZE_MIN, Math.min(IMAGE_SIZE_MAX, v));

export function imageSizeOf(sheet: Sheet): number {
  return clampImageSize(sheet.imageSize ?? DEFAULT_IMAGE_SIZE[sheet.imageLayout]);
}

/** 絵の場所(仕上がりに対する割合)。上・下・左・右は 端にくっつけたまま のび ちぢみ、「絵いっぱい」は まんなかで 大きさが かわる */
export function imageRect(sheet: Sheet): Rect | null {
  const s = imageSizeOf(sheet);
  switch (sheet.imageLayout) {
    case "top": return { x: 0, y: 0, w: 1, h: s };
    case "bottom": return { x: 0, y: 1 - s, w: 1, h: s };
    case "left": return { x: 0, y: 0, w: s, h: 1 };
    case "right": return { x: 1 - s, y: 0, w: s, h: 1 };
    case "full": return { x: (1 - s) / 2, y: fullTop(s), w: s, h: s };
    case "none": return null;
  }
}

/** 「絵いっぱい」を小さくしたときは 上によせて、下に文字の場所をあける */
const fullTop = (s: number) => Math.min((1 - s) / 2, 0.04);

/** 本文のはじめの場所。絵の大きさに合わせて、絵のない所におく */
function bodyPos(layout: ImageLayout, size: number): Pick<TextBox, "x" | "y" | "len" | "decor"> {
  switch (layout) {
    case "top": return size > 0.8
      ? { x: 0.07, y: 0.74, len: 0.86, decor: "plate" }
      : { x: 0.07, y: size + 0.05, len: 0.86, decor: "none" };
    case "bottom": return { x: 0.07, y: 0.08, len: 0.86, decor: size > 0.8 ? "plate" : "none" };
    case "full": return size > 0.8
      ? { x: 0.1, y: 0.7, len: 0.8, decor: "plate" }
      : { x: 0.1, y: fullTop(size) + size + 0.04, len: 0.8, decor: "none" };
    case "left": return { x: Math.min(0.8, size + 0.04), y: 0.3, len: Math.max(0.16, 0.96 - size - 0.04), decor: size > 0.75 ? "plate" : "none" };
    case "right": return { x: 0.04, y: 0.3, len: Math.max(0.16, 0.96 - size - 0.04), decor: size > 0.75 ? "plate" : "none" };
    case "none": return { x: 0.1, y: 0.4, len: 0.8, decor: "none" };
  }
}

let seq = 0;
export const boxId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

const INK = "#3d3027";
const CREAM = "#fffaf0";

function box(role: TextBox["role"], p: Partial<TextBox>): TextBox {
  return { id: boxId(), role, x: 0.1, y: 0.4, len: 0.8, size: 6, color: INK, decor: "none", vertical: false, ...p };
}

export function defaultPageSheet(): Sheet {
  return { imageLayout: "top", bg: CREAM, texts: [box("body", bodyPos("top", DEFAULT_IMAGE_SIZE.top))] };
}

export function defaultCoverSheet(): Sheet {
  return {
    imageLayout: "full",
    bg: CREAM,
    texts: [
      box("title", { x: 0.08, y: 0.07, len: 0.84, size: 10, decor: "plate", bold: true }),
      box("from", { x: 0.3, y: 0.84, len: 0.4, size: 4.5, decor: "plate" }),
    ],
  };
}

export function defaultDedicationSheet(): Sheet {
  return {
    imageLayout: "none",
    bg: CREAM,
    texts: [
      box("to", { x: 0.15, y: 0.36, len: 0.7, size: 9, bold: true }),
      box("title", { x: 0.15, y: 0.56, len: 0.7, size: 4.5, color: "#7a6a5d" }),
    ],
  };
}

export function defaultMessageSheet(): Sheet {
  return {
    imageLayout: "none",
    bg: CREAM,
    texts: [
      box("to", { x: 0.2, y: 0.12, len: 0.6, size: 5, color: "#7a6a5d" }),
      box("message", { x: 0.1, y: 0.38, len: 0.8, size: 7.5, bold: true }),
      box("from", { x: 0.55, y: 0.8, len: 0.38, size: 5.5 }),
    ],
  };
}

/** 前の版の手描き・スタンプの層は もう使わないので 取りのぞく */
function stripDrawing(s: Sheet | undefined): Sheet | undefined {
  if (!s || !("drawing" in s)) return s;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { drawing, ...rest } = s as Sheet & { drawing?: string };
  return rest;
}

/** 古い形式の絵本にもデザインを足す */
export function ensureDesigns(book: Book): Book {
  return {
    ...book,
    coverSheet: stripDrawing(book.coverSheet) ?? defaultCoverSheet(),
    dedicationSheet: stripDrawing(book.dedicationSheet) ?? defaultDedicationSheet(),
    messageSheet: stripDrawing(book.messageSheet) ?? defaultMessageSheet(),
    pages: book.pages.map((p) => ({ ...p, sheet: stripDrawing(p.sheet) ?? defaultPageSheet() })),
  };
}

/** ならべ方を変える。絵の大きさは そのならべ方の はじめの大きさに もどし、本文の箱は 新しい場所に移す */
export function applyLayout(sheet: Sheet, layout: ImageLayout): Sheet {
  const size = DEFAULT_IMAGE_SIZE[layout];
  return {
    ...sheet,
    imageLayout: layout,
    imageSize: undefined,
    texts: sheet.texts.map((t) => (t.role === "body" ? { ...t, ...bodyPos(layout, size), vertical: false } : t)),
  };
}

/** 絵の大きさを変える。moveBody なら 本文(よこ書き)も 絵のない所へ うごかす */
export function applyImageSize(sheet: Sheet, size: number, moveBody: boolean): Sheet {
  const s = clampImageSize(size);
  return {
    ...sheet,
    imageSize: s,
    texts: moveBody
      ? sheet.texts.map((t) => (t.role === "body" && !t.vertical ? { ...t, ...bodyPos(sheet.imageLayout, s), decor: t.decor === "bubble" || t.decor === "outline" ? t.decor : bodyPos(sheet.imageLayout, s).decor } : t))
      : sheet.texts,
  };
}

export function listSheets(book: Book): { ref: SheetRef; label: string }[] {
  return [
    { ref: { kind: "cover" }, label: "表紙" },
    { ref: { kind: "dedication" }, label: "とびら" },
    ...book.pages.map((_, i) => ({ ref: { kind: "page", index: i } as SheetRef, label: `${i + 1}` })),
    { ref: { kind: "message" }, label: "メッセージ" },
    { ref: { kind: "back" }, label: "うら表紙" },
  ];
}

export function sameRef(a: SheetRef, b: SheetRef) {
  return a.kind === b.kind && (a.kind !== "page" || a.index === (b as { index: number }).index);
}

function backSheet(book: Book): Sheet {
  const d = new Date(book.updatedAt);
  const date = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 につくりました`;
  const c = "#7a6a5d";
  return {
    imageLayout: "none",
    bg: CREAM,
    texts: [
      box("free", { text: book.title, x: 0.2, y: 0.68, len: 0.6, size: 3.8, color: c }),
      box("free", { text: `さく: ${book.memo.from}`, x: 0.2, y: 0.76, len: 0.6, size: 3.5, color: c }),
      box("free", { text: date, x: 0.2, y: 0.83, len: 0.6, size: 3.5, color: c }),
    ],
  };
}

export function getSheet(book: Book, ref: SheetRef): Sheet {
  switch (ref.kind) {
    case "cover": return book.coverSheet ?? defaultCoverSheet();
    case "dedication": return book.dedicationSheet ?? defaultDedicationSheet();
    case "message": return book.messageSheet ?? defaultMessageSheet();
    case "back": return backSheet(book);
    case "page": return book.pages[ref.index]?.sheet ?? defaultPageSheet();
  }
}

export function setSheet(book: Book, ref: SheetRef, sheet: Sheet): Book {
  switch (ref.kind) {
    case "cover": return { ...book, coverSheet: sheet };
    case "dedication": return { ...book, dedicationSheet: sheet };
    case "message": return { ...book, messageSheet: sheet };
    case "back": return book;
    case "page":
      return { ...book, pages: book.pages.map((p, i) => (i === ref.index ? { ...p, sheet } : p)) };
  }
}

export function sheetImage(book: Book, ref: SheetRef): string | undefined {
  if (ref.kind === "cover") return book.coverImage;
  if (ref.kind === "page") return book.pages[ref.index]?.image;
  return undefined;
}

export function resolveText(book: Book, ref: SheetRef, t: TextBox): string {
  switch (t.role) {
    case "body": return ref.kind === "page" ? book.pages[ref.index]?.text ?? "" : "";
    case "title": return book.title;
    case "from": return book.memo.from ? `${book.memo.from} より` : "";
    case "to": return `${book.memo.to || "あなた"} へ`;
    case "message": return book.memo.message;
    case "free": return t.text ?? "";
  }
}

export function newFreeBox(): TextBox {
  return box("free", { text: "ここに ことば", x: 0.3, y: 0.3, len: 0.4, size: 5, decor: "bubble" });
}
