/**
 * Fixed front camera (VFX owns): mild perspective, framing that ADAPTS to the rotating drum so the
 * whole interior is always on screen at every drum angle and aspect ratio (4:3 .. 21:9, Deck
 * 16:10), while donors stay as large as possible.
 *
 *   createCameraRig(ctx) -> { update(dt, state), resize(w, h), shake(amount), kick(x, y, amount),
 *                             setScreenShake(v), fit(), dispose() }
 *
 * Fit: the drum's front opening (2HW x 2HH at z = +HD, the largest thing in perspective) rotated by
 * the drum angle has world half-extents ex = |c|HW + |s|HH, ey = |s|HW + |c|HH. The camera distance
 * is the larger of the vertical/horizontal requirement + a small safe margin (2.5 % of the screen,
 * + 1.2 % for shake at full screenShake). Only the INTERIOR counts: frame, gear rim and facility
 * crop freely; interior corners may pass under the top-corner HUD panels. It ANTICIPATES rotation
 * (max extent over the angles swept in the next ~0.7 s), zooms with a critically damped spring whose
 * speed is capped (out <= 90 %/s, in <= 16 %/s, in only after a 0.5 s hold), and is hard-clamped so
 * the current extent can never crop. Zoom punch only uses slack above that clamp. Held still at 0 deg the drum fills the frame;
 * while it spins the view settles on the worst-case framing instead of pumping.
 *
 * Motion: idle sway, trauma-based shake (impacts, severs, deaths, explosions), a spring "kick"
 * (slam = vertical jolt; events push away from their screen position) and a zoom punch on combos.
 * ALL of it is scaled by settings.screenShake (0..1; booleans accepted: true = 1, false = 0) and by
 * TUNABLES.feel.shakeScale. The fit margin absorbs the motion so it never hides the interior.
 */
import { TUNABLES } from '../core/tunables.js';

export function createCameraRig(ctx) {
  const { camera, bus, settings } = ctx;
  const HW = TUNABLES.drum.width / 2; const HH = TUNABLES.drum.height / 2; const HD = TUNABLES.drum.depth / 2;
  const FOV = 34;
  // Fit the drum INTERIOR (front opening) only: frame, gear rim and facility may crop freely.
  const MARGIN_FRAC = 0.025; // safe margin, fraction of the visible half-extent (~2.5 % of screen)
  const SHAKE_FRAC = 0.012;  // extra room for shake/kick at full screenShake
  const TOP_RESERVE = 0;     // HUD sits in the top corners; interior corners may pass under it briefly
  const LOOKAHEAD = 0.7;     // s of rotation anticipated (zoom-out starts before it is needed)
  const ZOOM_OUT_RATE = 0.9; // max relative zoom speed (fraction of distance per second)
  const ZOOM_IN_RATE = 0.16;
  // 1 = fully adaptive (tightest framing per angle), 0 = always the worst-case (diagonal) framing.
  const ZOOM_RANGE = 1;
  const DIAG = Math.hypot(HW, HH);
  camera.fov = FOV;
  camera.near = 0.5; camera.far = 220;
  camera.updateProjectionMatrix();

  let dist = 0; let holdT = 0; let snap = true;
  let trauma = 0; let punch = 0; let t = 0;
  let kx = 0; let ky = 0; let kvx = 0; let kvy = 0;
  let curH = 1; let lastReq = 0; let zvel = 0; let marginFrac = MARGIN_FRAC;

  const shakeAmount = () => {
    const v = settings.screenShake;
    let a = v === false ? 0 : v === true || v == null ? 1 : Math.max(0, Math.min(1, Number(v) || 0));
    if (settings.shakeScale != null) a *= Math.max(0, Number(settings.shakeScale) || 0);
    return a * (TUNABLES.feel.shakeScale ?? 1);
  };

  function extents(theta, out) {
    const c = Math.abs(Math.cos(theta)); const s = Math.abs(Math.sin(theta));
    out[0] = c * HW + s * HH; out[1] = s * HW + c * HH;
    return out;
  }
  function required(ex, ey) {
    const tv = Math.tan((camera.fov * Math.PI) / 360);
    const th = tv * camera.aspect;
    const keep = 1 - marginFrac - TOP_RESERVE;
    return Math.max(ey / keep / tv, ex / keep / th);
  }
  const e2 = [0, 0];

  // event -> screen-space direction (world x/y of a drum-local position)
  function worldXY(pos) {
    const th = ctx.drumAngle; const c = Math.cos(th); const s = Math.sin(th);
    return [c * pos[0] - s * pos[1], s * pos[0] + c * pos[1]];
  }
  const add = (a) => { trauma = Math.min(1, trauma + a); };
  function kick(x, y, a) {
    const l = Math.hypot(x, y) || 1;
    kvx += (x / l) * a; kvy += (y / l) * a;
  }
  const offs = [
    bus.on('slam', () => { add(0.42); kvy -= 5.5; punch = Math.max(punch, 0.35); }),
    bus.on('limb:sever', (p) => { add(0.12); if (p.pos) { const w = worldXY(p.pos); kick(-w[0], -w[1], 0.9); } }),
    bus.on('donor:death', (p) => { if (p.cause !== 'drown') add(0.08); }),
    bus.on('combo', (p) => { punch = Math.max(punch, Math.min(1, 0.3 + (p.multiplier || 2) * 0.09)); }),
    bus.on('impact', (p) => { if (p.speed > 11) add(Math.min(0.15, (p.speed - 11) * 0.015)); }),
    bus.on('prop:explode', (p) => { add(0.75); punch = Math.max(punch, 0.7); if (p.pos) { const w = worldXY(p.pos); kick(-w[0], -w[1], 4); } }),
    bus.on('splash', (p) => { if ((p.size || 0) > 0.6) add(0.05); }),
    bus.on('shift:start', () => { snap = true; trauma = 0; punch = 0; kx = ky = kvx = kvy = 0; }),
  ];

  function fit(dt, state) {
    const theta = ctx.drumAngle;
    const w = state && state.drum ? state.drum.omega : 0;
    marginFrac = MARGIN_FRAC + SHAKE_FRAC * shakeAmount();
    extents(theta, e2);
    const need = required(e2[0], e2[1]);
    // anticipate where the drum is going
    let ex = e2[0]; let ey = e2[1];
    const sweep = w * LOOKAHEAD;
    for (let k = 1; k <= 6; k++) {
      extents(theta + (sweep * k) / 6, e2);
      if (e2[0] > ex) ex = e2[0];
      if (e2[1] > ey) ey = e2[1];
    }
    const zr = settings.cameraZoomRange != null ? Math.max(0, Math.min(1, Number(settings.cameraZoomRange) || 0)) : ZOOM_RANGE;
    const worst = required(DIAG, DIAG);
    const target = Math.max(need, worst + (required(ex, ey) - worst) * zr);
    lastReq = need;
    if (snap || dist <= 0) { dist = target; snap = false; holdT = 0.5; zvel = 0; } else if (dt > 0) {
      // critically damped spring on distance, with a capped zoom speed (no lurches)
      let goal = dist;
      if (target > dist) { goal = target; holdT = 0.5; } else { holdT -= dt; if (holdT <= 0) goal = target; }
      const out = goal > dist;
      const wn = out ? 9 : 2.2;
      zvel += ((goal - dist) * wn * wn - 2 * wn * zvel) * dt;
      const cap = dist * (out ? ZOOM_OUT_RATE : ZOOM_IN_RATE);
      if (zvel > cap) zvel = cap; else if (zvel < -cap) zvel = -cap;
      dist += zvel * dt;
      if (!out && dist < goal) { dist = goal; zvel = 0; }
    }
    if (dist < need) { dist = need; if (zvel < 0) zvel = 0; } // never crop the interior
    const tv = Math.tan((camera.fov * Math.PI) / 360);
    curH = dist * tv;
  }

  return {
    resize() { snap = true; },
    shake(a) { add(a); },
    kick(x, y, a) { kick(x, y, a); },
    setScreenShake(v) { settings.screenShake = v; },
    get distance() { return dist; },
    get requiredDistance() { return lastReq; },
    fit() { fit(0, null); return dist; },
    update(dtIn, state) {
      const dt = Math.max(0, Math.min(0.1, dtIn || 0));
      t += dt;
      fit(dt, state);
      trauma = Math.max(0, trauma - dt * 1.5);
      punch = Math.max(0, punch - dt * 2.2);
      // kick spring
      kvx += (-120 * kx - 13 * kvx) * dt; kvy += (-120 * ky - 13 * kvy) * dt;
      kx += kvx * dt; ky += kvy * dt;
      const A = shakeAmount();
      const s = trauma * trauma * A;
      const n = (k) => Math.sin(t * (31 + k * 7.3) + k * 1.7) * 0.6 + Math.sin(t * (17.3 + k * 3.1) + k * 4.1) * 0.4;
      const sway = 0.05 * A;
      const kxs = Math.max(-0.15, Math.min(0.15, kx * A)); const kys = Math.max(-0.15, Math.min(0.15, ky * A));
      const cy = TOP_RESERVE * curH;
      // zoom punch only uses the slack above the no-crop distance
      const z = HD + Math.max(lastReq, dist * (1 - 0.03 * punch * A));
      const ox = Math.sin(t * 0.21 * Math.PI * 2 * 0.25) * sway + n(1) * s * 0.14 + kxs;
      const oy = Math.sin(t * 0.17 * Math.PI * 2 * 0.25 + 1.3) * sway * 0.6 + n(2) * s * 0.14 + kys;
      camera.position.set(ox, cy + oy, z);
      camera.lookAt(ox * 0.6 + n(3) * s * 0.06, cy + oy * 0.6 + n(4) * s * 0.06, 0);
      camera.rotation.z += n(5) * s * 0.012;
      camera.updateMatrixWorld();
    },
    dispose() { offs.forEach((o) => o()); },
  };
}
