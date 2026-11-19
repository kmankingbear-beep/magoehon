import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Memo, StoryResult } from "./types";

export const MODEL = "claude-opus-5-5";

export function hasTextAI() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
export function hasImageAI() {
  return Boolean(process.env.OPENAI_API_KEY);
}

let client: Anthropic | null = null;
function getClient() {
  client ??= new Anthropic();
  return client;
}

const SYSTEM = `あなたは、おじいちゃん・おばあちゃんがお孫さんに贈る絵本を一緒につくる、やさしい絵本作家です。
- 対象は3〜8歳くらいの子ども。ひらがな中心で、むずかしい漢字は使わない。
- 1ページの文章は2〜3文、全角60文字以内。声に出して読みやすいリズムにする。
- 怖い・悲しい展開は避け、あたたかく前向きなおはなしにする。
- 最後のページで、贈る人が伝えたい言葉が自然に伝わるようにする。
- 挿絵の指示(scene, characterSheet, coverScene)は画像生成AI向けに英語で書く。文字や吹き出しを絵に入れない指示にする。
- characterSheet には主人公など登場人物の見た目(年齢、髪型、服の色など)を具体的に書き、全ページで同じ見た目になるようにする。`;

const StorySchema = z.object({
  title: z.string().describe("絵本のタイトル(ひらがな中心、20文字以内)"),
  characterSheet: z.string().describe("English. Consistent visual description of the main characters."),
  coverScene: z.string().describe("English. Cover illustration scene."),
  pages: z.array(
    z.object({
      text: z.string().describe("そのページの文章(日本語)"),
      scene: z.string().describe("English. Illustration scene for this page."),
    }),
  ),
});

const PageSchema = z.object({
  text: z.string(),
  scene: z.string(),
  redrawImage: z.boolean().describe("挿絵を描き直す必要があるか"),
});

async function parse<T extends z.ZodType>(schema: T, user: string): Promise<z.infer<T>> {
  const res = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: zodOutputFormat(schema) },
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal") throw new Error("AIがこの内容では作れませんでした。言葉を変えてもう一度お試しください。");
  if (!res.parsed_output) throw new Error("AIの返事を読み取れませんでした。もう一度お試しください。");
  return res.parsed_output as z.infer<T>;
}

export async function generateStory(memo: Memo, storyPageCount: number): Promise<StoryResult> {
  const story = await parse(
    StorySchema,
    `次のメモから、物語ページがちょうど${storyPageCount}ページの絵本をつくってください。

主人公: ${memo.hero}
どんなおはなし: ${memo.adventure}
最後に伝えたい言葉: ${memo.message}
贈る人: ${memo.from}
贈る相手: ${memo.to}`,
  );
  return { ...story, pages: story.pages.slice(0, storyPageCount) };
}

export async function revisePage(args: {
  title: string;
  characterSheet: string;
  pages: { text: string }[];
  index: number;
  current: { text: string; scene: string };
  request: string;
}) {
  const all = args.pages.map((p, i) => `${i + 1}ページ: ${p.text}`).join("\n");
  return parse(
    PageSchema,
    `絵本「${args.title}」の${args.index + 1}ページ目を、ご希望に合わせて直してください。
ほかのページとのつながりは保ってください。絵だけの希望なら文章は変えず、文章だけの希望なら redrawImage を false にしてください。

登場人物の見た目: ${args.characterSheet}

全体の文章:
${all}

いまの${args.index + 1}ページ目:
文章: ${args.current.text}
挿絵: ${args.current.scene}

ご希望: ${args.request}`,
  );
}

/** 挿絵を作る。OpenAI の画像生成APIを使う(キーがなければ呼ばない)。 */
export async function generateIllustration(prompt: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      prompt,
      size: "1536x1024",
      quality: "medium",
      output_format: "jpeg",
      n: 1,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("image API error", res.status, body);
    throw new Error("挿絵を作れませんでした。もう一度お試しください。");
  }
  const json = (await res.json()) as { data: { b64_json: string }[] };
  return `data:image/jpeg;base64,${json.data[0].b64_json}`;
}
