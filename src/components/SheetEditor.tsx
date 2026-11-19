"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { illustrate, postJson } from "@/lib/client";
import {
  applyLayout, getSheet, listSheets, newFreeBox, resolveText, sameRef, setSheet, sheetImage, type SheetRef,
} from "@/lib/design";
import { BLEED_MM, DRAW_H, DRAW_W, PAGE_H_MM, PAGE_W_MM, TRIM_H_MM, TRIM_W_MM, renderSheet, type BoxRect } from "@/lib/render";
import {
  BG_COLORS, IMAGE_LAYOUTS, TEXT_COLORS, TEXT_DECORS,
  type Book, type ImageLayout, type Sheet, type TextBox,
} from "@/lib/types";
import { useSpeech } from "./useSpeech";

type Update = (fn: (b: Book) => Book) => void;
type Tool = "fix" | "layout" | "text" | "draw";

/* ---------- ページを描く canvas ---------- */
export function SheetCanvas(props: {
  book: Book; refKey: SheetRef; pxPerMm: number; skipDrawing?: boolean;
  onRects?: (r: BoxRect[]) => void; className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { book, refKey, pxPerMm, skipDrawing, onRects } = props;
  // このページに関係するデータが変わったときだけ描きなおす
  const sig = JSON.stringify([
    getSheet(book, refKey), sheetImage(book, refKey)?.length, sheetImage(book, refKey)?.slice(-40),
    book.title, book.memo, refKey.kind === "page" ? book.pages[refKey.index]?.text : "", skipDrawing, pxPerMm,
  ]);
  useEffect(() => {
    let alive = true;
    const off = document.createElement("canvas");
    renderSheet(off, book, refKey, { pxPerMm, bleed: false, skipDrawing }).then((rects) => {
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
    setCur(s.ref);
    setSelected(null);
    setDraft(null);
    if (tool === "fix" && s.ref.kind !== "page" && s.ref.kind !== "cover") setTool("layout");
  };

  /* ドラッグで文字を動かす・のばす */
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; mode: "move" | "len"; sx: number; sy: number; box: TextBox; base: Sheet } | null>(null);
  const onBoxDown = (e: React.PointerEvent, id: string, mode: "move" | "len") => {
    if (tool === "draw") return;
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
          className={`stage ${tool === "draw" ? "drawing" : ""}`}
          ref={stage}
          onPointerDown={() => tool !== "draw" && setSelected(null)}
        >
          <SheetCanvas book={shown} refKey={cur} pxPerMm={6} onRects={setRects} skipDrawing={tool === "draw"} className="stage-canvas" />
          {tool === "draw" && editable && (
            <DrawLayer key={JSON.stringify(cur)} initial={sheet.drawing} onChange={(png) => commit({ ...getSheet(book, cur), drawing: png })} />
          )}
          {tool !== "draw" && editable && rects.map((r) => {
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
            <button className={`tab ${tool === "layout" ? "on" : ""}`} onClick={() => setTool("layout")}>🖼 ならべかた</button>
            <button className={`tab ${tool === "text" ? "on" : ""}`} onClick={() => setTool("text")}>✏️ もじ</button>
            <button className={`tab ${tool === "draw" ? "on" : ""}`} onClick={() => { setTool("draw"); setSelected(null); }}>🖍 おえかき</button>
          </div>
          <div className="panel">
            {tool === "fix" && <FixPanel book={book} cur={cur} update={update} />}
            {tool === "layout" && (
              <LayoutPanel sheet={sheet} hasImage={Boolean(sheetImage(book, cur))} onChange={commit} />
            )}
            {tool === "text" && (
              <TextPanel
                book={book} cur={cur} sheet={sheet} box={selBox} update={update}
                onPatch={(p) => selBox && patchBox(selBox.id, p)}
                onAdd={() => { const nb = newFreeBox(); commit({ ...sheet, texts: [...sheet.texts, nb] }); setSelected(nb.id); }}
                onRemove={() => { if (!selBox) return; commit({ ...sheet, texts: sheet.texts.filter((t) => t.id !== selBox.id) }); setSelected(null); }}
              />
            )}
            {tool === "draw" && <p className="hint">ページの上を 指やペンで なぞってください。</p>}
            {tool === "draw" && <div id="drawtools-slot" />}
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

function LayoutPanel({ sheet, hasImage, onChange }: { sheet: Sheet; hasImage: boolean; onChange: (s: Sheet) => void }) {
  return (
    <div className="panel-body">
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
  onPatch: (p: Partial<TextBox>) => void; onAdd: () => void; onRemove: () => void;
}) {
  const { book, cur, box, update, onPatch } = props;
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
          <div className="row wrap">
            <button className="btn big" onClick={() => onPatch({ size: Math.max(3, box.size - 0.75) })}>ちいさく</button>
            <button className="btn big" onClick={() => onPatch({ size: Math.min(22, box.size + 0.75) })}>おおきく</button>
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

/* ---------- おえかき ---------- */
const PEN_COLORS = ["#3d3027", "#ffffff", "#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#8e24aa", "#f06292", "#8d6e63"];
const STAMPS = ["❤️", "⭐", "🌸", "🌈", "☀️", "🌙", "🐟", "🍙", "🎈", "🐶", "🐱", "🍀"];
const WIDTHS = [{ v: 8, l: "ほそい" }, { v: 18, l: "ふつう" }, { v: 36, l: "ふとい" }];

function DrawLayer({ initial, onChange }: { initial?: string; onChange: (png: string | undefined) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(PEN_COLORS[2]);
  const [width, setWidth] = useState(18);
  const [mode, setMode] = useState<"pen" | "eraser" | "stamp">("pen");
  const [stamp, setStamp] = useState(STAMPS[0]);
  const [stampSize, setStampSize] = useState(120);
  const history = useRef<string[]>([]);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [histLen, setHistLen] = useState(0);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- どうぐを置く場所(下のパネル)を探す
    setSlot(document.getElementById("drawtools-slot"));
  }, []);

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (initial) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
      img.src = initial;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いたときだけ読みこむ
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * DRAW_W, y: ((e.clientY - r.top) / r.height) * DRAW_H };
  };
  const save = () => {
    const c = canvas.current!;
    onChange(c.toDataURL("image/png"));
  };
  const remember = () => {
    history.current.push(canvas.current!.toDataURL("image/png"));
    if (history.current.length > 20) history.current.shift();
    setHistLen(history.current.length);
  };

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    remember();
    const ctx = canvas.current!.getContext("2d")!;
    const p = pos(e);
    if (mode === "stamp") {
      ctx.globalCompositeOperation = "source-over";
      ctx.font = `${stampSize}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(stamp, p.x, p.y);
      save();
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    last.current = p;
    ctx.globalCompositeOperation = mode === "eraser" ? "destination-out" : "source-over";
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (mode === "eraser" ? width * 2 : width) / 2, 0, Math.PI * 2);
    ctx.fill();
  };
  const move = (e: React.PointerEvent) => {
    if (!last.current) return;
    const ctx = canvas.current!.getContext("2d")!;
    const p = pos(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = mode === "eraser" ? width * 2 : width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const up = () => {
    if (!last.current) return;
    last.current = null;
    save();
  };
  const undo = () => {
    const prev = history.current.pop();
    if (prev === undefined) return;
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const img = new Image();
    img.onload = () => {
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      save();
    };
    img.src = prev;
    setHistLen(history.current.length);
  };
  const clear = () => {
    if (!confirm("かいた絵を ぜんぶ けしますか?")) return;
    remember();
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    onChange(undefined);
  };

  // 手描きの層は塗り足しまでの大きさ。画面では仕上がりの外にはみ出す分を隠す
  const bx = (BLEED_MM / TRIM_W_MM) * 100;
  const by = (BLEED_MM / TRIM_H_MM) * 100;
  return (
    <>
      <canvas
        ref={canvas}
        width={DRAW_W}
        height={DRAW_H}
        className="draw-canvas"
        style={{ left: `-${bx}%`, top: `-${by}%`, width: `${(PAGE_W_MM / TRIM_W_MM) * 100}%`, height: `${(PAGE_H_MM / TRIM_H_MM) * 100}%` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      {slot && createPortal(<div className="drawtools">
        <div className="row wrap">
          <button className={`btn big ${mode === "pen" ? "pressed" : ""}`} onClick={() => setMode("pen")}>🖍 ペン</button>
          <button className={`btn big ${mode === "stamp" ? "pressed" : ""}`} onClick={() => setMode("stamp")}>⭐ スタンプ</button>
          <button className={`btn big ${mode === "eraser" ? "pressed" : ""}`} onClick={() => setMode("eraser")}>🧽 けしゴム</button>
          <button className="btn big" disabled={histLen === 0} onClick={undo}>↩ ひとつ もどす</button>
          <button className="btn big ghost" onClick={clear}>ぜんぶ けす</button>
        </div>
        {mode !== "stamp" ? (
          <>
            {mode === "pen" && (
              <div className="swatches">
                {PEN_COLORS.map((c) => (
                  <button key={c} className={`swatch ${color === c ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
                ))}
              </div>
            )}
            <div className="choices">
              {WIDTHS.map((w) => (
                <button key={w.v} className={`choice ${width === w.v ? "on" : ""}`} onClick={() => setWidth(w.v)}>
                  <span className="dot" style={{ width: w.v / 2 + 4, height: w.v / 2 + 4 }} />{w.l}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="stamps">
              {STAMPS.map((s) => (
                <button key={s} className={`stamp ${stamp === s ? "on" : ""}`} onClick={() => setStamp(s)}>{s}</button>
              ))}
            </div>
            <div className="choices">
              {[{ v: 70, l: "ちいさい" }, { v: 120, l: "ふつう" }, { v: 220, l: "おおきい" }].map((w) => (
                <button key={w.v} className={`choice ${stampSize === w.v ? "on" : ""}`} onClick={() => setStampSize(w.v)}>{w.l}</button>
              ))}
            </div>
            <p className="hint">ページの 好きなところを タップすると スタンプが おせます。</p>
          </>
        )}
      </div>, slot)}
    </>
  );
}
