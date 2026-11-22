"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { illustrate, postJson } from "@/lib/client";
import {
  IMAGE_SIZE_MAX, IMAGE_SIZE_MIN, applyImageSize, applyLayout, getSheet, imageRect, imageSizeOf, listSheets, newFreeBox,
  resolveText, sameRef, setSheet, sheetImage, type SheetRef,
} from "@/lib/design";
import { renderSheet, type BoxRect } from "@/lib/render";
import {
  BG_COLORS, IMAGE_LAYOUTS, TEXT_COLORS, TEXT_DECORS,
  type Book, type ImageLayout, type Sheet, type TextBox,
} from "@/lib/types";
import { useSpeech } from "./useSpeech";

type Update = (fn: (b: Book) => Book) => void;
type Tool = "fix" | "layout" | "text";

/** 文字の大きさ(mm)の はんい */
const TEXT_MIN = 3;
const TEXT_MAX = 22;

/* ---------- ページを描く canvas ---------- */
export function SheetCanvas(props: {
  book: Book; refKey: SheetRef; pxPerMm: number;
  onRects?: (r: BoxRect[]) => void; className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { book, refKey, pxPerMm, onRects } = props;
  // このページに関係するデータが変わったときだけ描きなおす
  const sig = JSON.stringify([
    getSheet(book, refKey), sheetImage(book, refKey)?.length, sheetImage(book, refKey)?.slice(-40),
    book.title, book.memo, refKey.kind === "page" ? book.pages[refKey.index]?.text : "", pxPerMm,
  ]);
  useEffect(() => {
    let alive = true;
    const off = document.createElement("canvas");
    renderSheet(off, book, refKey, { pxPerMm, bleed: false }).then((rects) => {
      if (!alive || !ref.current) return;
      const c = ref.current;
      c.width = off.width;
      c.height = off.height;
      c.getContext("2d")!.drawImage(off, 0, 0);
      onRects?.(rects);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sig にまとめている
  }, [sig]);
  return <canvas ref={ref} className={props.className} />;
}

/* ---------- 編集画面 ---------- */
export default function SheetEditor({ book, update, onNext }: { book: Book; update: Update; onNext: () => void }) {
  const sheets = useMemo(() => listSheets(book), [book]);
  const [cur, setCur] = useState<SheetRef>({ kind: "page", index: 0 });
  const [tool, setTool] = useState<Tool>("layout");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Sheet | null>(null); // ドラッグ中の一時的なデザイン
  const [rects, setRects] = useState<BoxRect[]>([]);
  const editable = cur.kind !== "back";

  const curIdx = sheets.findIndex((s) => sameRef(s.ref, cur));
  const sheet = draft ?? getSheet(book, cur);
  const shown = draft ? setSheet(book, cur, draft) : book;
  const selBox = sheet.texts.find((t) => t.id === selected) ?? null;

  const commit = useCallback((s: Sheet) => { update((b) => setSheet(b, cur, s)); setDraft(null); }, [cur, update]);
  const patchBox = (id: string, p: Partial<TextBox>) =>
    commit({ ...sheet, texts: sheet.texts.map((t) => (t.id === id ? { ...t, ...p } : t)) });

  const go = (i: number) => {
    const s = sheets[Math.max(0, Math.min(sheets.length - 1, i))];
    if (draft) commit(draft);
    setCur(s.ref);
    setDraft(null);
    let next = tool;
    if (tool === "fix" && s.ref.kind !== "page" && s.ref.kind !== "cover") next = "layout";
    setTool(next);
    // 「もじ」を開いているときは、つぎのページでも さいしょの文字を えらんでおく
    setSelected(next === "text" ? getSheet(book, s.ref).texts[0]?.id ?? null : null);
  };
  const openText = () => {
    setTool("text");
    if (!selected) setSelected(sheet.texts[0]?.id ?? null);
  };
  /** 本文の大きさを 物語の全ページで そろえる */
  const sizeAllBodies = (size: number) => update((b) => ({
    ...b,
    pages: b.pages.map((p) => p.sheet ? { ...p, sheet: { ...p.sheet, texts: p.sheet.texts.map((t) => (t.role === "body" ? { ...t, size } : t)) } } : p),
  }));
  /** 絵の大きさを 物語の全ページで そろえる(ならべ方が同じページだけ) */
  const imageSizeAll = (layout: ImageLayout, size: number) => update((b) => ({
    ...b,
    pages: b.pages.map((p) => p.sheet && p.sheet.imageLayout === layout ? { ...p, sheet: applyImageSize(p.sheet, size, true) } : p),
  }));

  /* 絵の はしの まるい取っ手を ひっぱって 大きさを変える */
  const imgDrag = useRef<{ base: Sheet } | null>(null);
  const imgR = imageRect(sheet);
  const hasImage = Boolean(sheetImage(book, cur)) && imgR !== null;
  const onImgDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    imgDrag.current = { base: sheet };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onImgMove = (e: React.PointerEvent) => {
    const d = imgDrag.current;
    if (!d || !stage.current) return;
    const r = stage.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    const size = {
      top: py, bottom: 1 - py, left: px, right: 1 - px,
      // まんなか よこ・上によせた絵: 右下の取っ手の場所から大きさを出す
      full: Math.max(Math.abs(px - 0.5) * 2, py - Math.min((1 - (imageRect(d.base)?.w ?? 1)) / 2, 0.04)), none: 1,
    }[d.base.imageLayout];
    setDraft(applyImageSize(d.base, size, true));
  };
  const onImgUp = () => {
    if (imgDrag.current && draft) commit(draft);
    imgDrag.current = null;
  };
  const gripPos = imgR && {
    top: { left: 0.5, top: imgR.h }, bottom: { left: 0.5, top: imgR.y }, left: { left: imgR.w, top: 0.5 },
    right: { left: imgR.x, top: 0.5 }, full: { left: imgR.x + imgR.w, top: imgR.y + imgR.h }, none: { left: 0, top: 0 },
  }[sheet.imageLayout];

  /* ドラッグで文字を動かす・のばす */
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; mode: "move" | "len"; sx: number; sy: number; box: TextBox; base: Sheet } | null>(null);
  const onBoxDown = (e: React.PointerEvent, id: string, mode: "move" | "len") => {
    e.stopPropagation();
    e.preventDefault();
    setSelected(id);
    if (tool !== "text") setTool("text");
    const box = sheet.texts.find((t) => t.id === id)!;
    drag.current = { id, mode, sx: e.clientX, sy: e.clientY, box, base: sheet };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onBoxMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !stage.current) return;
    const r = stage.current.getBoundingClientRect();
    const dx = (e.clientX - d.sx) / r.width;
    const dy = (e.clientY - d.sy) / r.height;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    // 仕上がりの外にはみ出さないようにする
    const rect = rects.find((x) => x.id === d.id);
    const offX = rect ? rect.x - d.box.x : 0;
    const offY = rect ? rect.y - d.box.y : 0;
    const w = rect?.w ?? 0.1, h = rect?.h ?? 0.1;
    const next: Partial<TextBox> = d.mode === "move"
      ? { x: clamp(d.box.x + dx, 0.02 - offX, 0.98 - w - offX), y: clamp(d.box.y + dy, 0.02 - offY, 0.98 - h - offY) }
      : { len: clamp(d.box.len + (d.box.vertical ? dy : dx), 0.08, 1) };
    setDraft({ ...d.base, texts: d.base.texts.map((t) => (t.id === d.id ? { ...t, ...next } : t)) });
  };
  const onBoxUp = () => {
    if (drag.current && draft) commit(draft);
    drag.current = null;
  };

  return (
    <section className="card wide editor">
      <div className="pagehead">
        <h1>よみあわせ・かざりつけ</h1>
        <span className="pagenum">{sheets[curIdx]?.label}{cur.kind === "page" ? " ページ" : ""}</span>
      </div>

      <div className="editor-grid">
      <div className="editor-left">
      <div className="stage-wrap">
        <div
          className="stage"
          ref={stage}
          onPointerDown={() => setSelected(null)}
        >
          <SheetCanvas book={shown} refKey={cur} pxPerMm={6} onRects={setRects} className="stage-canvas" />
          {tool === "layout" && editable && hasImage && imgR && gripPos && (
            <>
              <div className="img-frame" style={{ left: `${imgR.x * 100}%`, top: `${imgR.y * 100}%`, width: `${imgR.w * 100}%`, height: `${imgR.h * 100}%` }} />
              <span
                className={`grip img-grip ${sheet.imageLayout}`}
                style={{ left: `${gripPos.left * 100}%`, top: `${gripPos.top * 100}%` }}
                onPointerDown={onImgDown}
                onPointerMove={onImgMove}
                onPointerUp={onImgUp}
                onPointerCancel={onImgUp}
                title="ひっぱって 絵の大きさを かえる"
              />
            </>
          )}
          {editable && rects.map((r) => {
            const t = sheet.texts.find((x) => x.id === r.id);
            if (!t) return null;
            const on = selected === r.id;
            return (
              <div
                key={r.id}
                className={`hit ${on ? "on" : ""}`}
                style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                onPointerDown={(e) => onBoxDown(e, r.id, "move")}
                onPointerMove={onBoxMove}
                onPointerUp={onBoxUp}
              >
                {on && (
                  <span
                    className={`grip ${t.vertical ? "v" : "h"}`}
                    onPointerDown={(e) => onBoxDown(e, r.id, "len")}
                    onPointerMove={onBoxMove}
                    onPointerUp={onBoxUp}
                    title="ひっぱって のばす"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="nav">
        <button className="btn big" disabled={curIdx === 0} onClick={() => go(curIdx - 1)}>◀ まえ</button>
        <button className="btn big" disabled={curIdx === sheets.length - 1} onClick={() => go(curIdx + 1)}>つぎ ▶</button>
      </div>

      <div className="strip">
        {sheets.map((s, i) => (
          <button key={i} className={`strip-item ${i === curIdx ? "on" : ""}`} onClick={() => go(i)}>
            <SheetCanvas book={book} refKey={s.ref} pxPerMm={0.9} className="strip-canvas" />
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      </div>
      <div className="editor-right">
      {editable ? (
        <>
          <div className="tabs" role="tablist">
            {(cur.kind === "page" || cur.kind === "cover") && (
              <button className={`tab ${tool === "fix" ? "on" : ""}`} onClick={() => setTool("fix")}>🪄 AIになおしてもらう</button>
            )}
            <button className={`tab ${tool === "layout" ? "on" : ""}`} onClick={() => { setTool("layout"); setSelected(null); }}>🖼 絵の大きさ・ならべかた</button>
            <button className={`tab ${tool === "text" ? "on" : ""}`} onClick={openText}>✏️ 文字の大きさ・いろ</button>
          </div>
          <div className="panel">
            {tool === "fix" && <FixPanel book={book} cur={cur} update={update} />}
            {tool === "layout" && (
              <LayoutPanel
                sheet={sheet} hasImage={Boolean(sheetImage(book, cur))} onChange={commit} onLive={setDraft}
                onAll={cur.kind === "page" && book.pages.length > 1 ? () => imageSizeAll(sheet.imageLayout, imageSizeOf(sheet)) : undefined}
              />
            )}
            {tool === "text" && (
              <TextPanel
                book={book} cur={cur} sheet={sheet} box={selBox} update={update}
                onPatch={(p) => selBox && patchBox(selBox.id, p)}
                onLive={(p) => selBox && setDraft({ ...sheet, texts: sheet.texts.map((t) => (t.id === selBox.id ? { ...t, ...p } : t)) })}
                onAll={cur.kind === "page" && selBox?.role === "body" && book.pages.length > 1 ? () => sizeAllBodies(selBox.size) : undefined}
                onAdd={() => { const nb = newFreeBox(); commit({ ...sheet, texts: [...sheet.texts, nb] }); setSelected(nb.id); }}
                onRemove={() => { if (!selBox) return; commit({ ...sheet, texts: sheet.texts.filter((t) => t.id !== selBox.id) }); setSelected(null); }}
              />
            )}
          </div>
        </>
      ) : (
        <p className="hint center">うら表紙は 自動でつくられます</p>
      )}
      </div>
      </div>

      <button className="btn primary huge" onClick={onNext}>できたら、表紙と言葉へ</button>
    </section>
  );
}

/* ---------- ならべかた ---------- */
function LayoutIcon({ id }: { id: ImageLayout }) {
  const r = { top: [0, 0, 60, 28], bottom: [0, 12, 60, 28], full: [0, 0, 60, 40], left: [0, 0, 36, 40], right: [24, 0, 36, 40], none: null }[id];
  return (
    <svg viewBox="0 0 60 40" className="licon" aria-hidden>
      <rect x="0" y="0" width="60" height="40" fill="#fffaf0" stroke="#c9b8a4" />
      {r && <rect x={r[0]} y={r[1]} width={r[2]} height={r[3]} fill="#9fd0e8" />}
    </svg>
  );
}

function LayoutPanel({ sheet, hasImage, onChange, onLive, onAll }: {
  sheet: Sheet; hasImage: boolean; onChange: (s: Sheet) => void; onLive: (s: Sheet) => void; onAll?: () => void;
}) {
  const size = imageSizeOf(sheet);
  const pct = Math.round(size * 100);
  const step = 0.05;
  return (
    <div className="panel-body">
      {hasImage && sheet.imageLayout !== "none" && (
        <>
          <span className="label">絵の 大きさ <b className="size-now">{pct}%</b></span>
          <div className="sizer">
            <button className="btn big sizer-btn" disabled={size <= IMAGE_SIZE_MIN} onClick={() => onChange(applyImageSize(sheet, size - step, true))} aria-label="絵を ちいさく">−</button>
            <SizeSlider
              min={IMAGE_SIZE_MIN} max={IMAGE_SIZE_MAX} step={0.01} value={size}
              onLive={(v) => onLive(applyImageSize(sheet, v, true))} onCommit={(v) => onChange(applyImageSize(sheet, v, true))}
              label="絵の大きさ"
            />
            <button className="btn big sizer-btn" disabled={size >= IMAGE_SIZE_MAX} onClick={() => onChange(applyImageSize(sheet, size + step, true))} aria-label="絵を おおきく">+</button>
          </div>
          <p className="hint">ページの上の 絵の はしにある <span className="grip-mark" /> を ゆびで ひっぱっても かえられます。</p>
          {onAll && <button className="btn" onClick={onAll}>ほかのページの 絵も この大きさに そろえる</button>}
        </>
      )}
      {hasImage && (
        <>
          <span className="label">絵の ならべかた</span>
          <div className="choices">
            {IMAGE_LAYOUTS.map((l) => (
              <button key={l.id} className={`choice layout ${sheet.imageLayout === l.id ? "on" : ""}`} onClick={() => onChange(applyLayout(sheet, l.id))}>
                <LayoutIcon id={l.id} />
                {l.label}
              </button>
            ))}
          </div>
        </>
      )}
      <span className="label">紙の いろ</span>
      <div className="swatches">
        {BG_COLORS.map((c) => (
          <button key={c} className={`swatch ${sheet.bg === c ? "on" : ""}`} style={{ background: c }} onClick={() => onChange({ ...sheet, bg: c })} aria-label={c} />
        ))}
      </div>
      <p className="hint">文字は ページの上で ゆびで つかんで 好きな場所に うごかせます。</p>
    </div>
  );
}

/* ---------- もじ ---------- */
function TextPanel(props: {
  book: Book; cur: SheetRef; sheet: Sheet; box: TextBox | null; update: Update;
  onPatch: (p: Partial<TextBox>) => void; onLive: (p: Partial<TextBox>) => void; onAll?: () => void;
  onAdd: () => void; onRemove: () => void;
}) {
  const { book, cur, box, update, onPatch, onLive } = props;
  const { supported, listening, toggle } = useSpeech((t) => box && setText(resolveText(book, cur, box) + t));

  function setText(v: string) {
    if (!box) return;
    switch (box.role) {
      case "body":
        if (cur.kind === "page") update((b) => ({ ...b, pages: b.pages.map((p, i) => (i === cur.index ? { ...p, text: v } : p)) }));
        break;
      case "title": update((b) => ({ ...b, title: v })); break;
      case "from": update((b) => ({ ...b, memo: { ...b.memo, from: v.replace(/\s*より$/, "") } })); break;
      case "to": update((b) => ({ ...b, memo: { ...b.memo, to: v.replace(/\s*へ$/, "") } })); break;
      case "message": update((b) => ({ ...b, memo: { ...b.memo, message: v } })); break;
      case "free": onPatch({ text: v }); break;
    }
  }

  return (
    <div className="panel-body">
      <button className="btn big" onClick={props.onAdd}>💬 ことば・ふきだしを 足す</button>
      {!box ? (
        <p className="hint">ページの上の 文字を タップすると、大きさや 色を かえられます。</p>
      ) : (
        <>
          <span className="row">
            <textarea className="input" rows={2} value={resolveText(book, cur, box)} onChange={(e) => setText(e.target.value)} />
            {supported && <button className={`btn mic ${listening ? "on" : ""}`} onClick={toggle}>{listening ? "■ とめる" : "🎤 話す"}</button>}
          </span>
          <span className="label">文字の 大きさ <span className="size-sample" style={{ fontSize: `${Math.round(box.size * 4)}px` }}>あ</span></span>
          <div className="sizer">
            <button className="btn big sizer-btn" disabled={box.size <= TEXT_MIN} onClick={() => onPatch({ size: Math.max(TEXT_MIN, +(box.size - 0.5).toFixed(2)) })} aria-label="文字を ちいさく">−</button>
            <SizeSlider
              min={TEXT_MIN} max={TEXT_MAX} step={0.25} value={box.size}
              onLive={(v) => onLive({ size: v })} onCommit={(v) => onPatch({ size: v })} label="文字の大きさ"
            />
            <button className="btn big sizer-btn" disabled={box.size >= TEXT_MAX} onClick={() => onPatch({ size: Math.min(TEXT_MAX, +(box.size + 0.5).toFixed(2)) })} aria-label="文字を おおきく">+</button>
          </div>
          {props.onAll && <button className="btn" onClick={props.onAll}>ほかのページの 文章も この大きさに そろえる</button>}
          <div className="row wrap">
            <button className={`btn big ${box.vertical ? "pressed" : ""}`} onClick={() => onPatch({ vertical: !box.vertical, len: box.vertical ? 0.6 : 0.6 })}>
              {box.vertical ? "よこ書きに する" : "たて書きに する"}
            </button>
            <button className={`btn big ${box.bold ? "pressed" : ""}`} onClick={() => onPatch({ bold: !box.bold })}>ふとく</button>
          </div>
          <span className="label">いろ</span>
          <div className="swatches">
            {TEXT_COLORS.map((c) => (
              <button key={c} className={`swatch ${box.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => onPatch({ color: c })} aria-label={c} />
            ))}
          </div>
          <span className="label">かざり</span>
          <div className="choices">
            {TEXT_DECORS.map((d) => (
              <button key={d.id} className={`choice ${box.decor === d.id ? "on" : ""}`} onClick={() => onPatch({ decor: d.id })}>{d.label}</button>
            ))}
          </div>
          {box.role === "free" && <button className="btn big ghost" onClick={props.onRemove}>この ことばを けす</button>}
        </>
      )}
    </div>
  );
}

/* ---------- AIになおしてもらう ---------- */
function FixPanel({ book, cur, update }: { book: Book; cur: SheetRef; update: Update }) {
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { supported, listening, toggle } = useSpeech((t) => setRequest((r) => r + t));

  async function run(kind: "fix" | "redraw") {
    setBusy(true);
    setError("");
    try {
      if (cur.kind === "cover") {
        const r = await illustrate(book, book.coverScene, book.title, request);
        update((b) => ({
          ...b, coverImage: r.images[0], coverImageIsDummy: r.dummy,
          coverCandidates: [...r.images, ...(b.coverCandidates ?? (b.coverImage ? [b.coverImage] : []))].slice(0, 6),
        }));
      } else if (cur.kind === "page") {
        const i = cur.index;
        const page = book.pages[i];
        let text = page.text, scene = page.scene, redraw = true;
        if (kind === "fix") {
          const r = await postJson<{ text: string; scene: string; redrawImage: boolean }>("/api/revise", {
            title: book.title, characterSheet: book.characterSheet,
            pages: book.pages.map((p) => ({ text: p.text })), index: i,
            current: { text: page.text, scene: page.scene }, request,
          });
          ({ text, scene } = r);
          redraw = r.redrawImage;
          update((b) => ({ ...b, pages: b.pages.map((q, j) => (j === i ? { ...q, text, scene } : q)) }));
        }
        if (redraw) {
          const img = await illustrate(book, scene, text, kind === "fix" ? request : "");
          update((b) => ({
            ...b,
            pages: b.pages.map((q, j) => (j === i ? {
              ...q, image: img.images[0], imageIsDummy: img.dummy,
              candidates: [...img.images, ...(q.candidates ?? (q.image ? [q.image] : []))].slice(0, 6),
            } : q)),
          }));
        }
      }
      setRequest("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-body">
      <span className="hint">例:「もっとやさしい色に」「ねこも出して」「文章をみじかく」</span>
      <span className="row">
        <input className="input" value={request} onChange={(e) => setRequest(e.target.value)} placeholder="なおしたいことを入れてください" />
        {supported && <button className={`btn mic ${listening ? "on" : ""}`} onClick={toggle}>{listening ? "■ とめる" : "🎤 話す"}</button>}
      </span>
      <div className="row wrap">
        {cur.kind === "page" && (
          <button className="btn primary big" disabled={!request.trim() || busy} onClick={() => run("fix")}>{busy ? "なおしています…" : "AIになおしてもらう"}</button>
        )}
        <button className="btn big" disabled={busy} onClick={() => run("redraw")}>{busy ? "かいています…" : "絵を かきなおす"}</button>
      </div>
      {error && <p className="error">{error}</p>}
      {(() => {
        const list = cur.kind === "cover" ? book.coverCandidates : cur.kind === "page" ? book.pages[cur.index].candidates : undefined;
        const chosen = cur.kind === "cover" ? book.coverImage : cur.kind === "page" ? book.pages[cur.index].image : undefined;
        if (!list || list.length < 2) return null;
        const choose = (c: string) => update((b) => cur.kind === "cover"
          ? { ...b, coverImage: c }
          : { ...b, pages: b.pages.map((q, j) => (cur.kind === "page" && j === cur.index ? { ...q, image: c } : q)) });
        return (
          <>
            <span className="label">かいた絵から えらぶ</span>
            <div className="cands small">
              {list.map((c, k) => (
                <button key={k} className={`cand ${c === chosen ? "on" : ""}`} onClick={() => choose(c)}>
                  <img src={c} alt="" />
                  {c === chosen && <span className="cand-check">✓</span>}
                </button>
              ))}
            </div>
          </>
        );
      })()}
    </div>
  );
}

/* ---------- 大きさの つまみ ---------- */
/** うごかしている間は 見本だけ かえ(onLive)、指をはなしたら 保存する(onCommit) */
function SizeSlider({ min, max, step, value, onLive, onCommit, label }: {
  min: number; max: number; step: number; value: number; label: string;
  onLive: (v: number) => void; onCommit: (v: number) => void;
}) {
  const [v, setV] = useState<number | null>(null);
  const done = () => {
    if (v !== null) onCommit(v);
    setV(null);
  };
  return (
    <input
      type="range" className="size-slider" min={min} max={max} step={step} value={v ?? value} aria-label={label}
      onChange={(e) => { const n = Number(e.target.value); setV(n); onLive(n); }}
      onPointerUp={done} onKeyUp={done} onBlur={done} onTouchEnd={done}
    />
  );
}
