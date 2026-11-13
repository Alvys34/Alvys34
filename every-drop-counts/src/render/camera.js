/**
 * Fixed front camera (VFX owns): mild perspective and a CONSTANT base framing (fix round 2,
 * PLAYTEST-1 M3 / LOCAL-REPORT-1 §2.1: the old per-angle fit swung the on-screen scale ~1.8x and
 * lurched 35 % in 0.25 s on spin-up).
 *
 *   createCameraRig(ctx) -> { update(dt, state), resize(w, h), shake(amount), kick(x, y, amount),
 *                             setScreenShake(v), fit(), playEnding(), stopEnding(), onLevel(), dispose(),
 *                             distance, baseDistance, requiredDistance, tighten (0..1) }
 *
 * Base: fits the drum interior's CIRCUMSCRIBED CIRCLE (radius hypot(HW, HH) of the front opening at
 * z = +HD, the largest thing in perspective), + a small safe margin (2.5 % of the screen, + 1.2 % for
 * shake at full screenShake), + a top band for the HUD plates (settings.hudInsets; <= 12 %, the worst
 * case over all drum angles, so it does not change with the angle either). Every drum angle fits,
 * so while the drum turns NOTHING zooms. Only the INTERIOR counts: frame, gear rim and facility crop freely.
 *
 * Rest tighten: once |omega| has stayed below REST_OMEGA for REST_HOLD s the camera eases in (smooth,
 * ~TIGHTEN_TIME s) to at most 1 + TIGHTEN_MAX x cameraZoomRange (default 1 -> 1.25x the base scale),
 * never past what fits the drum at its current angle (upright: the full 1.25x, 45 deg: ~3 %). When
 * rotation resumes it eases back out at <= EASE_OUT_RATE of the distance per second (a brief crop of
 * the drum corners is accepted). settings.cameraZoomRange = 0 -> fully fixed framing.
 * Zoom punch (combos, explosions; <= 3 %) only uses slack above the current angle's no-crop distance.
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
  const RESERVE_RATE = 0.08;   // top band change speed (fraction of the height per second)
  const REST_OMEGA = 0.15;     // rad/s: below this the drum counts as "at rest"
  const REST_HOLD = 0.8;       // s at rest before the camera starts to tighten
  const TIGHTEN_WN = 3.2;      // ease-in spring (critically damped): ~95 % of the way in ~1.5 s
  const TIGHTEN_RATE = 0.2;    // max distance shrink per second while tightening (<= 5 % / 0.25 s)
  const TIGHTEN_MAX = 0.25;    // max extra scale at rest (x cameraZoomRange): 1.25x the base
  const EASE_OUT_RATE = 0.28;  // max distance growth per second when rotation resumes (<= 7.3 % / 0.25 s)
  // settings.cameraZoomRange default: full tighten (0 = fixed framing)
  const ZOOM_RANGE = 1;
  const DIAG = Math.hypot(HW, HH);
  camera.fov = FOV;
  camera.near = 0.5; camera.far = 220;
  camera.updateProjectionMatrix();

  let dist = 0; let snap = true;
  let trauma = 0; let punch = 0; let t = 0;
  let kx = 0; let ky = 0; let kvx = 0; let kvy = 0;
  let curH = 1; let lastReq = 0; let zvel = 0; let marginFrac = MARGIN_FRAC;
  let reserve = 0; // current top band (fraction of the screen height), smoothed
  let restT = 0;   // s the drum has been at rest
  let baseDist = 0; let baseReserve = 0; let baseKey = '';
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
  function reserveFor(theta, distOf) {
    const ins = settings.hudInsets;
    if (!ins || !(ins.top > 0)) return 0;
    const c = Math.cos(theta); const s = Math.sin(theta);
    const tv = Math.tan((camera.fov * Math.PI) / 360); const th = tv * camera.aspect;
    for (let r = 0; r <= RESERVE_MAX + 1e-6; r += 0.01) {
      const d = Math.max(distOf(r), 1e-3);
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

  /** cameraZoomRange setting (0..1): scales the rest tighten (0 = fixed framing) */
  const zoomRange = () => (settings.cameraZoomRange != null ? Math.max(0, Math.min(1, Number(settings.cameraZoomRange) || 0)) : ZOOM_RANGE);
  const circleDist = (r) => required(DIAG, DIAG, r);

  function fit(dt, state) {
    const theta = ctx.drumAngle;
    marginFrac = MARGIN_FRAC + SHAKE_FRAC * shakeAmount();
    // base HUD band: the worst case over every drum angle at the circle framing (cached per layout)
    const ins = settings.hudInsets;
    const key = `${camera.aspect.toFixed(4)}|${camera.fov}|${marginFrac.toFixed(4)}|${ins ? `${ins.top},${ins.left},${ins.right}` : '-'}`;
    if (key !== baseKey) {
      baseKey = key; baseReserve = 0;
      if (ins && ins.top > 0) for (let k = 0; k < 36 && baseReserve < RESERVE_MAX; k++) baseReserve = Math.max(baseReserve, reserveFor((k / 36) * Math.PI, circleDist));
    }
    extents(theta, e2);
    const ex0 = e2[0]; const ey0 = e2[1];
    if (state && state.drum && dt > 0) {
      if (Math.abs(state.drum.omega) < REST_OMEGA) restT += dt; else restT = 0;
    }
    const zr = zoomRange();
    const maxTight = 1 + TIGHTEN_MAX * zr;
    const resting = zr > 0 && restT >= REST_HOLD;
    // the tight framing never crops the drum at its current angle
    const tightDist = (r) => Math.max(circleDist(r) / maxTight, required(ex0, ey0, r));
    const rTarget = resting ? reserveFor(theta, tightDist) : baseReserve;
    if (snap || dist <= 0) reserve = rTarget;
    else if (dt > 0) reserve += Math.max(-RESERVE_RATE * dt, Math.min(RESERVE_RATE * dt, rTarget - reserve));
    baseDist = circleDist(reserve);
    const need = required(ex0, ey0, reserve); // tightest no-crop distance at this angle
    lastReq = need;
    const goal = resting ? Math.max(baseDist / maxTight, need) : baseDist;
    if (snap || dist <= 0) { dist = baseDist; zvel = 0; restT = 0; snap = false; } else if (dt > 0) {
      // critically damped spring (smooth start and stop), speed-capped both ways
      const out = goal > dist;
      const wn = out ? 4 : TIGHTEN_WN;
      zvel += ((goal - dist) * wn * wn - 2 * wn * zvel) * dt;
      const cap = dist * (out ? EASE_OUT_RATE : TIGHTEN_RATE);
      if (zvel > cap) zvel = cap; else if (zvel < -cap) zvel = -cap;
      dist += zvel * dt;
      if ((zvel < 0 && dist < goal) || (zvel > 0 && dist > goal)) { dist = goal; zvel = 0; }
    }
    const tv = Math.tan((camera.fov * Math.PI) / 360);
    curH = dist * tv;
  }

  return {
    resize() { snap = true; },
    shake(a) { add(a); },
    kick(x, y, a) { kick(x, y, a); },
    setScreenShake(v) { settings.screenShake = v; },
    get distance() { return dist; },
    /** constant base framing distance (circumscribed circle + margin + HUD band) */
    get baseDistance() { return baseDist; },
    get requiredDistance() { return lastReq; },
    /** current framing scale relative to the base (1 .. 1.25 at rest), punches excluded */
    get scale() { return dist > 0 ? baseDist / dist : 1; },
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
      // zoom punch (<= 3 %) only uses the slack above the no-crop distance, and never pushes out
      const z = HD + Math.max(Math.min(dist, lastReq), dist * (1 - 0.03 * punch * A));
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
