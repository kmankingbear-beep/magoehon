export type Memo = {
  /** 主人公(お孫さんの名前や、動物など) */
  hero: string;
  /** どんなおはなし・冒険か */
  adventure: string;
  /** 最後に伝えたい言葉 */
  message: string;
  /** 贈る人(例: おばあちゃん) */
  from: string;
  /** 贈る相手(例: はるとくん) */
  to: string;
};

export type ArtStyle = "watercolor" | "crayon" | "pastel";

export const ART_STYLES: { id: ArtStyle; label: string; prompt: string }[] = [
  {
    id: "watercolor",
    label: "やさしい水彩",
    prompt: "soft gentle watercolor children's picture book illustration, warm light, pastel tones",
  },
  {
    id: "crayon",
    label: "クレヨン",
    prompt: "hand-drawn crayon children's picture book illustration, cheerful, textured paper",
  },
  {
    id: "pastel",
    label: "ふんわりパステル",
    prompt: "fluffy soft pastel chalk children's picture book illustration, dreamy and cozy",
  },
];

export type Page = {
  text: string;
  /** 挿絵の場面説明(AIへの指示。英語) */
  scene: string;
  /** data URL(PNG/JPEG) */
  image?: string;
  imageIsDummy?: boolean;
};

export type Book = {
  id: string;
  title: string;
  memo: Memo;
  style: ArtStyle;
  storyPageCount: number;
  /** 登場人物の見た目(挿絵の一貫性のため。英語) */
  characterSheet: string;
  coverScene: string;
  coverImage?: string;
  coverImageIsDummy?: boolean;
  pages: Page[];
  createdAt: number;
  updatedAt: number;
};

export type StoryResult = {
  title: string;
  characterSheet: string;
  coverScene: string;
  pages: { text: string; scene: string }[];
};

export type ServerStatus = { textAI: boolean; imageAI: boolean };

/** 物語ページ数の選択肢。表紙・とびら・メッセージ・うら表紙の4ページを足すと 12/16/20 ページ */
export const STORY_PAGE_OPTIONS = [8, 12, 16];
export const EXTRA_PAGES = 4;
