// Desktop placeholder: exercises everything the real game relies on and prints the results.
// Results are also exposed on window.__placeholderResults for the smoke test.
const results = {};
window.__placeholderResults = results;
const list = document.getElementById('checks');
const logEl = document.getElementById('log');

function log(msg) {
  logEl.textContent += `${new Date().toLocaleTimeString()}  ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}
function check(id, name, status, detail) {
  results[id] = { status, detail };
  let li = document.getElementById(`chk-${id}`);
  if (!li) {
    li = document.createElement('li');
    li.id = `chk-${id}`;
    li.innerHTML = '<span class="pill"></span><span class="name"></span><span class="detail"></span>';
    list.appendChild(li);
  }
  const pill = li.querySelector('.pill');
  pill.className = `pill ${status}`;
  pill.textContent = status.toUpperCase();
  li.querySelector('.name').textContent = name;
  li.querySelector('.detail').textContent = detail;
}

// ---------------------------------------------------------------- edcDesktop bridge
const d = window.edcDesktop;
const CONTRACT = ['isDesktop', 'isFullscreen', 'platform', 'quit', 'setFullscreen', 'unlockAchievement', 'version'];
if (d) {
  const keys = Object.keys(d).sort();
  const exact = JSON.stringify(keys) === JSON.stringify(CONTRACT);
  check('bridge', 'edcDesktop bridge', exact && d.isDesktop === true ? 'pass' : 'fail',
    `isDesktop=${d.isDesktop} platform=${d.platform} version=${d.version} keys=[${keys.join(', ')}]${exact ? '' : ' (does not match contract!)'}`);
  d.isFullscreen().then((fs) => check('fullscreen', 'isFullscreen()', 'pass', `-> ${fs}`)).catch((e) => check('fullscreen', 'isFullscreen()', 'fail', String(e)));
  const leak = typeof window.require !== 'undefined' || typeof window.process !== 'undefined';
  check('isolation', 'Node isolation', leak ? 'fail' : 'pass', leak ? 'require/process visible to page!' : 'no require/process in page');
} else {
  check('bridge', 'edcDesktop bridge', 'info', 'not present (plain browser) - game must use the Fullscreen API and hide Quit');
  document.getElementById('btn-quit').hidden = true;
}

// ---------------------------------------------------------------- localStorage persistence
try {
  const k = 'edc.placeholder.launches';
  const n = (parseInt(localStorage.getItem(k) || '0', 10) || 0) + 1;
  localStorage.setItem(k, String(n));
  check('storage', 'localStorage', 'pass', `launch #${n} on this profile (origin ${location.origin})`);
} catch (e) {
  check('storage', 'localStorage', 'fail', String(e));
}

// ---------------------------------------------------------------- WebGL (raw, no three.js)
const canvas = document.getElementById('gl');
const gl = canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' }) || canvas.getContext('webgl');
if (!gl) {
  check('webgl', 'WebGL', 'fail', 'no WebGL context');
} else {
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  check('webgl', 'WebGL', 'pass', `${gl.getParameter(gl.VERSION)} | ${renderer}`);
  startGL(gl);
}
function startGL(g) {
  const vs = `attribute vec2 p; varying vec2 uv; void main(){ uv = p; gl_Position = vec4(p, 0.0, 1.0); }`;
  const fs = `precision mediump float; varying vec2 uv; uniform float t; uniform vec2 res;
    float sdDrop(vec2 q){                       // disc + tangent cone, apex up
      float c = length(q) - 0.30;
      vec2 a = vec2(abs(q.x), q.y - 0.62);
      float cone = dot(a, vec2(0.875, 0.484));  // wedge tangent to the disc (sin = 0.30 / 0.62)
      return min(c, max(cone, 0.145 - q.y));
    }
    void main(){
      vec2 q = uv * vec2(res.x / res.y, 1.0);
      vec3 bg = mix(vec3(0.66, 0.89, 0.80), vec3(0.98, 0.95, 0.89), uv.y * 0.5 + 0.5);
      float wob = 0.03 * sin(t * 2.0);
      vec2 p = (q - vec2(0.55 * res.x / res.y, wob)) * 1.4;
      float d = sdDrop(p);
      vec3 red = mix(vec3(0.37, 0.0, 0.02), vec3(0.95, 0.05, 0.08), smoothstep(0.0, -0.22, d));
      float hl = smoothstep(0.06, 0.0, length((p - vec2(-0.12, 0.08)) * vec2(1.6, 0.8)));
      vec3 col = mix(bg, red + hl, smoothstep(0.01, -0.01, d));
      gl_FragColor = vec4(col, 1.0);
    }`;
  const sh = (type, src) => { const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s)); return s; };
  try {
    const prog = g.createProgram();
    g.attachShader(prog, sh(g.VERTEX_SHADER, vs));
    g.attachShader(prog, sh(g.FRAGMENT_SHADER, fs));
    g.linkProgram(prog);
    g.useProgram(prog);
    const buf = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    const loc = g.getAttribLocation(prog, 'p');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    const uT = g.getUniformLocation(prog, 't');
    const uR = g.getUniformLocation(prog, 'res');
    let frames = 0;
    const t0 = performance.now();
    const frame = (now) => {
      const w = Math.floor(innerWidth * devicePixelRatio), h = Math.floor(innerHeight * devicePixelRatio);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      g.viewport(0, 0, w, h);
      g.uniform1f(uT, now / 1000);
      g.uniform2f(uR, w, h);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      frames++;
      if (frames === 60) check('raf', 'render loop', 'pass', `60 frames in ${Math.round(performance.now() - t0)} ms`);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  } catch (e) {
    check('webgl', 'WebGL', 'fail', `shader error: ${e.message}`);
  }
}

// ---------------------------------------------------------------- WebAudio
let audio = null;
try {
  const AC = window.AudioContext || window.webkitAudioContext;
  audio = new AC();
  check('audio', 'WebAudio', 'pass', `AudioContext state=${audio.state} sampleRate=${audio.sampleRate}`);
} catch (e) {
  check('audio', 'WebAudio', 'fail', String(e));
}
function blip() {
  if (!audio) return;
  audio.resume();
  const o = audio.createOscillator();
  const gnode = audio.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(660, audio.currentTime);
  o.frequency.exponentialRampToValueAtTime(220, audio.currentTime + 0.25);
  gnode.gain.setValueAtTime(0.2, audio.currentTime);
  gnode.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.3);
  o.connect(gnode).connect(audio.destination);
  o.start();
  o.stop(audio.currentTime + 0.32);
  log(`played blip (AudioContext ${audio.state})`);
}

// ---------------------------------------------------------------- Gamepad API
if (typeof navigator.getGamepads === 'function') {
  const describe = () => {
    const pads = [...navigator.getGamepads()].filter(Boolean);
    check('gamepad', 'Gamepad API', 'pass', pads.length ? pads.map((p) => `#${p.index} ${p.id} (${p.mapping || 'raw'})`).join('; ') : 'available, no pad connected');
  };
  describe();
  addEventListener('gamepadconnected', (e) => { log(`gamepad connected: ${e.gamepad.id}`); describe(); });
  addEventListener('gamepaddisconnected', describe);
} else {
  check('gamepad', 'Gamepad API', 'fail', 'navigator.getGamepads missing');
}

// ---------------------------------------------------------------- offline / CSP
check('coi', 'cross-origin isolated', self.crossOriginIsolated ? 'pass' : 'info', `crossOriginIsolated=${self.crossOriginIsolated} (SharedArrayBuffer ${typeof SharedArrayBuffer})`);
fetch('https://' + 'edc-network-probe.invalid/')
  .then(() => check('offline', 'network blocked', d ? 'fail' : 'info', 'remote fetch succeeded'))
  .catch(() => check('offline', 'network blocked', 'pass', 'remote fetch refused (CSP / request filter)'));

// ---------------------------------------------------------------- buttons
document.getElementById('btn-fs').addEventListener('click', async () => {
  if (d) { const now = await d.isFullscreen(); const r = await d.setFullscreen(!now); log(`setFullscreen(${!now}) -> ${r}`); }
  else if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen();
});
document.getElementById('btn-ach').addEventListener('click', async () => {
  if (!d) return log('no bridge');
  const ok = await d.unlockAchievement('ACH_WIN_ONE_GAME');   // exists in Spacewar (app 480)
  log(`unlockAchievement('ACH_WIN_ONE_GAME') -> ${ok}`);
});
document.getElementById('btn-snd').addEventListener('click', blip);
document.getElementById('btn-quit').addEventListener('click', () => d && d.quit());
addEventListener('keydown', (e) => { if (e.key === 'q' && e.ctrlKey && d) d.quit(); });
log('placeholder ready');
