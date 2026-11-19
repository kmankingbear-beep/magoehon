import { drawDummyIllustration } from "./dummyImage";
import { ART_STYLES, type Book } from "./types";

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "うまくいきませんでした。もう一度お試しください。");
  return json as T;
}

/** 挿絵を1枚つくる。画像AIが使えないときは、おためしの絵を描く */
export async function illustrate(book: Book, scene: string, label: string, extra = "") {
  const style = ART_STYLES.find((s) => s.id === book.style)!.prompt;
  const prompt = [
    style,
    `Characters (keep identical on every page): ${book.characterSheet}`,
    `Scene: ${scene}`,
    extra && `Adjustments: ${extra}`,
    "Landscape composition. No text, letters, or speech bubbles in the image.",
  ].filter(Boolean).join("\n");
  const res = await postJson<{ image?: string; demo?: boolean }>("/api/illustration", { prompt });
  if (res.image) return { image: res.image, dummy: false };
  return { image: drawDummyIllustration(scene + label + extra + Math.random(), label), dummy: true };
}

export function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
