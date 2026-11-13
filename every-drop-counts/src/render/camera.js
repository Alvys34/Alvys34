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
  // HUD plates sit in the top corners (ctx.settings.hudInsets, fractions of the viewport, set by the UI
  // while the HUD is visible). When a drum corner (at mid-depth) would sit under a plate, the camera
  // reserves a top band (drum shrinks a little and moves down), capped at RESERVE_MAX of the height.
  const RESERVE_MAX = 0.12;
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
  let reserve = 0; // current top band (fraction of the screen height), smoothed
  // ending (shift 8): camera drifts from the front view into the intake hatch
  let ending = null; // { t, dur, p0, l0, fov0 } while playing
  const tmpV = { x: 0, y: 0, z: 0 };

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
  function required(ex, ey, res = reserve) {
    const tv = Math.tan((camera.fov * Math.PI) / 360);
    const th = tv * camera.aspect;
    const keep = 1 - marginFrac;
    return Math.max(ey / (keep - res) / tv, ex / keep / th);
  }
  /**
   * Smallest top band (0..RESERVE_MAX) that keeps the drum's mid-depth corners out of the HUD
   * plates at drum angle theta (the corner may also clear a plate by sitting inside its inner edge).
   */
  function reserveFor(theta, ex, ey) {
    const ins = settings.hudInsets;
    if (!ins || !(ins.top > 0)) return 0;
    const c = Math.cos(theta); const s = Math.sin(theta);
    const tv = Math.tan((camera.fov * Math.PI) / 360); const th = tv * camera.aspect;
    for (let r = 0; r <= RESERVE_MAX + 1e-6; r += 0.01) {
      const d = Math.max(required(ex, ey, r), 1e-3);
      const zc = HD + d; // camera z; corners at z = 0 (mid-depth)
      const cy = r * d * tv;
      let ok = true;
      for (let k = 0; k < 4 && ok; k++) {
        const x = (k & 1 ? HW : -HW); const y = (k & 2 ? HH : -HH);
        const wx = c * x - s * y; const wy = s * x + c * y;
        const sx = wx / (zc * th); const sy = (wy - cy) / (zc * tv); // NDC -1..1
        const top = 1 - 2 * ins.top;
        const w = sx < 0 ? ins.left : ins.right;
        if (sy > top && Math.abs(sx) > 1 - 2 * (w || 0)) ok = false;
      }
      if (ok) return r;
    }
    return RESERVE_MAX;
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
    bus.on('shift:start', () => { snap = true; trauma = 0; punch = 0; kx = ky = kvx = kvy = 0; stopEnding(); }),
  ];

  function stopEnding() {
    if (!ending) return;
    camera.fov = ending.fov0; camera.updateProjectionMatrix();
    ending = null; snap = true;
  }
  // world position of the hatch opening (drum-local -> world, follows the coasting drum)
  function hatchWorld(h, depthOff, out) {
    const HDw = HD;
    const hx = h.x || 0; const hy = h.y || 0;
    const c = Math.cos(ctx.drumAngle); const s = Math.sin(ctx.drumAngle);
    out.x = c * hx - s * hy + ctx.drumGroup.position.x;
    out.y = s * hx + c * hy + ctx.drumGroup.position.y;
    out.z = -HDw + depthOff;
    return out;
  }
  const smoother = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * t * (t * (t * 6 - 15) + 10); };
  function endingPose(dtIn, state) {
    const e = ending;
    e.t += Math.max(0, Math.min(0.1, Number(dtIn) || 0)) || 1 / 60;
    const h = state && state.hatch;
    if (!h || (h.wall && h.wall !== 'back')) { // only the back-wall hatch is a chute; otherwise a gentle push-in
      const k = smoother(e.t / e.dur);
      camera.position.copy(e.p0); camera.position.z = e.p0.z - (e.p0.z - HD - 2) * 0.55 * k;
      camera.quaternion.copy(e.q0);
      return;
    }
    const k = smoother(e.t / e.dur);
    // end: just in front of the hatch, slightly above it, looking down/into the chute
    const goal = hatchWorld(h, 1.1, tmpV);
    const gx = goal.x; const gy = goal.y + 0.45; const gz = goal.z;
    camera.position.set(e.p0.x + (gx - e.p0.x) * k, e.p0.y + (gy - e.p0.y) * k, e.p0.z + (gz - e.p0.z) * k);
    const look = hatchWorld(h, -1.4, tmpV);
    camera.lookAt(look.x, look.y - 0.3, look.z);
    // blend from the start orientation into the look-at (no snap on the first frame)
    const qLook = camera.quaternion.clone();
    camera.quaternion.copy(e.q0).slerp(qLook, smoother(e.t / (e.dur * 0.6)));
    const fov = e.fov0 + (30 - e.fov0) * k;
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  function fit(dt, state) {
    const theta = ctx.drumAngle;
    const w = state && state.drum ? state.drum.omega : 0;
    marginFrac = MARGIN_FRAC + SHAKE_FRAC * shakeAmount();
    extents(theta, e2);
    const ex0 = e2[0]; const ey0 = e2[1];
    // anticipate where the drum is going
    let ex = e2[0]; let ey = e2[1];
    const sweep = w * LOOKAHEAD;
    for (let k = 1; k <= 6; k++) {
      extents(theta + (sweep * k) / 6, e2);
      if (e2[0] > ex) ex = e2[0];
      if (e2[1] > ey) ey = e2[1];
    }
    // top band for the HUD plates: the worst over the angles about to be swept, eased in/out
    let rTarget = reserveFor(theta, ex0, ey0);
    if (rTarget < RESERVE_MAX && Math.abs(sweep) > 0.05) {
      for (let k = 2; k <= 6; k += 2) { const a = theta + (sweep * k) / 6; extents(a, e2); rTarget = Math.max(rTarget, reserveFor(a, e2[0], e2[1])); }
    }
    if (snap || dist <= 0 || !(dt > 0)) reserve = rTarget;
    else reserve += (rTarget - reserve) * Math.min(1, dt * (rTarget > reserve ? 6 : 1.5));
    const need = required(ex0, ey0);
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
      const cy = reserve * curH;
      // zoom punch only uses the slack above the no-crop distance
      const z = HD + Math.max(lastReq, dist * (1 - 0.03 * punch * A));
      const ox = Math.sin(t * 0.21 * Math.PI * 2 * 0.25) * sway + n(1) * s * 0.14 + kxs;
      const oy = Math.sin(t * 0.17 * Math.PI * 2 * 0.25 + 1.3) * sway * 0.6 + n(2) * s * 0.14 + kys;
      camera.position.set(ox, cy + oy, z);
      camera.lookAt(ox * 0.6 + n(3) * s * 0.06, cy + oy * 0.6 + n(4) * s * 0.06, 0);
      camera.rotation.z += n(5) * s * 0.012;
      if (ending) endingPose(dtIn, state);
      camera.updateMatrixWorld();
    },
    /**
     * Shift-8 ending: a slow, calm drift from the front view down into the intake hatch (the
     * operator is next). Only runs once the shift has ENDED; cancelled by shift:start / level change
     * / stopEnding(). The UI fades to black over it. Returns true if it started.
     */
    playEnding(opts = {}) {
      const st = ctx.lastState;
      if (!st || st.status !== 'ended' || !st.hatch) return false;
      ending = { t: 0, dur: opts.duration || 4.2, p0: camera.position.clone(), q0: camera.quaternion.clone(), fov0: camera.fov };
      trauma = 0; punch = 0; kx = ky = kvx = kvy = 0;
      return true;
    },
    stopEnding,
    get endingActive() { return !!ending; },
    onLevel() { stopEnding(); snap = true; },
    dispose() { offs.forEach((o) => o()); },
  };
}
