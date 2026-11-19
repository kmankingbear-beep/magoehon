"use client";
import { useCallback, useEffect, useState } from "react";

/** AIの返事を声で読み上げる(ブラウザの音声合成) */
export function useVoice() {
  const [enabled, setEnabled] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ブラウザ機能の検出
    setSupported("speechSynthesis" in window);
    return () => { if ("speechSynthesis" in window) speechSynthesis.cancel(); };
  }, []);

  const speak = useCallback((text: string) => {
    if (!enabled || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/ /g, ""));
    u.lang = "ja-JP";
    u.rate = 0.85; // ゆっくり
    const ja = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("ja"));
    if (ja.length) u.voice = ja.find((v) => /Kyoko|O-ren|Google|Nanami/.test(v.name)) ?? ja[0];
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    speechSynthesis.speak(u);
  }, [enabled]);

  const stop = useCallback(() => {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return { supported, enabled, setEnabled, speaking, speak, stop };
}
