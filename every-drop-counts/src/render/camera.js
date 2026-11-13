/**
 * Fixed front camera with mild perspective, subtle sway and event-driven shake / zoom-punch.
 * (VFX owns this file.)  createCameraRig(ctx) -> { update(dt, state, alpha), resize(w,h), shake(amount), dispose() }
 *
 * Framing: the rotating 16x10 drum (diagonal ~18.9 m) must always fit, so the camera distance is
 * solved from the vertical FOV and the aspect ratio.
 */
export function createCameraRig(ctx) {
  const { camera, bus, settings } = ctx;
  const DIAG = Math.hypot(16, 10) + 1.6; // margin around the drum
  let baseDist = 30;
  let trauma = 0;
  let punch = 0;
  let t = 0;
  const offs = [];

  function fit() {
    const vfov = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const dV = (DIAG / 2) / Math.tan(vfov / 2);
    const dH = (DIAG / 2) / Math.tan(hfov / 2);
    baseDist = Math.max(dV, dH) * 0.93 + 2.5; // corners may kiss the frame edge at 45°
  }

  const add = (a) => { if (settings.screenShake !== false) trauma = Math.min(1, trauma + a); };
  offs.push(bus.on('slam', () => { add(0.55); punch = Math.max(punch, 0.5); }));
  offs.push(bus.on('limb:sever', () => add(0.18)));
  offs.push(bus.on('donor:death', () => add(0.12)));
  offs.push(bus.on('combo', (p) => { punch = Math.max(punch, Math.min(1, 0.25 + p.multiplier * 0.08)); }));
  offs.push(bus.on('impact', (p) => { if (p.speed > 12) add(Math.min(0.2, (p.speed - 12) * 0.02)); }));
  offs.push(bus.on('prop:explode', () => add(0.8)));

  fit();
  return {
    resize() { fit(); },
    shake(a) { add(a); },
    update(dt) {
      t += dt;
      trauma = Math.max(0, trauma - dt * 1.6);
      punch = Math.max(0, punch - dt * 2.5);
      const s = trauma * trauma * (settings.shakeScale ?? 1);
      const n = (k) => Math.sin(t * (37 + k * 11.3) + k * 1.7) * Math.sin(t * (13 + k * 5.1));
      const sway = 0.12;
      camera.position.set(
        Math.sin(t * 0.21) * sway + n(1) * s * 0.6,
        0.6 + Math.sin(t * 0.17) * sway * 0.6 + n(2) * s * 0.6,
        baseDist * (1 - punch * 0.06),
      );
      camera.lookAt(n(3) * s * 0.15, n(4) * s * 0.15, 0);
      camera.rotation.z += n(5) * s * 0.02;
    },
    dispose() { offs.forEach((o) => o()); },
  };
}
