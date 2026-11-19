import { generateIllustration, hasImageAI } from "@/lib/ai";

export const maxDuration = 120;

export async function POST(req: Request) {
  if (!hasImageAI()) return Response.json({ demo: true });
  const { prompt, references } = (await req.json()) as { prompt: string; references?: string[] };
  try {
    return Response.json({ image: await generateIllustration(prompt, (references ?? []).slice(0, 4)) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "エラーが起きました" }, { status: 500 });
  }
}
