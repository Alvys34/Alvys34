/**
 * The donation drum (ART owns) — everything here lives in ctx.drumGroup (drum-local coords, the
 * sim's frame) and rotates with the drum: enamel-tiled chamber, riveted steel front frame, glass
 * with a world-fixed reflection sheen, geared rim + struts behind, the intake hatch.
 *
 * createDrum(ctx, M, signs) -> { surfaces, onLevel(state), update(dt, state), setQuality(q, name), dispose() }
 *
 * `surfaces` (also published as ctx.drumSurfaces for VFX): { back, sides, glass, HW, HH, HD } —
 * back: the interior back-wall Mesh (plane at z = -HD, the blood "canvas"; its material map is
 * ART's tile canvas — VFX should overlay its own layer rather than replace the map).
 */
import { PAL, makeRng } from './palette.js';
import { builder, rbox, cylZ, atlasPlane } from './geo.js';
import { drumBackCanvas, drumSidesCanvas, glassCanvas, stripeTexture, toTexture } from './textures.js';

export function createDrum(ctx, M, signs) {
  const { THREE, drumGroup } = ctx;
  const HW = 8; const HH = 5; const HD = 2.5;
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };
  const root = new THREE.Group(); root.name = 'drum-shell';
  drumGroup.add(root);

  // ---------------- chamber interior ----------------
  const backTex = track(toTexture(THREE, drumBackCanvas(0.8), { aniso: 8 }));
  const backMat = track(new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.42, metalness: 0 }));
  const back = new THREE.Mesh(track(new THREE.PlaneGeometry(HW * 2, HH * 2)), backMat);
  back.position.z = -HD;
  back.receiveShadow = true;
  back.name = 'drum-back';
  root.add(back);

  const sides = drumSidesCanvas(0.8);
  const sideTex = track(toTexture(THREE, sides.canvas, { aniso: 8 }));
  const sideMat = track(new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.45, metalness: 0 }));
  const sideGeo = track(buildSides(THREE, HW, HH, HD, sides));
  const sideMesh = new THREE.Mesh(sideGeo, sideMat);
  sideMesh.receiveShadow = true;
  sideMesh.name = 'drum-sides';
  root.add(sideMesh);

  // ---------------- front frame (merged painted metal) ----------------
  const F = builder(THREE, { colors: true });
  const ft = 0.95; const fz0 = HD - 0.05; const fd = 0.6; const fzc = fz0 + fd / 2;
  const frameCol = 0xc3ccce;
  F.add(rbox(THREE, HW * 2 + ft * 2, ft, fd, 0.16, 3), { pos: [0, HH + ft / 2, fzc], color: frameCol });
  F.add(rbox(THREE, HW * 2 + ft * 2, ft, fd, 0.16, 3), { pos: [0, -HH - ft / 2, fzc], color: frameCol });
  F.add(rbox(THREE, ft, HH * 2 + 0.02, fd, 0.16, 3), { pos: [-HW - ft / 2, 0, fzc], color: frameCol });
  F.add(rbox(THREE, ft, HH * 2 + 0.02, fd, 0.16, 3), { pos: [HW + ft / 2, 0, fzc], color: frameCol });
  // glass retaining bezel (dark lip outlining the window)
  const bz = HD + 0.07; const bw = 0.16;
  F.add(rbox(THREE, HW * 2 + bw * 2, bw, 0.12, 0.04), { pos: [0, HH + bw / 2 - 0.02, bz], color: PAL.gunmetal });
  F.add(rbox(THREE, HW * 2 + bw * 2, bw, 0.12, 0.04), { pos: [0, -HH - bw / 2 + 0.02, bz], color: PAL.gunmetal });
  F.add(rbox(THREE, bw, HH * 2, 0.12, 0.04), { pos: [-HW - bw / 2 + 0.02, 0, bz], color: PAL.gunmetal });
  F.add(rbox(THREE, bw, HH * 2, 0.12, 0.04), { pos: [HW + bw / 2 - 0.02, 0, bz], color: PAL.gunmetal });
  // corner gusset plates (three gunmetal, the striped one is separate)
  for (const [sx, sy] of [[1, 1], [-1, -1], [1, -1]]) {
    F.add(rbox(THREE, ft * 1.5, ft * 1.5, 0.14, 0.08), { pos: [sx * (HW + ft / 2), sy * (HH + ft / 2), fz0 + fd + 0.05], color: sy < 0 ? PAL.hazard : PAL.gunmetal });
  }
  // rivets along every frame member + gussets
  const rivet = () => new THREE.SphereGeometry(0.075, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const rz = fz0 + fd;
  const rivetAt = (x, y, z = rz) => F.add(rivet(), { pos: [x, y, z], rot: [Math.PI / 2, 0, 0], color: 0x8f9a9e });
  for (let i = 0; i <= 18; i++) {
    const x = -HW + (i / 18) * HW * 2;
    if (Math.abs(x) < 2.3) continue; // leave room for the THIS SIDE UP plate
    rivetAt(x, HH + ft * 0.5);
  }
  for (let i = 0; i <= 18; i++) rivetAt(-HW + (i / 18) * HW * 2, -HH - ft * 0.5);
  for (let i = 1; i < 11; i++) { const y = -HH + (i / 11) * HH * 2; rivetAt(-HW - ft * 0.5, y); rivetAt(HW + ft * 0.5, y); }
  for (const [sx, sy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    for (const [ox, oy] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) rivetAt(sx * (HW + ft / 2) + ox, sy * (HH + ft / 2) + oy, fz0 + fd + 0.12);
  }
  // lifting lugs on the top member (yellow eyes) — strong "up" cue
  for (const sx of [-1, 1]) {
    F.add(new THREE.TorusGeometry(0.32, 0.11, 8, 16, Math.PI), { pos: [sx * 4.2, HH + ft + 0.02, fzc], color: PAL.hazard });
    F.add(rbox(THREE, 0.9, 0.18, 0.4, 0.05), { pos: [sx * 4.2, HH + ft + 0.02, fzc], color: PAL.hazard });
  }
  // hinge knuckles on the left member (the window "opens" there — asymmetric detail)
  for (const y of [-3.2, 3.2]) {
    F.add(cylZ(THREE, 0.2, 0.2, 0.8, 12), { pos: [-HW - ft - 0.08, y, fzc], rot: [Math.PI / 2, 0, 0], color: PAL.gunmetal });
  }
  // latch on the right member
  F.add(rbox(THREE, 0.34, 1.3, 0.3, 0.08), { pos: [HW + ft + 0.1, -0.6, fzc + 0.1], color: PAL.hazard });
  F.add(rbox(THREE, 0.5, 0.2, 0.35, 0.05), { pos: [HW + ft + 0.1, -0.1, fzc + 0.2], color: PAL.gunmetal });

  // ---------------- geared rim + struts (behind, visible outside the box silhouette) ----------------
  const R0 = 9.9; const R1 = 10.75; const RT = 11.05; const teeth = 120;
  const rimShape = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2; const a1 = ((i + 0.25) / teeth) * Math.PI * 2;
    const a2 = ((i + 0.5) / teeth) * Math.PI * 2; const a3 = ((i + 0.75) / teeth) * Math.PI * 2;
    if (i === 0) rimShape.moveTo(Math.cos(a0) * R1, Math.sin(a0) * R1); else rimShape.lineTo(Math.cos(a0) * R1, Math.sin(a0) * R1);
    rimShape.lineTo(Math.cos(a1) * RT, Math.sin(a1) * RT);
    rimShape.lineTo(Math.cos(a2) * RT, Math.sin(a2) * RT);
    rimShape.lineTo(Math.cos(a3) * R1, Math.sin(a3) * R1);
  }
  rimShape.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, R0, 0, Math.PI * 2, true); rimShape.holes.push(hole);
  const rimZ = -HD - 1.9;
  F.add(new THREE.ExtrudeGeometry(rimShape, { depth: 0.6, bevelEnabled: false, curveSegments: 8 }), { pos: [0, 0, rimZ], color: PAL.gunmetal });
  // painted segments on the rim face (8 yellow / 8 mint) => rotation reads even on the rim
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const seg = new THREE.RingGeometry(R0 + 0.12, R1 - 0.1, 10, 1, a + 0.03, Math.PI / 8 - 0.06);
    F.add(seg, { pos: [0, 0, rimZ + 0.62], color: i === 0 ? PAL.cream0 : i % 2 ? PAL.hazard : PAL.mint3 });
  }
  // struts from the chamber to the rim
  const sz = -HD - 1.2;
  for (const [x, y, w, h] of [[0, HH + 0.5 + (R0 - HH) / 2, 1.4, R0 - HH + 0.8], [0, -(HH + 0.5 + (R0 - HH) / 2), 1.4, R0 - HH + 0.8], [HW + 0.5 + (R0 - HW) / 2, 0, R0 - HW + 0.8, 1.4], [-(HW + 0.5 + (R0 - HW) / 2), 0, R0 - HW + 0.8, 1.4]]) {
    F.add(rbox(THREE, w, h, 1.1, 0.15), { pos: [x, y, sz], color: PAL.mint4 });
  }
  // chamber back plate + exterior shell walls (only seen at grazing angles, keep simple)
  F.add(rbox(THREE, HW * 2 + 1.6, HH * 2 + 1.6, 0.6, 0.2), { pos: [0, 0, -HD - 0.32], color: PAL.enamelDeep });
  for (const [x, y, w, h] of [[0, HH + 0.45, HW * 2 + 1.6, 0.9], [0, -HH - 0.45, HW * 2 + 1.6, 0.9], [HW + 0.45, 0, 0.9, HH * 2], [-HW - 0.45, 0, 0.9, HH * 2]]) {
    F.add(new THREE.BoxGeometry(w, h, HD * 2 - 0.1), { pos: [x, y, -0.05], color: PAL.enamel });
  }
  const frameGeo = track(F.build());
  const frame = new THREE.Mesh(frameGeo, M.paintedMetal);
  frame.castShadow = true; frame.receiveShadow = true;
  frame.name = 'drum-frame';
  root.add(frame);

  // striped corner marker (top-left) + frame signage
  const stripeTex = track(stripeTexture(THREE, { stripes: 4 }));
  const stripeMat = track(new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.5, metalness: 0.1 }));
  const marker = new THREE.Mesh(track(rbox(THREE, ft * 1.5, ft * 1.5, 0.14, 0.08)), stripeMat);
  marker.position.set(-(HW + ft / 2), HH + ft / 2, fz0 + fd + 0.05);
  marker.castShadow = true;
  root.add(marker);
  const SG = builder(THREE);
  const plate = (name, w, x, y, z) => { const r = signs.rects[name]; SG.add(atlasPlane(THREE, w, w / r.aspect, r.uv), { pos: [x, y, z] }); };
  plate('sideUp', 3.6, 0, HH + ft / 2, fz0 + fd + 0.012);
  plate('serial', 2.3, -HW + 2.6, -HH - ft / 2, fz0 + fd + 0.012);
  const signMesh = new THREE.Mesh(track(SG.build()), signs.material);
  root.add(signMesh);

  // ---------------- glass: world-fixed reflection sheen + rotating edge glint ----------------
  const gTex = track(toTexture(THREE, glassCanvas(), { repeat: true }));
  const glassMat = track(new THREE.ShaderMaterial({
    uniforms: { map: { value: gTex }, tint: { value: new THREE.Color(0xeefbff) }, strength: { value: 0.32 } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec2 vW;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xy;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform vec3 tint; uniform float strength;
      varying vec2 vUv; varying vec2 vW;
      void main() {
        // reflection streaks are fixed in world space (they slide over the turning glass)
        vec2 ruv = vec2(vW.x / 22.0 + 0.48, vW.y / 14.0 + 0.5);
        float refl = texture2D(map, ruv).r;
        // thin rim glint along the pane edges (rotates with the pane)
        vec2 e = min(vUv, 1.0 - vUv) * vec2(16.0, 10.0);
        float edge = exp(-min(e.x, e.y) * 9.0) * 0.55 + exp(-min(e.x, e.y) * 2.2) * 0.05;
        gl_FragColor = vec4(tint * (refl * strength + edge), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  const glass = new THREE.Mesh(track(new THREE.PlaneGeometry(HW * 2, HH * 2)), glassMat);
  glass.position.z = HD + 0.015;
  glass.renderOrder = 20;
  glass.name = 'drum-glass';
  root.add(glass);

  // ---------------- caged bulkhead lamps on the back wall (rotate => strong orientation cue) ----------------
  const lampMat = track(new THREE.MeshStandardMaterial({ color: 0xfffdf4, emissive: 0xfff6e0, emissiveIntensity: 1.4, roughness: 0.3 }));
  const L = builder(THREE, { colors: true });
  const lampGeo = builder(THREE);
  for (const x of [-6.4, 6.4]) {
    L.add(rbox(THREE, 1.5, 0.62, 0.16, 0.08), { pos: [x, HH - 0.7, -HD + 0.08], color: PAL.gunmetal });
    for (let i = 0; i < 4; i++) L.add(rbox(THREE, 0.05, 0.6, 0.12, 0.02), { pos: [x - 0.48 + i * 0.32, HH - 0.7, -HD + 0.27], color: PAL.steelDark });
    lampGeo.add(new THREE.CapsuleGeometry(0.17, 0.95, 3, 10), { pos: [x, HH - 0.7, -HD + 0.2], rot: [0, 0, Math.PI / 2] });
  }
  const lampFrame = new THREE.Mesh(track(L.build()), M.paintedMetal);
  const lamps = new THREE.Mesh(track(lampGeo.build()), lampMat);
  root.add(lampFrame, lamps);

  // ---------------- intake hatch ----------------
  const hatch = new THREE.Group(); hatch.name = 'hatch';
  root.add(hatch);
  const HB = builder(THREE, { colors: true });
  const ow = 2.3; const oh = 2.3; const pocket = 1.25; const bar = 0.4;
  HB.add(rbox(THREE, ow + pocket * 2, bar, 0.2, 0.08), { pos: [0, oh / 2 + bar / 2, 0.12], color: PAL.gunmetal });
  HB.add(rbox(THREE, ow + pocket * 2, bar, 0.2, 0.08), { pos: [0, -oh / 2 - bar / 2, 0.12], color: PAL.gunmetal });
  HB.add(rbox(THREE, pocket, oh + 0.02, 0.2, 0.08), { pos: [-(ow / 2 + pocket / 2), 0, 0.12], color: PAL.gunmetal });
  HB.add(rbox(THREE, pocket, oh + 0.02, 0.2, 0.08), { pos: [ow / 2 + pocket / 2, 0, 0.12], color: PAL.gunmetal });
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) HB.add(rivet(), { pos: [sx * (ow / 2 + pocket - 0.25), sy * (oh / 2 + bar / 2), 0.22], rot: [Math.PI / 2, 0, 0], color: PAL.steel });
  HB.add(new THREE.PlaneGeometry(ow, oh), { pos: [0, 0, 0.012], color: 0x161b1d });
  // chute throat (dark, receding)
  HB.add(new THREE.BoxGeometry(ow * 0.8, oh * 0.8, 0.02), { pos: [0, 0, 0.016], color: 0x0c0f10 });
  const hatchFrame = new THREE.Mesh(track(HB.build()), M.paintedMetal);
  hatchFrame.receiveShadow = true;
  hatch.add(hatchFrame);
  const stripeBorder = builder(THREE);
  stripeBorder.add(new THREE.PlaneGeometry(ow + 0.3, 0.16), { pos: [0, oh / 2 + 0.06, 0.225] });
  stripeBorder.add(new THREE.PlaneGeometry(ow + 0.3, 0.16), { pos: [0, -oh / 2 - 0.06, 0.225] });
  const hatchStripes = new THREE.Mesh(track(stripeBorder.build()), stripeMat);
  hatch.add(hatchStripes);
  const doorGeo = track(rbox(THREE, ow / 2 + 0.05, oh, 0.08, 0.04));
  const doorMat = track(new THREE.MeshStandardMaterial({ color: PAL.enamel, metalness: 0.3, roughness: 0.4 }));
  const doors = [-1, 1].map((s) => {
    const d = new THREE.Mesh(doorGeo, doorMat);
    d.position.set(s * (ow / 4), 0, 0.06);
    d.receiveShadow = true;
    hatch.add(d);
    return d;
  });
  const doorEdgeGeo = track(new THREE.BoxGeometry(0.1, oh, 0.1));
  for (const [i, s] of [[0, -1], [1, 1]]) {
    const edge = new THREE.Mesh(doorEdgeGeo, M.hazard);
    edge.position.set(-s * (ow / 4), 0, 0.02);
    doors[i].add(edge);
  }
  const hatchLampMat = track(new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: PAL.amber, emissiveIntensity: 0, roughness: 0.3 }));
  const hatchLamp = new THREE.Mesh(track(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), hatchLampMat);
  hatchLamp.rotation.x = Math.PI / 2;
  hatchLamp.position.set(ow / 2 + pocket / 2, oh / 2 + bar / 2, 0.22);
  hatch.add(hatchLamp);

  const surfaces = { back, sides: sideMesh, glass, frame, HW, HH, HD };
  ctx.drumSurfaces = surfaces;
  let t = 0;

  return {
    surfaces,
    lamps: { mat: lampMat, phase: 0.81, failAt: 0.75, base: 1.4 },
    onLevel(state) {
      const h = state.hatch;
      if (!h) { hatch.visible = false; return; }
      hatch.visible = true;
      hatch.scale.set(1, 1, 1);
      const w = h.wall; const at = h.at || 0;
      // local +z = inward wall normal, local x = wall tangent
      if (w === 'back') { hatch.position.set(h.x || 0, h.y || 0, -HD); hatch.rotation.set(0, 0, 0); }
      else if (w === 'floor') { hatch.position.set(at, -HH, 0); hatch.rotation.set(-Math.PI / 2, 0, 0); }
      else if (w === 'ceiling') { hatch.position.set(at, HH, 0); hatch.rotation.set(Math.PI / 2, 0, 0); }
      else if (w === 'left') { hatch.position.set(-HW, at, 0); hatch.rotation.set(0, Math.PI / 2, Math.PI / 2); }
      else if (w === 'right') { hatch.position.set(HW, at, 0); hatch.rotation.set(0, -Math.PI / 2, Math.PI / 2); }
    },
    update(dt, state) {
      t += dt;
      const open = state.hatch ? Math.max(0, Math.min(1, state.hatch.open)) : 0;
      const e = open * open * (3 - 2 * open);
      doors[0].position.x = -(ow / 4) - e * (ow / 2);
      doors[1].position.x = (ow / 4) + e * (ow / 2);
      hatchLampMat.emissiveIntensity = open > 0.02 ? 1.2 + 1.2 * (Math.sin(t * 10) > 0 ? 1 : 0) : 0;
    },
    setQuality() {},
    dispose() {
      drumGroup.remove(root);
      if (ctx.drumSurfaces === surfaces) ctx.drumSurfaces = null;
      for (const d of disposables) if (d && d.dispose) d.dispose();
    },
  };
}

/** Four inner walls (floor, ceiling, left, right), inward normals, UVs into the sides atlas. */
function buildSides(THREE, HW, HH, HD, atlas) {
  const { W, H, regions } = atlas;
  const pos = []; const nrm = []; const uv = []; const idx = [];
  const segA = 16; const segD = 4;
  const quad = (wall) => {
    const base = pos.length / 3;
    const [rx, ry, rw, rh] = regions[wall];
    for (let j = 0; j <= segD; j++) {
      const t = j / segD; // 0 = back (z=-HD) .. 1 = glass
      const z = -HD + t * HD * 2;
      for (let i = 0; i <= segA; i++) {
        const s = i / segA;
        let x; let y; let n;
        if (wall === 'floor') { x = -HW + s * HW * 2; y = -HH; n = [0, 1, 0]; }
        else if (wall === 'ceiling') { x = -HW + s * HW * 2; y = HH; n = [0, -1, 0]; }
        else if (wall === 'left') { x = -HW; y = -HH + s * HH * 2; n = [1, 0, 0]; }
        else { x = HW; y = HH - s * HH * 2; n = [-1, 0, 0]; }
        pos.push(x, y, z); nrm.push(...n);
        uv.push((rx + s * rw) / W, 1 - (ry + t * rh) / H);
      }
    }
    for (let j = 0; j < segD; j++) {
      for (let i = 0; i < segA; i++) {
        const a = base + j * (segA + 1) + i; const b = a + 1; const c = a + segA + 1; const d = c + 1;
        // winding so the face normal points along n (inward)
        const flip = wall === 'floor';
        if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
      }
    }
  };
  for (const w of ['floor', 'ceiling', 'left', 'right']) quad(w);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export { makeRng };
