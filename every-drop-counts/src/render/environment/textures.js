/** Procedural canvas textures for the baseline environment (no image files). */

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function tileTexture(THREE, { base = '#eeeeee', grout = '#cccccc', tiles = 8, accent = '#ffffff', size = 256 } = {}) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = grout; g.fillRect(0, 0, size, size);
  const s = size / tiles;
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      g.fillStyle = (x * 7 + y * 3) % 11 === 0 ? accent : base;
      g.fillRect(x * s + 1.5, y * s + 1.5, s - 3, s - 3);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x * s + 2, y * s + 2, s - 4, (s - 4) * 0.35);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function stripeTexture(THREE, { a = '#f2c230', b = '#1d1d1d', stripes = 6, size = 128 } = {}) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, size, size);
  g.fillStyle = b;
  const w = size / stripes;
  for (let i = -stripes; i < stripes * 2; i += 2) {
    g.beginPath();
    g.moveTo(i * w, 0); g.lineTo(i * w + w, 0); g.lineTo(i * w + w + size, size); g.lineTo(i * w + size, size);
    g.closePath(); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function signTexture(THREE, text, fg = '#2e6e5b', bg = '#ffffff') {
  const c = canvas(1024, 128);
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg;
  g.font = 'bold 64px "Trebuchet MS", "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 4, c.width - 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
