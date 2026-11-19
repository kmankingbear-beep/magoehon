import { hasImageAI, hasTextAI } from "@/lib/ai";

export async function GET() {
  return Response.json({ textAI: hasTextAI(), imageAI: hasImageAI() });
}
