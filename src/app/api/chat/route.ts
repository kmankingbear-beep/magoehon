import { chatTurn, hasTextAI } from "@/lib/ai";
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
    return Response.json(await chatTurn(history.slice(-40)));
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : "エラーが起きました" }, { status: 500 });
  }
}
