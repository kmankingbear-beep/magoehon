/** 画像AIのキーがないときに使う、おためし用の挿絵(ブラウザのcanvasで描く)。 */
const PALETTES = [
  ["#ffe9c7", "#ffd1a6", "#9fd8a8", "#6bbf7a"],
  ["#d9f0ff", "#bfe3ff", "#b8e0a0", "#86c56f"],
  ["#ffe1ec", "#ffc9d9", "#c8e6b0", "#9ccf86"],
  ["#fff4c2", "#ffe38a", "#a8dcc0", "#74c29b"],
  ["#2b3a67", "#4a5a8f", "#5d7a6a", "#3f5a4c"],
];

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function drawDummyIllustration(seed: string, label: string): string {
  const w = 1536;
  const h = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const r = hash(seed);
  const night = /よる|ほし|おやすみ|ゆめ/.test(label);
  const [sky1, sky2, hill1, hill2] = night ? PALETTES[4] : PALETTES[r % 4];

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, sky1);
  g.addColorStop(1, sky2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // おひさま / おつきさま
  ctx.fillStyle = night ? "#fff6b0" : "#ffb84d";
  ctx.beginPath();
  ctx.arc(250 + (r % 900), 220, 110, 0, Math.PI * 2);
  ctx.fill();
  if (night) {
    ctx.fillStyle = "#fffbe0";
    for (let i = 0; i < 30; i++) {
      const x = (hash(seed + i) % w);
      const y = (hash(i + seed) % 500);
      ctx.beginPath();
      ctx.arc(x, y, 4 + (i % 4), 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (let i = 0; i < 3; i++) {
      const cx = 200 + ((r >> (i * 3)) % 1100);
      const cy = 150 + i * 90;
      for (const [dx, rad] of [[0, 60], [60, 75], [130, 55]]) {
        ctx.beginPath();
        ctx.arc(cx + dx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // おか
  ctx.fillStyle = hill1;
  ctx.beginPath();
  ctx.ellipse(400, h + 100, 900, 420, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hill2;
  ctx.beginPath();
  ctx.ellipse(1250, h + 160, 900, 440, 0, 0, Math.PI * 2);
  ctx.fill();

  // しゅじんこう(まるい くま)
  const cx = 560 + (r % 400);
  const cy = 700;
  ctx.fillStyle = "#c98b5a";
  for (const [dx, dy, rad] of [[-85, -95, 45], [85, -95, 45]]) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 130, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f3d3b0";
  ctx.beginPath();
  ctx.ellipse(cx, cy + 40, 60, 45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3b2a20";
  for (const dx of [-45, 45]) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy - 20, 12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy + 25, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,120,120,0.5)";
  for (const dx of [-80, 80]) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy + 20, 20, 0, Math.PI * 2);
    ctx.fill();
  }

  // おためし の しるし
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillRect(w - 420, h - 90, 400, 64);
  ctx.fillStyle = "#666";
  ctx.font = "bold 36px 'Zen Maru Gothic', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("おためしの え", w - 220, h - 45);

  return canvas.toDataURL("image/jpeg", 0.85);
}
