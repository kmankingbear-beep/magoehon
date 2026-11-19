import { del, get, set, keys } from "idb-keyval";
import type { Book } from "./types";

const PREFIX = "book:";

export async function saveBook(book: Book) {
  await set(PREFIX + book.id, { ...book, updatedAt: Date.now() });
}
export async function loadBook(id: string) {
  return (await get(PREFIX + id)) as Book | undefined;
}
export async function deleteBook(id: string) {
  await del(PREFIX + id);
}
export async function listBooks(): Promise<Book[]> {
  const ks = (await keys()).filter((k) => String(k).startsWith(PREFIX));
  const books = await Promise.all(ks.map((k) => get(k) as Promise<Book>));
  return books.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}
