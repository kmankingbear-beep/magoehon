import { hasTextAI, revisePage } from "@/lib/ai";

export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await req.json();
  if (!hasTextAI()) {
    // おためしモード: 文章はそのまま、絵だけ描き直す
    return Response.json({ text: body.current.text, scene: body.current.scene, redrawImage: true, demo: true });
  }
  try {
    return Response.json(await revisePage(body));
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : "エラーが起きました" }, { status: 500 });
  }
}
