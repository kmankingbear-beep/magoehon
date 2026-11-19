import { drawDummyIllustration } from "./dummyImage";
import { ART_STYLES, type Book } from "./types";

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "うまくいきませんでした。もう一度お試しください。");
  return json as T;
}

/** 見本として送る絵は小さくする(通信を軽くするため) */
const shrinkCache = new Map<string, Promise<string>>();
function shrink(dataUrl: string, maxW = 1024): Promise<string> {
  let p = shrinkCache.get(dataUrl);
  if (!p) {
    p = (async () => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const k = Math.min(1, maxW / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.88);
    })();
    shrinkCache.set(dataUrl, p);
  }
  return p;
}

function stylePrompt(book: Book) {
  return [
    ART_STYLES.find((s) => s.id === book.style)!.prompt,
    "High quality professional children's picture book illustration, rich detail, gentle and warm, print quality.",
    book.artDirection && `Art direction for the whole book: ${book.artDirection}`,
  ].filter(Boolean).join("\n");
}

type Result = { images: string[]; dummy: boolean };

async function generate(prompt: string, references: string[], n: number, seed: string, label: string): Promise<Result> {
  const refs = await Promise.all(references.map((r) => shrink(r)));
  const results = await Promise.all(
    Array.from({ length: n }, () => postJson<{ image?: string; demo?: boolean }>("/api/illustration", { prompt, references: refs })),
  );
  if (results.every((r) => r.image)) return { images: results.map((r) => r.image!), dummy: false };
  return { images: Array.from({ length: n }, () => drawDummyIllustration(seed + Math.random(), label)), dummy: true };
}

/** 登場人物の設定画(全ページの見本) */
export function illustrateCharacters(book: Book, extra = "") {
  const prompt = [
    stylePrompt(book),
    `Character design sheet for a picture book. Characters: ${book.characterSheet}`,
    "Show each character in full body, front view, friendly expression, standing side by side on a plain light background.",
    extra && `Adjustments: ${extra}`,
    "No text, letters, labels or speech bubbles.",
  ].filter(Boolean).join("\n");
  return generate(prompt, [], 1, "chara" + book.id, "とうじょうじんぶつ");
}

/** 場面の挿絵を n 枚(候補)つくる。設定画があれば見本として渡す */
export function illustrate(book: Book, scene: string, label: string, extra = "", n = 2) {
  const hasRef = Boolean(book.characterImage && !book.characterImageIsDummy);
  const prompt = [
    stylePrompt(book),
    hasRef
      ? "The attached image is the character design sheet. Draw the characters exactly as in it: same faces, hairstyles, clothes, colors and proportions."
      : "",
    `Characters: ${book.characterSheet}`,
    `Scene: ${scene}`,
    extra && `Adjustments requested by the author: ${extra}`,
    "Wide landscape composition (3:2) with some calm space near the edges for text. No text, letters, or speech bubbles in the image.",
  ].filter(Boolean).join("\n");
  return generate(prompt, hasRef ? [book.characterImage!] : [], n, scene + label + extra, label);
}

export function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
