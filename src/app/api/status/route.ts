import { connection } from "next/server";
import { hasImageAI, hasTextAI } from "@/lib/ai";

export async function GET() {
  // キーの有無は実行時に調べる(公開後にキーを設定しても反映されるように)
  await connection();
  return Response.json({ textAI: hasTextAI(), imageAI: hasImageAI() });
}
