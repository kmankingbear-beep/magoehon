"use client";
import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/client";
import type { ChatMessage, ChatTurn, Memo } from "@/lib/types";
import { useSpeech } from "./useSpeech";
import { useVoice } from "./useVoice";

const EMPTY: Memo = { hero: "", adventure: "", message: "", from: "", to: "", notes: "" };

const FIELDS: { key: keyof Memo; label: string }[] = [
  { key: "to", label: "だれへ" },
  { key: "from", label: "だれから" },
  { key: "hero", label: "主人公" },
  { key: "adventure", label: "おはなし" },
  { key: "message", label: "伝えたい言葉" },
  { key: "notes", label: "思い出" },
];

/** AIとおしゃべりしながら、絵本のもとになる話を聞き出す */
export default function ChatStep({ initial, onDone, onTypeInstead }: {
  initial?: Memo; onDone: (memo: Memo) => void; onTypeInstead: (memo: Memo) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [memo, setMemo] = useState<Memo>(initial ?? EMPTY);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const voice = useVoice();
  const log = useRef<HTMLDivElement>(null);

  async function ask(history: ChatMessage[]) {
    setBusy(true);
    setError("");
    try {
      const r = await postJson<ChatTurn>("/api/chat", { history });
      setMessages([...history, { role: "assistant", text: r.reply }]);
      setMemo((m) => ({ ...m, ...Object.fromEntries(Object.entries(r.memo).filter(([, v]) => v)) }));
      setReady(r.ready);
      voice.speak(r.reply);
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
      setMessages(history);
    } finally {
      setBusy(false);
    }
  }

  function answer(t: string) {
    const v = t.trim();
    if (!v || busy) return;
    voice.stop();
    setText("");
    void ask([...messages, { role: "user", text: v }]);
  }

  const mic = useSpeech(answer);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // はじめに1回だけ、AIから話しかける
    void ask([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  function undo() {
    // さいごの自分の返事と、それへのAIの返事を取り消す
    const i = messages.map((m) => m.role).lastIndexOf("user");
    if (i < 0) return;
    voice.stop();
    setMessages(messages.slice(0, i));
    setReady(false);
  }

  const last = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <section className="card wide chat">
      <div className="pagehead">
        <h1>AIと おしゃべり</h1>
        {voice.supported && (
          <button className={`btn small ${voice.enabled ? "pressed" : ""}`} onClick={() => { voice.stop(); voice.setEnabled(!voice.enabled); }}>
            {voice.enabled ? "🔊 声で読む: オン" : "🔇 声で読む: オフ"}
          </button>
        )}
      </div>

      <div className="chat-grid">
        <div className="chat-main">
          <div className="chat-log" ref={log}>
            {messages.map((m, i) => (
              <div key={i} className={`bubble-row ${m.role}`}>
                {m.role === "assistant" && <span className="avatar" aria-hidden>🧸</span>}
                <p className="bubble">{m.text}</p>
              </div>
            ))}
            {busy && (
              <div className="bubble-row assistant">
                <span className="avatar" aria-hidden>🧸</span>
                <p className="bubble typing"><span>●</span><span>●</span><span>●</span></p>
              </div>
            )}
          </div>

          {error && <p className="error">{error}</p>}

          <div className="chat-input">
            {mic.supported && (
              <button className={`btn mic-huge ${mic.listening ? "on" : ""}`} disabled={busy} onClick={() => { voice.stop(); mic.toggle(); }}>
                {mic.listening ? "■ 聞いています… (おわったら おす)" : "🎤 おはなしする"}
              </button>
            )}
            <form className="row" onSubmit={(e) => { e.preventDefault(); answer(text); }}>
              <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="文字で こたえることも できます" />
              <button className="btn big" disabled={!text.trim() || busy}>おくる</button>
            </form>
            <div className="row wrap">
              {last && voice.supported && <button className="btn small" onClick={() => voice.speak(last.text)}>🔁 もう一度 きく</button>}
              <button className="btn small" disabled={busy || !messages.some((m) => m.role === "user")} onClick={undo}>↩ ひとつ前に もどる</button>
            </div>
          </div>
        </div>

        <aside className="chat-memo">
          <span className="label">わかったこと</span>
          <dl>
            {FIELDS.map((f) => (
              <div key={f.key} className={memo[f.key] ? "got" : ""}>
                <dt>{memo[f.key] ? "✓" : "・"} {f.label}</dt>
                <dd>{memo[f.key] || "まだ"}</dd>
              </div>
            ))}
          </dl>
          <button className="btn small ghost" onClick={() => onTypeInstead(memo)}>文字で 入力する</button>
        </aside>
      </div>

      <button className={`btn primary huge ${ready ? "glow" : ""}`} disabled={!(memo.hero && memo.adventure && memo.message) || busy} onClick={() => { voice.stop(); onDone(memo); }}>
        このおはなしで 絵本をつくる
      </button>
    </section>
  );
}
