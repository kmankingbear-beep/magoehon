"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { illustrate, illustrateCharacters, newId, postJson } from "@/lib/client";
import { deleteBook, listBooks, saveBook } from "@/lib/store";
import {
  ART_STYLES, EXTRA_PAGES, STORY_PAGE_OPTIONS,
  type Book, type Memo, type ServerStatus, type StoryResult,
} from "@/lib/types";
import { useSpeech } from "./useSpeech";
import ChatStep from "./ChatStep";
import SheetEditor, { SheetCanvas } from "./SheetEditor";
import { ensureDesigns } from "@/lib/design";

type Step = "home" | "chat" | "memo" | "generate" | "review" | "cover" | "print";
const STEPS: { id: Step; label: string }[] = [
  { id: "chat", label: "AIとおしゃべり" },
  { id: "memo", label: "絵本のしたく" },
  { id: "generate", label: "AIがつくる" },
  { id: "review", label: "かざりつけ" },
  { id: "cover", label: "表紙と言葉" },
  { id: "print", label: "印刷用データ" },
];

const EMPTY_MEMO: Memo = { hero: "", adventure: "", message: "", from: "", to: "" };

export default function Studio() {
  const [step, setStep] = useState<Step>("home");
  const [book, setBook] = useState<Book | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [chatMemo, setChatMemo] = useState<Memo | null>(null);

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
            onNew={() => { setBook(null); setChatMemo(null); setStep("chat"); }}
            onOpen={(b) => { setBook(ensureDesigns(b)); setStep("review"); }}
          />
        )}
        {step === "chat" && (
          <ChatStep
            onDone={(m) => { setChatMemo(m); setStep("memo"); }}
            onTypeInstead={(m) => { setChatMemo(m); setStep("memo"); }}
          />
        )}
        {step === "memo" && (
          <MemoStep
            initial={book}
            initialMemo={chatMemo}
            onDone={(b) => { const nb = ensureDesigns(b); setBook(nb); void saveBook(nb); setStep("generate"); }}
          />
        )}
        {step === "generate" && book && <GenerateStep book={book} update={update} onNext={() => setStep("review")} />}
        {step === "review" && book && <SheetEditor book={book} update={update} onNext={() => setStep("cover")} />}
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
          <button disabled={!onJump || s.id === "generate" || s.id === "chat" || i > idx} onClick={() => onJump?.(s.id)}>
            <span className="num">{i + 1}</span>
            <span className="label-text">{s.label}</span>
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

function MemoStep({ initial, initialMemo, onDone }: { initial: Book | null; initialMemo: Memo | null; onDone: (b: Book) => void }) {
  const [memo, setMemo] = useState<Memo>({ ...EMPTY_MEMO, ...(initial?.memo ?? {}), ...(initialMemo ?? {}) });
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
        artDirection: story.artDirection,
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
      <h1>{initialMemo ? "おはなしの まとめ" : "おはなしを きかせてください"}</h1>
      <p className="lead">{initialMemo ? "AIが まとめました。ちがうところは なおせます。" : "3つだけ教えてください。🎤 を押すと声で入力できます。"}</p>
      <VoiceField label="① 主人公はだれ?" hint="お孫さんの名前や、好きな動物など" placeholder="例: はるとくんと、いぬのポチ"
        value={memo.hero} onChange={set("hero")} />
      <VoiceField label="② どんなおはなし?" hint="冒険、思い出、好きなことなど" placeholder="例: うみへ さかなを つりにいく"
        value={memo.adventure} onChange={set("adventure")} multiline />
      <VoiceField label="③ 最後に伝えたい言葉" hint="お孫さんへのメッセージ" placeholder="例: げんきに おおきくなってね"
        value={memo.message} onChange={set("message")} multiline />
      {(memo.notes || initialMemo) && (
        <VoiceField label="思い出・好きなもの" hint="物語の中に とりいれます" value={memo.notes ?? ""} onChange={set("notes")} multiline />
      )}
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
function Candidates({ list, chosen, onChoose }: { list?: string[]; chosen?: string; onChoose: (img: string) => void }) {
  if (!list || list.length < 2) return chosen ? <img src={chosen} alt="" /> : <span className="spinner" />;
  return (
    <div className="cands">
      {list.map((c, k) => (
        <button key={k} className={`cand ${c === chosen ? "on" : ""}`} onClick={() => onChoose(c)} aria-label={`${k + 1}まいめ`}>
          <img src={c} alt="" />
          {c === chosen && <span className="cand-check">✓</span>}
        </button>
      ))}
    </div>
  );
}

function GenerateStep({ book, update, onNext }: { book: Book; update: (fn: (b: Book) => Book) => void; onNext: () => void }) {
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [charBusy, setCharBusy] = useState(false);
  const [charReq, setCharReq] = useState("");
  // すでに絵があれば、設定画の確認はすんでいる
  const [charOk, setCharOk] = useState(Boolean(book.coverImage || book.pages.some((p) => p.image)));
  const total = book.pages.length + 1;
  const done = (book.coverImage ? 1 : 0) + book.pages.filter((p) => p.image).length;

  async function drawChara(extra = "") {
    setCharBusy(true);
    setError("");
    try {
      const r = await illustrateCharacters(book, extra);
      update((b) => ({ ...b, characterImage: r.images[0], characterImageIsDummy: r.dummy }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setCharBusy(false);
    }
  }

  const charaStarted = useRef(false);
  useEffect(() => {
    // 開いたときに1回だけ、設定画をかく
    if (charaStarted.current || book.characterImage) return;
    charaStarted.current = true;
    void drawChara();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  useEffect(() => {
    if (!charOk) return;
    let cancelled = false;
    (async () => {
      try {
        // 表紙と各ページ。1場面2枚ずつ、2場面ずつ並べて描く
        const jobs: (() => Promise<void>)[] = [];
        if (!book.coverImage) {
          jobs.push(async () => {
            const r = await illustrate(book, book.coverScene, book.title);
            if (!cancelled) update((b) => ({ ...b, coverCandidates: r.images, coverImage: r.images[0], coverImageIsDummy: r.dummy }));
          });
        }
        book.pages.forEach((p, i) => {
          if (p.image) return;
          jobs.push(async () => {
            const r = await illustrate(book, p.scene, p.text);
            if (!cancelled) update((b) => ({ ...b, pages: b.pages.map((q, j) => (j === i ? { ...q, candidates: r.images, image: r.images[0], imageIsDummy: r.dummy } : q)) }));
          });
        });
        for (let k = 0; k < jobs.length && !cancelled; k += 2) await Promise.all(jobs.slice(k, k + 2).map((j) => j()));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "うまくいきませんでした");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 設定画を決めたあと1回だけ
  }, [book.id, charOk, attempt]);

  if (!charOk) {
    return (
      <section className="card">
        <h1>主人公たちを かきました</h1>
        <p className="lead">この絵を見本にして、ぜんぶのページを かきます。</p>
        <div className="chara">
          {book.characterImage ? <img src={book.characterImage} alt="登場人物" /> : <span className="spinner" />}
          {charBusy && <div className="overlay"><span className="spinner" />かいています…</div>}
        </div>
        {error && <p className="error">{error}</p>}
        <span className="row">
          <input className="input" value={charReq} onChange={(e) => setCharReq(e.target.value)} placeholder="なおしたいこと(例: ぼうしを かぶせて、犬は しろい色)" />
          <button className="btn big" disabled={charBusy} onClick={() => drawChara(charReq)}>かきなおす</button>
        </span>
        <button className="btn primary huge" disabled={charBusy || !book.characterImage} onClick={() => setCharOk(true)}>この主人公で 絵本をかく</button>
      </section>
    );
  }

  return (
    <section className="card wide">
      <h1>「{book.title}」</h1>
      <p className="lead">
        {done < total ? `絵をかいています… ${done} / ${total}` : "できあがりました! 1つの場面に2まい かきました。すきなほうを えらんでください。"}
      </p>
      <progress className="progress" value={done} max={total} />
      {error && (
        <p className="error">
          {error} <button className="btn small" onClick={() => { setError(""); setAttempt((a) => a + 1); }}>もう一度</button>
        </p>
      )}
      <div className="grid wide-grid">
        <figure className={`thumb ${book.coverImage ? "" : "wait"}`}>
          <Candidates list={book.coverCandidates} chosen={book.coverImage} onChoose={(c) => update((b) => ({ ...b, coverImage: c }))} />
          <figcaption>表紙</figcaption>
        </figure>
        {book.pages.map((p, i) => (
          <figure key={i} className={`thumb ${p.image ? "" : "wait"}`}>
            <Candidates list={p.candidates} chosen={p.image}
              onChoose={(c) => update((b) => ({ ...b, pages: b.pages.map((q, j) => (j === i ? { ...q, image: c } : q)) }))} />
            <figcaption>{i + 1}. {p.text}</figcaption>
          </figure>
        ))}
      </div>
      <button className="btn primary huge" disabled={done < total} onClick={onNext}>いっしょに読んでみる</button>
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
          <SheetCanvas book={book} refKey={{ kind: "cover" }} pxPerMm={4} className="stage-canvas" />
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
              const r = await illustrate(book, book.coverScene, book.title, "", 1);
              update((b) => ({ ...b, coverImage: r.images[0], coverImageIsDummy: r.dummy }));
            } finally { setBusy(false); }
          }}>表紙の絵を かきなおす</button>
        </div>
      </div>
      <p className="hint">文字の場所や かざりは、まえの「かざりつけ」で かえられます。</p>
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
  const [prog, setProg] = useState("");
  const dummyCount = book.pages.filter((p) => p.imageIsDummy).length + (book.coverImageIsDummy ? 1 : 0);
  const totalPages = book.pages.length + EXTRA_PAGES;

  useEffect(() => { import("@/lib/pdf").then((m) => setSpec(m.PDF_SPEC)); }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function make() {
    setBusy(true);
    setError("");
    try {
      const { buildBookPdf } = await import("@/lib/pdf");
      const bytes = await buildBookPdf(book, (d, t) => setProg(` ${d} / ${t}`));
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
        <button className="btn primary huge" disabled={busy} onClick={make}>{busy ? `PDFをつくっています…${prog}` : "PDFをつくる"}</button>
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
