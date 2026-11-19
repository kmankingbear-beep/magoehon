import { generateStory, hasTextAI } from "@/lib/ai";
import { demoStory } from "@/lib/demo";
import type { Memo } from "@/lib/types";
import { STORY_PAGE_OPTIONS } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: Request) {
  const { memo, storyPageCount } = (await req.json()) as { memo: Memo; storyPageCount: number };
  const count = STORY_PAGE_OPTIONS.includes(storyPageCount) ? storyPageCount : 8;
  if (!hasTextAI()) {
    await new Promise((r) => setTimeout(r, 800));
    return Response.json({ ...demoStory(memo, count), demo: true });
  }
  try {
    return Response.json(await generateStory(memo, count));
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : "エラーが起きました" }, { status: 500 });
  }
}
