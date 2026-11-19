import type { ChatMessage, ChatTurn, Memo, StoryResult } from "./types";

/** AIのキーがないときに使う、おためし用の物語。メモの言葉をはめこんで作る。 */
export function demoStory(memo: Memo, storyPageCount: number): StoryResult {
  const hero = memo.hero.trim() || "ちいさな くま";
  const adv = memo.adventure.trim() || "もりへ ぼうけんに でかける";
  const msg = memo.message.trim() || "あなたが だいすきだよ";
  const lines = [
    `あるところに、${hero}が いました。`,
    `ある あさ、${hero}は おもいました。「きょうは ${adv}ぞ!」`,
    `おひさまが にっこり。かぜが そよそよ。さあ、しゅっぱつです。`,
    `みちの とちゅうで、ちいさな とりさんに あいました。「いっしょに いこう!」`,
    `おおきな きの したで、みんなで ひとやすみ。どんぐりが ころころ。`,
    `かわを わたるのは ちょっと こわい。でも ${hero}は ゆうきを だしました。`,
    `「できた!」 みんなが ぱちぱち てを たたきました。`,
    `すてきな はなばたけに つきました。いい においが します。`,
    `${hero}は おはなを つんで、おみやげに しました。`,
    `そらが オレンジいろに なってきました。そろそろ かえる じかんです。`,
    `おうちの あかりが みえてきました。あたたかい においが します。`,
    `「ただいま!」 だいすきな ひとが ぎゅっと だきしめてくれました。`,
    `きょうの ぼうけんの おはなしを、たくさん たくさん しました。`,
    `よるに なると、おほしさまが きらきら ひかりました。`,
    `${hero}は おふとんの なかで、にっこり わらいました。`,
  ];
  const body = lines.slice(0, storyPageCount - 1);
  while (body.length < storyPageCount - 1) body.push(`${hero}の ぼうけんは まだまだ つづきます。`);
  body.push(`そして ${memo.from || "おばあちゃん"}は いいました。「${msg}」`);
  return {
    title: `${hero}の だいぼうけん`,
    characterSheet: hero,
    coverScene: "cover",
    pages: body.map((text, i) => ({ text, scene: `scene ${i + 1}` })),
  };
}

/* ---------- おためしのおしゃべり(AIのキーがないとき) ---------- */

const SCRIPT: { key: keyof Memo | null; ask: (m: Memo) => string }[] = [
  { key: null, ask: () => "こんにちは。いっしょに 絵本を つくりましょう。この絵本は、どなたに 贈りますか?" },
  { key: "to", ask: (m) => `${m.to}に 贈るんですね。${m.to}からは、なんと 呼ばれていますか?` },
  { key: "from", ask: () => "すてきですね。おはなしの 主人公は だれに しましょう? お孫さんでも、動物でも いいですよ。" },
  { key: "hero", ask: (m) => `${m.hero}が 主人公ですね。どんな おはなしに しましょう? 思い出の 場所や、いっしょに したいことは ありますか?` },
  { key: "adventure", ask: () => "わあ、たのしそうです。そのときの 思い出や、お孫さんの 好きなものを、もう少し 教えてください。" },
  { key: "notes", ask: () => "ありがとうございます。さいごに、お孫さんに 伝えたい ことばは ありますか?" },
  { key: "message", ask: () => "とても すてきな おはなしに なりそうです。この内容で 絵本を つくりましょうか?" },
];

export function demoChat(history: ChatMessage[]): ChatTurn {
  const memo: Memo = { hero: "", adventure: "", message: "", from: "", to: "", notes: "" };
  const answers = history.filter((m) => m.role === "user").map((m) => m.text.trim());
  answers.forEach((a, i) => {
    const key = SCRIPT[i + 1]?.key;
    if (key) memo[key] = a.replace(/(です|だよ|かな)?[。!?]*$/, "");
  });
  if (!memo.hero && memo.to) memo.hero = memo.to;
  const step = Math.min(answers.length, SCRIPT.length - 1);
  const ready = answers.length >= SCRIPT.length - 1;
  return {
    reply: ready && answers.length > SCRIPT.length - 1 ? "はい、ほかにも 思い出したら いつでも 話してくださいね。" : SCRIPT[step].ask(memo),
    memo,
    ready,
  };
}
