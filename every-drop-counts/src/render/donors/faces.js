/**
 * Painted donor face texture (equirect for a SphereGeometry: the face is centred at u = 0.25,
 * which three.js maps to +z = toward the camera in the donor's rest pose).
 */
export function faceTexture(THREE, dead = false) {
  const W = 512; const H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H); // tinted by instance colour (skin)
  // hair cap on top/back
  g.fillStyle = '#7a6a5a';
  g.fillRect(0, 0, W, H * 0.24);
  g.beginPath(); g.ellipse(W * 0.75, H * 0.3, W * 0.22, H * 0.32, 0, 0, Math.PI * 2); g.fill();
  const cx = W * 0.25; const cy = H * 0.52;
  g.strokeStyle = '#2b2b2b'; g.fillStyle = '#2b2b2b'; g.lineCap = 'round';
  if (!dead) {
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * 26, cy - 14, 7, 10, 0, 0, Math.PI * 2); g.fill(); }
    g.lineWidth = 6;
    g.beginPath(); g.arc(cx, cy + 6, 26, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    g.fillStyle = 'rgba(255,120,130,0.45)';
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * 44, cy + 10, 12, 7, 0, 0, Math.PI * 2); g.fill(); }
  } else {
    g.lineWidth = 6;
    for (const s of [-1, 1]) {
      const ex = cx + s * 26; const ey = cy - 14;
      g.beginPath(); g.moveTo(ex - 9, ey - 9); g.lineTo(ex + 9, ey + 9); g.moveTo(ex + 9, ey - 9); g.lineTo(ex - 9, ey + 9); g.stroke();
    }
    g.beginPath(); g.ellipse(cx, cy + 22, 14, 9, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#c8001a';
    g.beginPath(); g.ellipse(cx + 6, cy + 36, 5, 10, 0, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
