/**
 * Donor face atlas (ART owns): 3 x 2 cells drawn on a transparent canvas and composited over the
 * skin colour in the donor shader (planar projection on the head's front hemisphere).
 *
 * Cell coordinates: u = x/R * 0.5 + 0.5, v = y/R * 0.5 + 0.5 of the head-local position, so the
 * cell centre is the middle of the face. Features are BIG and bold: a head is ~10-14 px on screen.
 */
export const FACE = { SMILE: 0, BLINK: 1, WORRIED: 2, HURT: 3, DROWN: 4, DEAD: 5 };
export const FACE_COLS = 3; export const FACE_ROWS = 2;

const INK = '#2a2522';
const WHITE = '#fbfbf8';
const CHEEK = 'rgba(236,150,112,0.42)'; // peach, never red

export function faceAtlasCanvas() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S * FACE_COLS; c.height = S * FACE_ROWS;
  const g = c.getContext('2d', { willReadFrequently: true }); // CPU raster: small atlas, avoids GPU-canvas tile issues
  g.lineCap = 'round'; g.lineJoin = 'round';
  const draws = [smile, blink, worried, hurt, drown, dead];
  draws.forEach((fn, i) => {
    g.save();
    g.translate((i % FACE_COLS) * S, Math.floor(i / FACE_COLS) * S);
    // face-space helper: x,y in head radii (-1..1, +y up) -> cell pixels
    const P = (x, y) => [(x * 0.5 + 0.5) * S, (0.5 - y * 0.5) * S];
    fn(g, P, S);
    g.restore();
  });
  return c;
}

const EX = 0.34; const EY = 0.06; const MY = -0.36;

function cheeks(g, P, S, r = 0.13, y = -0.18) {
  g.fillStyle = CHEEK;
  for (const s of [-1, 1]) { const [x, yy] = P(s * 0.5, y); g.beginPath(); g.ellipse(x, yy, S * r * 0.5, S * r * 0.32, 0, 0, Math.PI * 2); g.fill(); }
}
function smileArc(g, P, S, w = 0.3, y = MY + 0.04, lw = 0.07) {
  const [x, yy] = P(0, y + 0.1);
  g.strokeStyle = INK; g.lineWidth = S * lw;
  g.beginPath(); g.arc(x, yy, S * w * 0.5, 0.18 * Math.PI, 0.82 * Math.PI); g.stroke();
}
function sleepyEyes(g, P, S) {
  // sedated: heavy half-closed lids (lower half of a dark eye + lid line)
  for (const s of [-1, 1]) {
    const [x, y] = P(s * EX, EY);
    g.fillStyle = INK;
    g.beginPath(); g.ellipse(x, y, S * 0.07, S * 0.08, 0, 0, Math.PI); g.fill();
    g.fillStyle = WHITE;
    g.beginPath(); g.arc(x + S * 0.02, y + S * 0.025, S * 0.014, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK; g.lineWidth = S * 0.055;
    g.beginPath(); g.moveTo(x - S * 0.08, y - S * 0.004); g.lineTo(x + S * 0.08, y - S * 0.004); g.stroke();
  }
}
function brows(g, P, S, tilt, y = 0.36) {
  g.strokeStyle = INK; g.lineWidth = S * 0.05;
  for (const s of [-1, 1]) {
    const [x, yy] = P(s * EX, y);
    g.beginPath(); g.moveTo(x - S * 0.07, yy + s * tilt * S); g.lineTo(x + S * 0.07, yy - s * tilt * S); g.stroke();
  }
}

function smile(g, P, S) { cheeks(g, P, S); sleepyEyes(g, P, S); smileArc(g, P, S, 0.42); }
function blink(g, P, S) {
  cheeks(g, P, S);
  g.strokeStyle = INK; g.lineWidth = S * 0.055;
  for (const s of [-1, 1]) { const [x, y] = P(s * EX, EY); g.beginPath(); g.arc(x, y - S * 0.02, S * 0.065, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke(); }
  smileArc(g, P, S, 0.42);
}
function dotEyes(g, P, S, rx = 0.07, ry = 0.09, y = EY) {
  g.fillStyle = INK;
  for (const s of [-1, 1]) {
    const [x, yy] = P(s * EX, y);
    g.beginPath(); g.ellipse(x, yy, S * rx, S * ry, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = WHITE; g.beginPath(); g.arc(x + S * 0.022, yy - S * 0.03, S * 0.02, 0, Math.PI * 2); g.fill(); g.fillStyle = INK;
  }
}
function worried(g, P, S) {
  dotEyes(g, P, S, 0.062, 0.085);
  brows(g, P, S, -0.035, 0.36);
  // wobbly little mouth
  g.strokeStyle = INK; g.lineWidth = S * 0.06;
  const [mx, my] = P(0, MY);
  g.beginPath(); g.moveTo(mx - S * 0.12, my);
  g.quadraticCurveTo(mx - S * 0.06, my - S * 0.045, mx, my); g.quadraticCurveTo(mx + S * 0.06, my + S * 0.045, mx + S * 0.12, my);
  g.stroke();
  // sweat drop (pale blue)
  g.fillStyle = 'rgba(120,190,230,1)';
  const [sx, sy] = P(0.68, 0.32);
  g.beginPath(); g.moveTo(sx, sy - S * 0.08); g.quadraticCurveTo(sx + S * 0.055, sy, sx, sy + S * 0.035); g.quadraticCurveTo(sx - S * 0.055, sy, sx, sy - S * 0.08); g.fill();
}
function hurt(g, P, S) {
  g.strokeStyle = INK; g.lineWidth = S * 0.065;
  for (const s of [-1, 1]) {
    const [x, y] = P(s * EX, EY);
    g.beginPath(); g.moveTo(x - s * S * 0.08, y - S * 0.065); g.lineTo(x + s * S * 0.05, y); g.lineTo(x - s * S * 0.08, y + S * 0.065); g.stroke();
  }
  // grimace: open mouth with a tooth line
  const [mx, my] = P(0, MY);
  g.fillStyle = INK; g.beginPath(); g.ellipse(mx, my, S * 0.15, S * 0.085, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = WHITE; g.fillRect(mx - S * 0.11, my - S * 0.06, S * 0.22, S * 0.04);
}
function drown(g, P, S) {
  // puffed cheeks + wide dot eyes + pursed lips
  g.fillStyle = 'rgba(232,140,100,0.6)';
  for (const s of [-1, 1]) { const [x, y] = P(s * 0.5, -0.24); g.beginPath(); g.arc(x, y, S * 0.13, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = 'rgba(42,37,34,0.8)'; g.lineWidth = S * 0.03;
  for (const s of [-1, 1]) { const [x, y] = P(s * 0.5, -0.24); g.beginPath(); g.arc(x, y, S * 0.13, s > 0 ? -0.7 : Math.PI - 0.9, s > 0 ? 0.9 : Math.PI + 0.7); g.stroke(); }
  dotEyes(g, P, S, 0.075, 0.075, EY + 0.06);
  brows(g, P, S, 0.0, 0.42);
  const [mx, my] = P(0, MY - 0.02);
  g.strokeStyle = INK; g.lineWidth = S * 0.05;
  g.beginPath(); g.arc(mx, my, S * 0.04, 0, Math.PI * 2); g.stroke();
}
function dead(g, P, S) {
  g.strokeStyle = INK; g.lineWidth = S * 0.065;
  for (const s of [-1, 1]) {
    const [x, y] = P(s * EX, EY);
    const r = S * 0.072;
    g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke();
  }
  // still smiling (deadpan)
  smileArc(g, P, S, 0.36);
}
