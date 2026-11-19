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
  /** AIとのおしゃべりで出てきた思い出や好きなもの(物語に生かす) */
  notes?: string;
};

export type ChatMessage = { role: "user" | "assistant"; text: string };
export type ChatTurn = { reply: string; memo: Memo; ready: boolean };

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

/* ---------- ページのデザイン ---------- */

/** 挿絵のならべ方 */
export type ImageLayout = "top" | "bottom" | "full" | "left" | "right" | "none";
export const IMAGE_LAYOUTS: { id: ImageLayout; label: string }[] = [
  { id: "top", label: "絵が上" },
  { id: "bottom", label: "絵が下" },
  { id: "full", label: "絵いっぱい" },
  { id: "left", label: "絵が左" },
  { id: "right", label: "絵が右" },
  { id: "none", label: "絵なし" },
];

export type TextDecor = "none" | "plate" | "bubble" | "outline";
export const TEXT_DECORS: { id: TextDecor; label: string }[] = [
  { id: "none", label: "なし" },
  { id: "plate", label: "白い板" },
  { id: "bubble", label: "ふきだし" },
  { id: "outline", label: "ふちどり" },
];

export const TEXT_COLORS = ["#3d3027", "#ffffff", "#d93b3b", "#2f6fd6", "#2e8b57", "#e07a12", "#8e44ad"];
export const BG_COLORS = ["#fffaf0", "#fff1f4", "#eef7ff", "#effaea", "#fff8d6", "#f3ecff"];

/** 文字の箱。位置と長さは「仕上がりの大きさ」に対する割合(0〜1) */
export type TextBox = {
  id: string;
  /** body=本文 / title=題名 / from=だれから / to=だれへ / message=メッセージ / free=自由な文字(ふきだし等) */
  role: "body" | "title" | "from" | "to" | "message" | "free";
  /** role=free のときの文字 */
  text?: string;
  x: number;
  y: number;
  /** 1行の長さ(よこ書き=幅、たて書き=高さ)の割合 */
  len: number;
  /** 文字の大きさ(mm) */
  size: number;
  color: string;
  decor: TextDecor;
  vertical: boolean;
  bold?: boolean;
};

export type Sheet = {
  imageLayout: ImageLayout;
  bg: string;
  texts: TextBox[];
  /** 手描き・スタンプの層(すき通ったPNGの data URL)。ページ全体(塗り足しこみ)に重なる */
  drawing?: string;
};

export type Page = {
  text: string;
  /** 挿絵の場面説明(AIへの指示。英語) */
  scene: string;
  /** data URL(PNG/JPEG) */
  image?: string;
  imageIsDummy?: boolean;
  sheet?: Sheet;
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
  coverSheet?: Sheet;
  dedicationSheet?: Sheet;
  messageSheet?: Sheet;
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
