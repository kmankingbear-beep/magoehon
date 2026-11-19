import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import type { ChatMessage, ChatTurn, Memo, StoryResult } from "./types";

export const MODEL = "claude-opus-5-5";

export function hasTextAI() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
export function hasImageAI() {
  return Boolean(hasCloudflare() || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
}
function hasCloudflare() {
  return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);
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
- characterSheet には主人公など登場人物の見た目(年齢、髪型、服の色など)を具体的に書き、全ページで同じ見た目になるようにする。
- artDirection には、この1冊の絵の方針(色づかい、光、季節、構図のくせ、線のタッチ)を英語で3〜5文で書く。全ページ共通で使う。
- scene には、そのページで描くもの(だれが・どこで・何をしている・表情・カメラの距離)を具体的に書く。`;

const StorySchema = z.object({
  title: z.string().describe("絵本のタイトル(ひらがな中心、20文字以内)"),
  characterSheet: z.string().describe("English. Consistent visual description of the main characters."),
  coverScene: z.string().describe("English. Cover illustration scene."),
  artDirection: z.string().describe("English. Shared art direction for the whole book."),
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
贈る相手: ${memo.to}
${memo.notes ? `\nおしゃべりで聞いた思い出や好きなもの(できるだけ物語に生かしてください):\n${memo.notes}` : ""}`,
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

/** 挿絵を作る。Gemini があれば Gemini、なければ OpenAI。references は見本の絵(data URL) */
export async function generateIllustration(prompt: string, references: string[] = []): Promise<string> {
  // 無料の Cloudflare を優先。なければ Gemini、なければ OpenAI
  if (hasCloudflare()) return toJpeg(await cloudflareImage(prompt), 2048);
  const raw = process.env.GEMINI_API_KEY ? await geminiImage(prompt, references) : await openaiImage(prompt);
  return toJpeg(raw);
}

/** Cloudflare Workers AI(FLUX.1 schnell)。毎日の無料分がある。正方形で返るので、上下が少し切れる */
async function cloudflareImage(prompt: string): Promise<Buffer> {
  const model = process.env.CLOUDFLARE_IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell";
  const text = `${prompt}\nKeep all important subjects in the middle band of the image; the top and bottom edges will be cropped.`;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    body: JSON.stringify({ prompt: text.slice(0, 2048), steps: 8 }),
  });
  const json = (await res.json().catch(() => ({}))) as { result?: { image?: string }; image?: string; errors?: { message?: string }[] };
  const image = json.result?.image ?? json.image;
  if (!res.ok || !image) {
    console.error("cloudflare image error", res.status, JSON.stringify(json).slice(0, 500));
    throw new Error(`Cloudflare ${res.status}: ${json.errors?.[0]?.message ?? "no image"}`);
  }
  return Buffer.from(image, "base64");
}

async function geminiImage(prompt: string, references: string[]): Promise<Buffer> {
  // Gemini の Interactions API(画像生成の公式ドキュメントの書き方)
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: "v1beta" } });
  const images = references.map((r) => r.match(/^data:(.+?);base64,(.+)$/)).filter((m) => m !== null);
  const interaction = await ai.interactions.create({
    model: process.env.GEMINI_IMAGE_MODEL || "gemini-nano-banana-2.1",
    input: [
      { type: "text", text: prompt },
      ...images.map((m) => ({ type: "image" as const, mime_type: m[1], data: m[2] })),
    ],
    response_format: {
      type: "image",
      aspect_ratio: "3:2",
      image_size: process.env.GEMINI_IMAGE_SIZE || "2K",
    },
  } as Parameters<typeof ai.interactions.create>[0]);
  const data = (interaction as { output_image?: { data?: string } }).output_image?.data;
  if (!data) {
    console.error("gemini image: no image", JSON.stringify(interaction).slice(0, 500));
    throw new Error("挿絵を作れませんでした。もう一度お試しください。");
  }
  return Buffer.from(data, "base64");
}

async function openaiImage(prompt: string): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      prompt,
      size: "1536x1024",
      quality: "high",
      n: 1,
    }),
  });
  if (!res.ok) {
    console.error("image API error", res.status, await res.text());
    throw new Error("挿絵を作れませんでした。もう一度お試しください。");
  }
  const json = (await res.json()) as { data: { b64_json: string }[] };
  return Buffer.from(json.data[0].b64_json, "base64");
}

/** 返す大きさをおさえるため JPEG にする(Vercel の応答は4.5MBまで) */
async function toJpeg(buf: Buffer, upscaleTo?: number): Promise<string> {
  let img = sharp(buf);
  if (upscaleTo) img = img.resize({ width: upscaleTo, kernel: "lanczos3" });
  const out = await img.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

/* ---------- AIとおしゃべり ---------- */

const CHAT_SYSTEM = `あなたは、おじいちゃん・おばあちゃんがお孫さんに贈る絵本づくりを手伝う、聞き上手な「おはなし係」です。
画面の文字は読み上げられます。相手はご高齢の方で、声で答えます。

話し方:
- やさしく、ゆっくり、短く。1回の返事は2文まで、全角70文字くらいまで。
- 質問は1回に1つだけ。答えやすい具体的な質問にする(「お孫さんは何歳ですか?」「いっしょに行った場所はありますか?」)。
- 相手の言葉をまず受け止めて、ほめたり、共感したりしてから次を聞く。
- 昔の思い出や、お孫さんの好きなもの・くせ・口ぐせを、楽しく思い出してもらえるように聞く(回想法)。
- むずかしい言葉、カタカナ語、絵文字は使わない。

聞きたいこと(順番は会話に合わせて自由に):
- だれに贈るか(to)、お孫さんから何と呼ばれているか(from、例「おばあちゃん」)
- 主人公(hero。お孫さん本人、動物、ご自身など)
- どんなおはなしにするか(adventure。思い出の場所、いっしょにしたいこと、夢など)
- 最後に伝えたい言葉(message)
- 物語に生かせる細かい思い出や好きなもの(notes に箇条書きでためていく)

memo には、これまでの会話でわかったことをすべて入れて返す(わからない項目は空文字)。
hero, adventure, message, from, to がそろい、もう少し思い出も聞けたら(だいたい6〜10往復)、ready を true にして
「すてきなおはなしになりそうです。この内容で絵本をつくりましょうか?」のように声をかける。
相手がもっと話したそうなら、ready のあとも会話を続けてよい。`;

const ChatSchema = z.object({
  reply: z.string().describe("相手への返事(読み上げられる)"),
  memo: z.object({
    hero: z.string(),
    adventure: z.string(),
    message: z.string(),
    from: z.string(),
    to: z.string(),
    notes: z.string().describe("物語に生かせる思い出や好きなもの。箇条書き"),
  }),
  ready: z.boolean(),
});

export async function chatTurn(history: ChatMessage[]): Promise<ChatTurn> {
  // 長い会話は後ろだけ使う。開始の合図のあとが assistant になるようにそろえる
  while (history.length && history[0].role === "user") history = history.slice(1);
  const messages = [
    { role: "user" as const, content: "(おしゃべりを始めてください。まずあいさつをして、だれに絵本を贈るか聞いてください)" },
    ...history.map((m) => ({ role: m.role, content: m.text })),
  ];
  // Messages API は user と assistant が交互になる必要がある。最初の assistant の前に開始の合図を置いている。
  const res = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: zodOutputFormat(ChatSchema) },
    system: CHAT_SYSTEM,
    messages,
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) {
    throw new Error("うまく聞き取れませんでした。もう一度お話しください。");
  }
  return res.parsed_output as ChatTurn;
}
