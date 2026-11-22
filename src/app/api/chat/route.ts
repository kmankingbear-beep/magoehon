import { chatTurn, hasTextAI, lastText } from "@/lib/ai";
import { demoChat } from "@/lib/demo";
import type { ChatMessage } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: Request) {
  const { history } = (await req.json()) as { history: ChatMessage[] };
  if (!hasTextAI()) {
    await new Promise((r) => setTimeout(r, 500));
    return Response.json({ ...demoChat(history), demo: true });
  }
  try {
    const turn = await chatTurn(history.slice(-40));
    return Response.json({ ...turn, engine: lastText.engine, geminiError: lastText.geminiError || undefined });
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : "エラーが起きました" }, { status: 500 });
  }
}
