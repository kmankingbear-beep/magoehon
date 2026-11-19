"use client";
import { useCallback, useEffect, useState } from "react";
import { illustrate, newId, postJson } from "@/lib/client";
import { deleteBook, listBooks, saveBook } from "@/lib/store";
import {
  ART_STYLES, EXTRA_PAGES, STORY_PAGE_OPTIONS,
  type Book, type Memo, type ServerStatus, type StoryResult,
} from "@/lib/types";
import { useSpeech } from "./useSpeech";

type Step = "home" | "memo" | "generate" | "review" | "cover" | "print";
const STEPS: { id: Step; label: string }[] = [
  { id: "memo", label: "おはなしメモ" },
  { id: "generate", label: "AIがつくる" },
  { id: "review", label: "よみあわせ" },
  { id: "cover", label: "表紙と言葉" },
  { id: "print", label: "印刷用データ" },
];

const EMPTY_MEMO: Memo = { hero: "", adventure: "", message: "", from: "", to: "" };

export default function Studio() {
  const [step, setStep] = useState<Step>("home");
  const [book, setBook] = useState<Book | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus({ textAI: false, imageAI: false }));
  }, []);

  const update = useCallback((fn: (b: Book) => Book) => {
    setBook((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      void saveBook(next);
      return next;
    });
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setStep("home")}>📖 まごえほん</button>
        {status && (!status.textAI || !status.imageAI) && (
          <span className="badge" title="AIのキーが設定されていない部分は、おためしの文章や絵で動きます">
            おためし{!status.textAI && !status.imageAI ? "モード" : !status.textAI ? "(文章)" : "(絵)"}
          </span>
        )}
      </header>
      {step !== "home" && <Stepper step={step} onJump={book ? setStep : undefined} />}
      <main className="main">
        {step === "home" && (
          <Home
            onNew={() => { setBook(null); setStep("memo"); }}
            onOpen={(b) => { setBook(b); setStep("review"); }}
          />
        )}
        {step === "memo" && (
          <MemoStep
            initial={book}
            onDone={(b) => { setBook(b); void saveBook(b); setStep("generate"); }}
          />
        )}
        {step === "generate" && book && <GenerateStep book={book} update={update} onNext={() => setStep("review")} />}
        {step === "review" && book && <ReviewStep book={book} update={update} onNext={() => setStep("cover")} />}
        {step === "cover" && book && <CoverStep book={book} update={update} onNext={() => setStep("print")} />}
        {step === "print" && book && <PrintStep book={book} onBack={() => setStep("review")} />}
      </main>
    </div>
  );
}

function Stepper({ step, onJump }: { step: Step; onJump?: (s: Step) => void }) {
  const idx = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="stepper">
      {STEPS.map((s, i) => (
        <li key={s.id} className={i === idx ? "now" : i < idx ? "done" : ""}>
          <button disabled={!onJump || s.id === "generate" || i > idx} onClick={() => onJump?.(s.id)}>
            <span className="num">{i + 1}</span>
            {s.label}
          </button>
        </li>
      ))}
    </ol>
  );
}

/* ---------- ホーム ---------- */
function Home({ onNew, onOpen }: { onNew: () => void; onOpen: (b: Book) => void }) {
  const [books, setBooks] = useState<Book[]>([]);
  useEffect(() => { listBooks().then(setBooks); }, []);
  return (
    <section className="card center">
      <h1>お孫さんに贈る、<br />世界にひとつの絵本</h1>
      <p className="lead">お話を聞かせてください。AIが文章と絵にします。</p>
      <button className="btn primary huge" onClick={onNew}>あたらしい絵本をつくる</button>
      {books.length > 0 && (
        <>
          <h2>つくった絵本</h2>
          <ul className="booklist">
            {books.map((b) => (
              <li key={b.id}>
                <button className="bookitem" onClick={() => onOpen(b)}>
                  {b.coverImage && <img src={b.coverImage} alt="" />}
                  <span>{b.title}</span>
                </button>
                <button
                  className="btn small ghost"
                  onClick={async () => {
                    if (!confirm(`「${b.title}」を消しますか?`)) return;
                    await deleteBook(b.id);
                    setBooks(await listBooks());
                  }}
                >消す</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/* ---------- 1. おはなしメモ ---------- */
function VoiceField(props: {
  label: string; hint: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string;
}) {
  const { supported, listening, toggle } = useSpeech((t) => props.onChange(props.value ? props.value + t : t));
  const Input = props.multiline ? "textarea" : "input";
  return (
    <label className="field">
      <span className="label">{props.label}</span>
      <span className="hint">{props.hint}</span>
      <span className="row">
        <Input
          className="input"
          value={props.value}
          placeholder={props.placeholder}
          onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => props.onChange(e.target.value)}
          rows={props.multiline ? 3 : undefined}
        />
        {supported && (
          <button type="button" className={`btn mic ${listening ? "on" : ""}`} onClick={toggle} aria-label="声で入力">
            {listening ? "■ とめる" : "🎤 話す"}
          </button>
        )}
      </span>
    </label>
  );
}

function MemoStep({ initial, onDone }: { initial: Book | null; onDone: (b: Book) => void }) {
  const [memo, setMemo] = useState<Memo>(initial?.memo ?? EMPTY_MEMO);
  const [count, setCount] = useState(initial?.storyPageCount ?? 8);
  const [style, setStyle] = useState(initial?.style ?? ART_STYLES[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof Memo) => (v: string) => setMemo((m) => ({ ...m, [k]: v }));
  const ready = memo.hero.trim() && memo.adventure.trim() && memo.message.trim();

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const story = await postJson<StoryResult>("/api/story", { memo, storyPageCount: count });
      const now = Date.now();
      onDone({
        id: initial?.id ?? newId(),
        title: story.title,
        memo,
        style,
        storyPageCount: count,
        characterSheet: story.characterSheet,
        coverScene: story.coverScene,
        pages: story.pages.map((p) => ({ text: p.text, scene: p.scene })),
        createdAt: initial?.createdAt ?? now,
        updatedAt: now,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h1>おはなしを きかせてください</h1>
      <p className="lead">3つだけ教えてください。🎤 を押すと声で入力できます。</p>
      <VoiceField label="① 主人公はだれ?" hint="お孫さんの名前や、好きな動物など" placeholder="例: はるとくんと、いぬのポチ"
        value={memo.hero} onChange={set("hero")} />
      <VoiceField label="② どんなおはなし?" hint="冒険、思い出、好きなことなど" placeholder="例: うみへ さかなを つりにいく"
        value={memo.adventure} onChange={set("adventure")} multiline />
      <VoiceField label="③ 最後に伝えたい言葉" hint="お孫さんへのメッセージ" placeholder="例: げんきに おおきくなってね"
        value={memo.message} onChange={set("message")} multiline />
      <div className="two">
        <VoiceField label="だれから?" hint="表紙にのります" placeholder="例: おばあちゃん" value={memo.from} onChange={set("from")} />
        <VoiceField label="だれへ?" hint="最初のページにのります" placeholder="例: はるとくん" value={memo.to} onChange={set("to")} />
      </div>

      <div className="field">
        <span className="label">絵のふんいき</span>
        <div className="choices">
          {ART_STYLES.map((s) => (
            <button key={s.id} className={`choice ${style === s.id ? "on" : ""}`} onClick={() => setStyle(s.id)}>{s.label}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">ページ数</span>
        <div className="choices">
          {STORY_PAGE_OPTIONS.map((n) => (
            <button key={n} className={`choice ${count === n ? "on" : ""}`} onClick={() => setCount(n)}>
              {n + EXTRA_PAGES}ページ
            </button>
          ))}
        </div>
        <span className="hint">表紙・最初のページ・メッセージ・うら表紙をふくみます</span>
      </div>

      {error && <p className="error">{error}</p>}
      <button className="btn primary huge" disabled={!ready || busy} onClick={submit}>
        {busy ? "おはなしを考えています…" : "この内容で絵本をつくる"}
      </button>
      {!ready && <p className="hint center">①②③を入れると押せるようになります</p>}
    </section>
  );
}

/* ---------- 2. AIがつくる ---------- */
function GenerateStep({ book, update, onNext }: { book: Book; update: (fn: (b: Book) => Book) => void; onNext: () => void }) {
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const total = book.pages.length + 1;
  const done = (book.coverImage ? 1 : 0) + book.pages.filter((p) => p.image).length;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!book.coverImage) {
          const r = await illustrate(book, book.coverScene, book.title);
          if (cancelled) return;
          update((b) => ({ ...b, coverImage: r.image, coverImageIsDummy: r.dummy }));
        }
        // 2枚ずつ並べて描く
        const todo = book.pages.map((p, i) => ({ p, i })).filter(({ p }) => !p.image);
        for (let k = 0; k < todo.length; k += 2) {
          await Promise.all(todo.slice(k, k + 2).map(async ({ p, i }) => {
            const r = await illustrate(book, p.scene, p.text);
            if (cancelled) return;
            update((b) => ({ ...b, pages: b.pages.map((q, j) => (j === i ? { ...q, image: r.image, imageIsDummy: r.dummy } : q)) }));
          }));
          if (cancelled) return;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "うまくいきませんでした");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いたときに1回だけ動かす
  }, [book.id, attempt]);

  return (
    <section className="card">
      <h1>「{book.title}」</h1>
      <p className="lead">
        {done < total ? `絵をかいています… ${done} / ${total}` : "できあがりました!"}
      </p>
      <progress className="progress" value={done} max={total} />
      {error && (
        <p className="error">
          {error} <button className="btn small" onClick={() => { setError(""); setAttempt((a) => a + 1); }}>もう一度</button>
        </p>
      )}
      <div className="grid">
        <figure className={`thumb ${book.coverImage ? "" : "wait"}`}>
          {book.coverImage ? <img src={book.coverImage} alt="表紙" /> : <span className="spinner" />}
          <figcaption>表紙</figcaption>
        </figure>
        {book.pages.map((p, i) => (
          <figure key={i} className={`thumb ${p.image ? "" : "wait"}`}>
            {p.image ? <img src={p.image} alt="" /> : <span className="spinner" />}
            <figcaption>{i + 1}. {p.text}</figcaption>
          </figure>
        ))}
      </div>
      <button className="btn primary huge" disabled={done < total} onClick={onNext}>いっしょに読んでみる</button>
    </section>
  );
}

/* ---------- 3. よみあわせ・てなおし ---------- */
function ReviewStep({ book, update, onNext }: { book: Book; update: (fn: (b: Book) => Book) => void; onNext: () => void }) {
  const [i, setI] = useState(0);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState<"" | "fix" | "redraw">("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const page = book.pages[i];
  const { supported, listening, toggle } = useSpeech((t) => setRequest((r) => r + t));

  const setPage = (patch: Partial<Book["pages"][number]>) =>
    update((b) => ({ ...b, pages: b.pages.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));

  async function fix() {
    setBusy("fix");
    setError("");
    try {
      const r = await postJson<{ text: string; scene: string; redrawImage: boolean }>("/api/revise", {
        title: book.title, characterSheet: book.characterSheet,
        pages: book.pages.map((p) => ({ text: p.text })), index: i,
        current: { text: page.text, scene: page.scene }, request,
      });
      setPage({ text: r.text, scene: r.scene });
      if (r.redrawImage) {
        const img = await illustrate(book, r.scene, r.text, request);
        setPage({ text: r.text, scene: r.scene, image: img.image, imageIsDummy: img.dummy });
      }
      setRequest("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy("");
    }
  }

  async function redraw() {
    setBusy("redraw");
    setError("");
    try {
      const img = await illustrate(book, page.scene, page.text);
      setPage({ image: img.image, imageIsDummy: img.dummy });
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy("");
    }
  }

  const go = (d: number) => { setI((x) => Math.min(book.pages.length - 1, Math.max(0, x + d))); setEditing(false); setRequest(""); setError(""); };

  return (
    <section className="card wide">
      <div className="pagehead">
        <h1>よみあわせ・てなおし</h1>
        <span className="pagenum">{i + 1} / {book.pages.length} ページ</span>
      </div>
      <div className="spread">
        <div className="spread-img">
          {page.image && <img src={page.image} alt="" />}
          {busy && <div className="overlay"><span className="spinner" />{busy === "fix" ? "なおしています…" : "絵をかきなおしています…"}</div>}
        </div>
        {editing ? (
          <textarea className="input spread-text-edit" value={page.text} onChange={(e) => setPage({ text: e.target.value })} rows={3} autoFocus />
        ) : (
          <p className="spread-text">{page.text}</p>
        )}
      </div>

      <div className="nav">
        <button className="btn big" disabled={i === 0} onClick={() => go(-1)}>◀ まえ</button>
        <button className="btn big" disabled={i === book.pages.length - 1} onClick={() => go(1)}>つぎ ▶</button>
      </div>

      <div className="fixbox">
        <span className="label">このページを なおしたいとき</span>
        <span className="hint">例:「もっとやさしい色に」「ねこも出して」「文章をみじかく」</span>
        <span className="row">
          <input className="input" value={request} onChange={(e) => setRequest(e.target.value)} placeholder="なおしたいことを入れてください" />
          {supported && <button className={`btn mic ${listening ? "on" : ""}`} onClick={toggle}>{listening ? "■ とめる" : "🎤 話す"}</button>}
        </span>
        <div className="row wrap">
          <button className="btn primary big" disabled={!request.trim() || !!busy} onClick={fix}>AIになおしてもらう</button>
          <button className="btn big" disabled={!!busy} onClick={redraw}>絵だけ かきなおす</button>
          <button className="btn big" disabled={!!busy} onClick={() => setEditing((e) => !e)}>{editing ? "書きかえ おわり" : "文章を 自分で書きかえる"}</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <button className="btn primary huge" onClick={onNext}>ぜんぶ読めたら、表紙へ</button>
    </section>
  );
}

/* ---------- 4. 表紙と贈る言葉 ---------- */
function CoverStep({ book, update, onNext }: { book: Book; update: (fn: (b: Book) => Book) => void; onNext: () => void }) {
  const [busy, setBusy] = useState(false);
  const setMemo = (k: keyof Memo) => (v: string) => update((b) => ({ ...b, memo: { ...b.memo, [k]: v } }));
  return (
    <section className="card wide">
      <h1>表紙と 贈る言葉</h1>
      <div className="cover-layout">
        <div className="cover-preview">
          {book.coverImage && <img src={book.coverImage} alt="表紙" />}
          <div className="cover-title">{book.title}</div>
          {book.memo.from && <div className="cover-from">{book.memo.from} より</div>}
          {busy && <div className="overlay"><span className="spinner" />かいています…</div>}
        </div>
        <div>
          <VoiceField label="タイトル" hint="" value={book.title} onChange={(v) => update((b) => ({ ...b, title: v }))} />
          <div className="two">
            <VoiceField label="だれから?" hint="" value={book.memo.from} onChange={setMemo("from")} />
            <VoiceField label="だれへ?" hint="" value={book.memo.to} onChange={setMemo("to")} />
          </div>
          <VoiceField label="最後のページの言葉" hint="絵本のおわりに大きくのります" value={book.memo.message} onChange={setMemo("message")} multiline />
          <button className="btn big" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await illustrate(book, book.coverScene, book.title);
              update((b) => ({ ...b, coverImage: r.image, coverImageIsDummy: r.dummy }));
            } finally { setBusy(false); }
          }}>表紙の絵を かきなおす</button>
        </div>
      </div>
      <button className="btn primary huge" onClick={onNext}>印刷用データをつくる</button>
    </section>
  );
}

/* ---------- 5. 印刷用PDF ---------- */
function PrintStep({ book, onBack }: { book: Book; onBack: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [spec, setSpec] = useState("");
  const dummyCount = book.pages.filter((p) => p.imageIsDummy).length + (book.coverImageIsDummy ? 1 : 0);
  const totalPages = book.pages.length + EXTRA_PAGES;

  useEffect(() => { import("@/lib/pdf").then((m) => setSpec(m.PDF_SPEC)); }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function make() {
    setBusy(true);
    setError("");
    try {
      const { buildBookPdf } = await import("@/lib/pdf");
      const bytes = await buildBookPdf(book);
      setUrl(URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" })));
    } catch (e) {
      console.error(e);
      setError("PDFをつくれませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h1>印刷用データ</h1>
      <p className="lead">「{book.title}」 全{totalPages}ページ</p>
      <ul className="speclist">
        <li>大きさ: {spec}</li>
        <li>ページ: 表紙 → 最初のページ → おはなし{book.pages.length}ページ → メッセージ → うら表紙</li>
        <li>このPDFを、そのまま印刷業者さんに渡してください。</li>
      </ul>
      {dummyCount > 0 && <p className="warn">まだ「おためしの絵」が {dummyCount} 枚あります。画像AIを設定すると本番の絵になります。</p>}
      {error && <p className="error">{error}</p>}
      {!url ? (
        <button className="btn primary huge" disabled={busy} onClick={make}>{busy ? "PDFをつくっています…" : "PDFをつくる"}</button>
      ) : (
        <>
          <a className="btn primary huge" href={url} download={`${book.title}.pdf`}>PDFをダウンロード</a>
          <iframe className="pdfview" src={url} title="PDFの見本" />
        </>
      )}
      <button className="btn big ghost" onClick={onBack}>もう一度読みなおす</button>
    </section>
  );
}
