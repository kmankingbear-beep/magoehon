import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import type { ChatMessage, ChatTurn, Memo, StoryResult } from "./types";

export const MODEL = "claude-opus-5-5";

export function hasTextAI() {
  return Boolean(process.env.ANTHROPIC_API_KEY || hasCloudflare());
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

type Msg = { role: "user" | "assistant"; content: string };

/**
 * 決まった形(schema)の返事をAIからもらう。
 * Claude の鍵があれば Claude、なければ Cloudflare Workers AI(無料分あり)を使う。
 */
async function structured<T extends z.ZodType>(
  schema: T, system: string, messages: Msg[], opts: { effort: "low" | "medium"; maxTokens: number },
): Promise<z.infer<T>> {
  if (!process.env.ANTHROPIC_API_KEY) return cloudflareJson(schema, system, messages, opts.maxTokens);
  const res = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: opts.effort, format: zodOutputFormat(schema) },
    system,
    messages,
  });
  if (res.stop_reason === "refusal") throw new Error("AIがこの内容では作れませんでした。言葉を変えてもう一度お試しください。");
  if (!res.parsed_output) throw new Error("AIの返事を読み取れませんでした。もう一度お試しください。");
  return res.parsed_output as z.infer<T>;
}

/** 返事の文章から JSON の部分だけを取り出す */
function extractJson(text: string): unknown {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : t;
  const a = body.indexOf("{"), b = body.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no json");
  return JSON.parse(body.slice(a, b + 1));
}

async function cloudflareJson<T extends z.ZodType>(schema: T, system: string, messages: Msg[], maxTokens: number): Promise<z.infer<T>> {
  const model = process.env.CLOUDFLARE_TEXT_MODEL || "@cf/google/gemma-4-26b-a4b-it";
  const format = `\n\n# 返事の形\n返事は、次の JSON Schema に合う JSON オブジェクトだけを書いてください。前後に説明やコードブロックは書かないでください。文章はすべて自然な日本語で書いてください(英語と指定された項目は英語)。\n${JSON.stringify(z.toJSONSchema(schema))}`;
  const body = {
    messages: [{ role: "system", content: system + format }, ...messages],
    max_tokens: maxTokens,
    temperature: 0.7,
  };
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(110_000),
    }).catch((e) => {
      console.error("cloudflare text timeout/network", e);
      throw new Error("AIの返事がおそすぎました。もう一度お試しください。");
    });
    const json = (await res.json().catch(() => ({}))) as {
      result?: { response?: unknown; choices?: { message?: { content?: string } }[] };
      errors?: { message?: string }[];
    };
    if (!res.ok) {
      console.error("cloudflare text error", res.status, JSON.stringify(json).slice(0, 500));
      if (res.status === 429 || /neuron|limit/i.test(JSON.stringify(json))) {
        throw new Error("きょうの無料分を使いきりました。あしたまた、おためしください。");
      }
      throw new Error("AIの返事がありませんでした。もう一度お試しください。");
    }
    const r = json.result ?? {};
    const raw = typeof r.response === "object" && r.response !== null
      ? JSON.stringify(r.response)
      : String(r.response ?? r.choices?.[0]?.message?.content ?? "");
    try {
      const parsed = schema.safeParse(extractJson(raw));
      if (parsed.success) return parsed.data;
      lastErr = parsed.error.message.slice(0, 300);
    } catch (e) {
      lastErr = `${e instanceof Error ? e.message : e}: ${raw.slice(0, 200)}`;
    }
    console.error("cloudflare text: bad json", attempt, lastErr);
  }
  throw new Error("AIの返事を読み取れませんでした。もう一度お試しください。");
}

async function parse<T extends z.ZodType>(schema: T, user: string): Promise<z.infer<T>> {
  return structured(schema, SYSTEM, [{ role: "user", content: user }], { effort: "medium", maxTokens: process.env.ANTHROPIC_API_KEY ? 16000 : 4000 });
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
export async function generateIllustration(prompt: string, references: string[] = []): Promise<{ image: string; engine: string }> {
  // 無料の Cloudflare を優先。なければ Gemini、なければ OpenAI
  if (hasCloudflare()) {
    try {
      // FLUX.2 klein: 見本の絵(設定画)を見ながらかけるので、ページごとの見た目がそろいやすい
      return { image: await toJpeg(await fluxKlein(prompt, references), 2048), engine: "flux-2-klein" };
    } catch (e) {
      console.error("flux-2-klein failed, falling back to schnell", e);
      return { image: await toJpeg(await cloudflareImage(prompt), 2048), engine: `flux-1-schnell (klein: ${String(e).slice(0, 200)})` };
    }
  }
  const raw = process.env.GEMINI_API_KEY ? await geminiImage(prompt, references) : await openaiImage(prompt);
  return { image: await toJpeg(raw), engine: process.env.GEMINI_API_KEY ? "gemini" : "openai" };
}

/** Cloudflare Workers AI の FLUX.2 klein(見本の絵を最大4枚まで渡せる) */
async function fluxKlein(prompt: string, references: string[]): Promise<Buffer> {
  const model = process.env.CLOUDFLARE_REF_IMAGE_MODEL || "@cf/black-forest-labs/flux-2-klein-4b";
  const form = new FormData();
  form.append("prompt", prompt.slice(0, 2048));
  form.append("width", "1024");
  form.append("height", "672");
  const refs = references.map((r) => r.match(/^data:(.+?);base64,(.+)$/)).filter((m) => m !== null).slice(0, 4);
  for (const [i, m] of refs.entries()) {
    const small = await sharp(Buffer.from(m[2], "base64")).resize({ width: 768, height: 768, fit: "inside" }).jpeg({ quality: 88 }).toBuffer();
    form.append(`input_image_${i}`, new Blob([new Uint8Array(small)], { type: "image/jpeg" }), `ref${i}.jpg`);
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  const json = (await res.json().catch(() => ({}))) as { result?: { image?: string }; image?: string; errors?: { message?: string }[] };
  const image = json.result?.image ?? json.image;
  if (!res.ok || !image) {
    throw new Error(`klein ${res.status}: ${json.errors?.[0]?.message ?? JSON.stringify(json).slice(0, 200)}`);
  }
  return Buffer.from(image, "base64");
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
  try {
    return await structured(ChatSchema, CHAT_SYSTEM, messages, { effort: "low", maxTokens: process.env.ANTHROPIC_API_KEY ? 4000 : 1200 });
  } catch (e) {
    if (e instanceof Error && e.message.includes("無料分")) throw e;
    throw new Error("うまく聞き取れませんでした。もう一度お話しください。");
  }
}
