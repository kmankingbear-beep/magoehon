import type { Memo, StoryResult } from "./types";

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
