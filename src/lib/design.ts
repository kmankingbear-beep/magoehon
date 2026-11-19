import type { Book, ImageLayout, Sheet, TextBox } from "./types";

export type SheetRef =
  | { kind: "cover" }
  | { kind: "dedication" }
  | { kind: "page"; index: number }
  | { kind: "message" }
  | { kind: "back" };

/** 絵の場所(仕上がりに対する割合) */
export const IMAGE_RECTS: Record<ImageLayout, { x: number; y: number; w: number; h: number } | null> = {
  top: { x: 0, y: 0, w: 1, h: 0.7 },
  bottom: { x: 0, y: 0.3, w: 1, h: 0.7 },
  full: { x: 0, y: 0, w: 1, h: 1 },
  left: { x: 0, y: 0, w: 0.6, h: 1 },
  right: { x: 0.4, y: 0, w: 0.6, h: 1 },
  none: null,
};

const BODY_POS: Record<ImageLayout, Pick<TextBox, "x" | "y" | "len" | "decor">> = {
  top: { x: 0.07, y: 0.76, len: 0.86, decor: "none" },
  bottom: { x: 0.07, y: 0.08, len: 0.86, decor: "none" },
  full: { x: 0.1, y: 0.7, len: 0.8, decor: "plate" },
  left: { x: 0.64, y: 0.3, len: 0.32, decor: "none" },
  right: { x: 0.04, y: 0.3, len: 0.32, decor: "none" },
  none: { x: 0.1, y: 0.4, len: 0.8, decor: "none" },
};

let seq = 0;
export const boxId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

const INK = "#3d3027";
const CREAM = "#fffaf0";

function box(role: TextBox["role"], p: Partial<TextBox>): TextBox {
  return { id: boxId(), role, x: 0.1, y: 0.4, len: 0.8, size: 6, color: INK, decor: "none", vertical: false, ...p };
}

export function defaultPageSheet(): Sheet {
  return { imageLayout: "top", bg: CREAM, texts: [box("body", BODY_POS.top)] };
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

/** 古い形式の絵本にもデザインを足す */
export function ensureDesigns(book: Book): Book {
  return {
    ...book,
    coverSheet: book.coverSheet ?? defaultCoverSheet(),
    dedicationSheet: book.dedicationSheet ?? defaultDedicationSheet(),
    messageSheet: book.messageSheet ?? defaultMessageSheet(),
    pages: book.pages.map((p) => (p.sheet ? p : { ...p, sheet: defaultPageSheet() })),
  };
}

/** ならべ方を変える。本文の箱は新しいならべ方の場所に移す */
export function applyLayout(sheet: Sheet, layout: ImageLayout): Sheet {
  return {
    ...sheet,
    imageLayout: layout,
    texts: sheet.texts.map((t) => (t.role === "body" ? { ...t, ...BODY_POS[layout], vertical: false } : t)),
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
