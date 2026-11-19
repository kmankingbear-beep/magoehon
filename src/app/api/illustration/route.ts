import { generateIllustration, hasImageAI } from "@/lib/ai";

export const maxDuration = 120;

export async function POST(req: Request) {
  if (!hasImageAI()) return Response.json({ demo: true });
  const { prompt, references } = (await req.json()) as { prompt: string; references?: string[] };
  try {
    return Response.json({ image: await generateIllustration(prompt, (references ?? []).slice(0, 4)) });
  } catch (e) {
    console.error("illustration error", e);
    const detail = e instanceof Error ? e.message.slice(0, 300) : String(e);
    return Response.json({ error: "挿絵を作れませんでした。もう一度お試しください。", detail }, { status: 500 });
  }
}
