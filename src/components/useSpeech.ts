"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

/** ブラウザの音声入力(Chrome / Safari)。使えない端末では supported=false */
export function useSpeech(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onText);
  useEffect(() => {
    cb.current = onText;
  }, [onText]);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ブラウザ機能の検出
    setSupported(Boolean(Ctor));
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "ja-JP";
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      const text = Array.from(e.results).map((x) => x[0].transcript).join("");
      if (text) cb.current(text);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    return () => r.stop();
  }, []);

  const toggle = useCallback(() => {
    if (!rec.current) return;
    if (listening) {
      rec.current.stop();
    } else {
      rec.current.start();
      setListening(true);
    }
  }, [listening]);

  return { supported, listening, toggle };
}
