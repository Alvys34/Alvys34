/**
 * Facility backdrop (ART owns) — world space, never rotates. A calm mint/cream tiled hall around
 * the drum: support plinth + trunnion rollers + drive unit, intake chute from above, blood
 * collection plumbing into a tank with a sight gauge, observation window, PA horn, warning
 * beacon, failing fluorescent battens, signage and a few soft props.
 *
 * createFacility(ctx, M) -> { group, tubes, beacon, update(dt, state), setQuality(q, name), dispose() }
 * Static geometry is merged per material (painted / metal / signs / walls) => ~12 draw calls.
 */
import { PAL, makeRng, bloodColor } from './palette.js';
import { builder, rbox, cylZ, cylX, pipe, atlasPlane, aoPlane, aoFall } from './geo.js';
import { facilityWallCanvas, floorCanvas, toTexture } from './textures.js';

export const ROOM = { floorY: -12.4, wallZ: -16, width: 84 };

export function createFacility(ctx, M, signs) {
  const { THREE, worldGroup } = ctx;
  const group = new THREE.Group(); group.name = 'facility';
  worldGroup.add(group);
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };
  const FY = ROOM.floorY; const WZ = ROOM.wallZ; const RW = ROOM.width;
  const detail = new THREE.Group(); detail.name = 'facility-detail'; // hidden on low quality
  group.add(detail);

  // ---------------- room shell ----------------
  const wallTex = track(toTexture(THREE, facilityWallCanvas(), { repeat: true, aniso: 8 }));
  wallTex.repeat.set(RW / 4, 1);
  const wallH = 26;
  const wallMat = track(new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.62, metalness: 0 }));
  const wall = new THREE.Mesh(track(new THREE.PlaneGeometry(RW, wallH)), wallMat);
  wall.position.set(0, FY + wallH / 2, WZ);
  wall.receiveShadow = true;
  group.add(wall);

  const floorTex = track(toTexture(THREE, floorCanvas(), { repeat: true, aniso: 8 }));
  floorTex.repeat.set(RW / 2, 22);
  const floorGeo = track(aoPlane(THREE, RW, 44, 1, 22, (u, v) => aoFall((1 - v) * 44, 2.2, 0.45)));
  const floor = new THREE.Mesh(floorGeo, track(new THREE.MeshStandardMaterial({ map: floorTex, vertexColors: true, roughness: 0.42, metalness: 0 })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FY, WZ + 22);
  floor.receiveShadow = true;
  group.add(floor);

  const P = builder(THREE, { colors: true }); // painted, merged
  const Mt = builder(THREE, { colors: true }); // metal, merged
  const S = builder(THREE); // signage atlas planes
  const Pd = builder(THREE, { colors: true }); // painted detail props (low quality: hidden)
  const sign = (name, w, x, y, z, rotY = 0, rotX = 0, b = S) => {
    const r = signs.rects[name];
    b.add(atlasPlane(THREE, w, w / r.aspect, r.uv), { pos: [x, y, z], rot: [rotX, rotY, 0] });
  };

  // pilasters + chrome bumper rail + skirting
  for (const x of [-27, -12.5, 12.5, 27]) {
    P.add(rbox(THREE, 1.4, wallH, 0.7, 0.12), { pos: [x, FY + wallH / 2, WZ + 0.3], color: PAL.mint2 });
    P.add(rbox(THREE, 1.6, 0.5, 0.9, 0.1), { pos: [x, FY + 0.25, WZ + 0.4], color: PAL.mint4 });
  }
  Mt.add(cylX(THREE, 0.09, RW, 10), { pos: [0, FY + 1.1, WZ + 0.35], color: PAL.chrome });
  for (let x = -40; x <= 40; x += 4) Mt.add(rbox(THREE, 0.12, 0.12, 0.35, 0.03), { pos: [x, FY + 1.1, WZ + 0.18], color: PAL.steel });

  // ---------------- drum support: plinth, trunnion rollers, drive unit ----------------
  const RIM = 11.05; // geared rim outer radius (drum.js)
  P.add(rbox(THREE, 14, 1.4, 4.2, 0.25), { pos: [0, FY + 0.7, -4.6], color: PAL.mint3 });
  P.add(rbox(THREE, 14.4, 0.25, 4.6, 0.08), { pos: [0, FY + 0.12, -4.6], color: PAL.mint4 });
  const rollerR = 1.05;
  const rollerAngles = [-Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62];
  const rollers = [];
  const rollerGeo = track(cylZ(THREE, rollerR, rollerR, 1.0, 20));
  const rollerHubGeo = track(cylZ(THREE, 0.35, 0.35, 1.25, 12));
  const rollerSpokeGeo = track(new THREE.BoxGeometry(rollerR * 1.7, 0.18, 1.06));
  for (const a of rollerAngles) {
    const cx = Math.cos(a) * (RIM + rollerR - 0.08); const cy = Math.sin(a) * (RIM + rollerR - 0.08);
    // yellow cradle bracket from the plinth up to the roller axle
    const h = cy - (FY + 1.4);
    P.add(rbox(THREE, 2.6, Math.max(0.5, h + 0.5), 0.5, 0.12), { pos: [cx, FY + 1.4 + h / 2, -3.45], color: PAL.hazard });
    P.add(rbox(THREE, 2.6, Math.max(0.5, h + 0.5), 0.5, 0.12), { pos: [cx, FY + 1.4 + h / 2, -5.75], color: PAL.hazard });
    Mt.add(cylZ(THREE, 0.42, 0.42, 2.9, 14), { pos: [cx, cy, -4.6], color: PAL.steelDark });
    const roller = new THREE.Group();
    roller.position.set(cx, cy, -4.6);
    const body = new THREE.Mesh(rollerGeo, M.steel); body.castShadow = true; body.receiveShadow = true;
    const hub = new THREE.Mesh(rollerHubGeo, M.hazard);
    const spoke = new THREE.Mesh(rollerSpokeGeo, M.gunmetal);
    roller.add(body, hub, spoke);
    group.add(roller);
    rollers.push(roller);
  }
  // drive unit (right side): motor block, fins, gearbox, shaft to the right roller
  const du = [10.6, FY + 2.0, -6.4];
  P.add(rbox(THREE, 3.6, 3.2, 2.8, 0.3), { pos: [du[0], FY + 1.6, du[2]], color: PAL.mint4 });
  P.add(rbox(THREE, 3.0, 0.5, 2.2, 0.15), { pos: [du[0], FY + 3.45, du[2]], color: PAL.hazard });
  for (let i = 0; i < 7; i++) Mt.add(rbox(THREE, 0.08, 2.3, 2.9, 0.03), { pos: [du[0] - 1.35 + i * 0.45, FY + 1.6, du[2]], color: PAL.steel });
  Mt.add(cylX(THREE, 0.75, 1.2, 18), { pos: [du[0] - 2.3, FY + 1.7, du[2]], color: PAL.steelDark });
  Mt.add(cylZ(THREE, 0.18, 0.18, 2.0, 10), { pos: [Math.cos(rollerAngles[1]) * (RIM + rollerR), Math.sin(rollerAngles[1]) * (RIM + rollerR), -6.0], color: PAL.chrome });
  sign('pump', 1.9, du[0], FY + 2.6, du[2] + 1.42);
  sign('gauge', 0.8, du[0] + 1.1, FY + 1.3, du[2] + 1.42);
  sign('moving', 1.4, -4.6, FY + 0.72, -2.48);
  sign('moving', 1.4, 4.6, FY + 0.72, -2.48);

  // static bearing housing ring behind the rotating rim (gives the drum its round silhouette)
  const ringShape = new THREE.Shape(); ringShape.absarc(0, 0, 11.9, 0, Math.PI * 2, false);
  const ringHole = new THREE.Path(); ringHole.absarc(0, 0, 9.4, 0, Math.PI * 2, true); ringShape.holes.push(ringHole);
  P.add(new THREE.ExtrudeGeometry(ringShape, { depth: 0.6, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2, curveSegments: 72 }), { pos: [0, 0, -5.4], color: PAL.enamel });
  Mt.add(new THREE.TorusGeometry(11.92, 0.16, 8, 96), { pos: [0, 0, -4.7], color: PAL.hazard });
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    Mt.add(new THREE.SphereGeometry(0.1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), { pos: [Math.cos(a) * 11.55, Math.sin(a) * 11.55, -4.65], rot: [Math.PI / 2, 0, 0], color: PAL.gunmetal });
  }

  // ---------------- intake chute (from above, into the hollow axle) ----------------
  const chX = -0.6; const chZ = -8.2;
  P.add(rbox(THREE, 3.0, 11, 2.4, 0.5), { pos: [chX, 14.5, chZ], color: PAL.cream1 });
  P.add(rbox(THREE, 3.0, 3.0, 2.4, 0.5), { pos: [chX, 7.2, chZ + 1.0], rot: [0.55, 0, 0], color: PAL.cream1 });
  for (let i = 0; i < 6; i++) P.add(rbox(THREE, 3.3, 0.22, 2.7, 0.08), { pos: [chX, 10.0 + i * 1.6, chZ], color: PAL.mint3 });
  sign('intake', 2.4, chX, 11.8, chZ + 1.24);
  // hopper flange at the wall
  Mt.add(rbox(THREE, 3.6, 0.5, 3.0, 0.1), { pos: [chX, 13.4, chZ], color: PAL.steel });

  // ---------------- blood plumbing -> collection tank ----------------
  const tank = { x: 17.2, z: -10.5, r: 2.1, h: 7.4 };
  const tankY = FY + 0.4;
  P.add(new THREE.CylinderGeometry(tank.r, tank.r, tank.h, 28), { pos: [tank.x, tankY + tank.h / 2, tank.z], color: PAL.cream1 });
  P.add(new THREE.SphereGeometry(tank.r, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), { pos: [tank.x, tankY + tank.h, tank.z], scale: [1, 0.45, 1], color: PAL.cream1 });
  for (const yy of [0.6, tank.h * 0.5, tank.h - 0.5]) Mt.add(new THREE.CylinderGeometry(tank.r + 0.06, tank.r + 0.06, 0.22, 28), { pos: [tank.x, tankY + yy, tank.z], color: PAL.steel });
  for (const a of [0.6, 2.2, 3.8, 5.4]) Mt.add(rbox(THREE, 0.3, 0.9, 0.3, 0.06), { pos: [tank.x + Math.cos(a) * (tank.r - 0.2), FY + 0.45, tank.z + Math.sin(a) * (tank.r - 0.2)], color: PAL.gunmetal });
  sign('collected', 2.5, tank.x - 0.55, tankY + tank.h * 0.72, tank.z + tank.r + 0.02);
  // sight gauge: glass tube + blood column (scaled by fill)
  const gaugeX = tank.x + 1.05; const gaugeZ = tank.z + tank.r + 0.25; const gaugeY0 = tankY + 0.9; const gaugeH = tank.h - 1.8;
  Mt.add(cylX(THREE, 0.06, 0.6, 8), { pos: [gaugeX - 0.2, gaugeY0, gaugeZ - 0.15], color: PAL.chrome });
  Mt.add(cylX(THREE, 0.06, 0.6, 8), { pos: [gaugeX - 0.2, gaugeY0 + gaugeH, gaugeZ - 0.15], color: PAL.chrome });
  const gaugeGlass = new THREE.Mesh(track(new THREE.CylinderGeometry(0.17, 0.17, gaugeH, 14, 1, true)), track(new THREE.MeshStandardMaterial({ color: 0xeaf8f6, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2, depthWrite: false })));
  gaugeGlass.position.set(gaugeX, gaugeY0 + gaugeH / 2, gaugeZ);
  const gaugeBloodMat = track(new THREE.MeshStandardMaterial({ color: 0xb4001c, roughness: 0.2, metalness: 0.05 }));
  const gaugeBlood = new THREE.Mesh(track(new THREE.CylinderGeometry(0.13, 0.13, 1, 12)), gaugeBloodMat);
  gaugeBlood.position.set(gaugeX, gaugeY0, gaugeZ);
  gaugeGlass.renderOrder = 2;
  group.add(gaugeBlood, gaugeGlass);
  for (let i = 0; i <= 8; i++) Mt.add(rbox(THREE, i % 4 ? 0.12 : 0.22, 0.03, 0.02, 0.005), { pos: [gaugeX - 0.27, gaugeY0 + (i / 8) * gaugeH, gaugeZ + 0.12], color: PAL.ink });
  // pipes: from the hub (behind the drum) down, along the floor, up into the tank
  const pipeR = 0.32;
  Mt.add(pipe(THREE, [[0, -2, -6.6], [0, FY + 0.7, -6.6], [8.5, FY + 0.7, -9.0], [tank.x - tank.r - 0.4, FY + 0.7, tank.z], [tank.x - tank.r + 0.2, FY + 3.2, tank.z]], pipeR, { bend: 1.2 }), { color: PAL.chrome });
  Mt.add(pipe(THREE, [[1.2, -3, -7.2], [1.2, FY + 2.3, -7.2], [tank.x - 3, FY + 2.3, tank.z + 0.6], [tank.x - tank.r + 0.2, FY + 2.3, tank.z + 0.6]], pipeR * 0.6, { bend: 1.0 }), { color: PAL.steel });
  for (const p of [[0, FY + 3.6, -6.6], [4.5, FY + 0.7, -7.8], [tank.x - tank.r - 0.1, FY + 0.7, tank.z]]) {
    Mt.add(new THREE.CylinderGeometry(pipeR + 0.1, pipeR + 0.1, 0.18, 16), { pos: p, rot: p[1] > FY + 1 ? [0, 0, 0] : [0, 0.6, Math.PI / 2], color: PAL.hazard });
  }
  // valve wheel
  Mt.add(new THREE.TorusGeometry(0.45, 0.07, 6, 18), { pos: [6.6, FY + 1.4, -8.1], rot: [0, 0.4, 0], color: PAL.hazard });

  // ---------------- left: observation window ----------------
  const ow = { x: -19.5, y: FY + 7.4, w: 7.2, h: 3.4 };
  P.add(rbox(THREE, ow.w + 0.7, ow.h + 0.7, 0.5, 0.16), { pos: [ow.x, ow.y, WZ + 0.12], color: PAL.mint4 });
  P.add(new THREE.BoxGeometry(ow.w, ow.h, 0.2), { pos: [ow.x, ow.y, WZ + 0.2], color: 0x2a3c40 }); // dark room behind
  P.add(rbox(THREE, ow.w + 0.9, 0.22, 0.7, 0.06), { pos: [ow.x, ow.y - ow.h / 2 - 0.25, WZ + 0.35], color: PAL.cream1 });
  // blinds (half drawn) + a monitor glow inside
  for (let i = 0; i < 9; i++) Pd.add(new THREE.BoxGeometry(ow.w - 0.1, 0.12, 0.04), { pos: [ow.x, ow.y + ow.h / 2 - 0.15 - i * 0.2, WZ + 0.36], rot: [0.5, 0, 0], color: 0xe9eee8 });
  Pd.add(new THREE.BoxGeometry(1.2, 0.8, 0.05), { pos: [ow.x + 1.8, ow.y - 0.9, WZ + 0.32], color: 0x8fe3cc });
  Pd.add(new THREE.BoxGeometry(0.15, 0.4, 0.05), { pos: [ow.x + 1.8, ow.y - 1.45, WZ + 0.32], color: 0x34474a });
  Pd.add(new THREE.SphereGeometry(0.42, 12, 8), { pos: [ow.x - 1.6, ow.y - 1.0, WZ + 0.3], scale: [1, 1.1, 0.4], color: 0x34474a }); // a silhouette: someone watching
  Pd.add(new THREE.SphereGeometry(0.62, 12, 8), { pos: [ow.x - 1.6, ow.y - 1.9, WZ + 0.3], scale: [1.2, 0.8, 0.4], color: 0x34474a });
  const owGlass = new THREE.Mesh(track(new THREE.PlaneGeometry(ow.w, ow.h)), track(new THREE.MeshStandardMaterial({ color: 0x9fc4c8, transparent: true, opacity: 0.38, roughness: 0.04, metalness: 0.4, depthWrite: false })));
  owGlass.position.set(ow.x, ow.y, WZ + 0.42);
  detail.add(owGlass);
  sign('staffOnly', 3.8, ow.x, ow.y - ow.h / 2 - 0.85, WZ + 0.06);
  sign('slogan', 8.4, -19.6, FY + 15.4, WZ + 0.06);
  sign('calm', 5.0, -19.6, FY + 13.6, WZ + 0.06);
  sign('poster', 2.4, -24.8, FY + 4.4, WZ + 0.06);
  sign('main', 15, 0, FY + 24.2, WZ + 0.06);
  sign('complaints', 3.6, 20.2, FY + 13.2, WZ + 0.06);
  sign('clock', 2.0, 15.6, FY + 15.6, WZ + 0.08);
  P.add(new THREE.CylinderGeometry(1.06, 1.06, 0.2, 32), { pos: [15.6, FY + 15.6, WZ + 0.0], rot: [Math.PI / 2, 0, 0], color: PAL.steelDark });

  // ---------------- PA horn speaker + conduit ----------------
  const pa = [-12.5, FY + 21.0, WZ + 1.1];
  P.add(rbox(THREE, 0.5, 0.9, 1.4, 0.1), { pos: [pa[0], pa[1] + 0.2, WZ + 0.7], color: PAL.steelDark });
  const horn = new THREE.CylinderGeometry(0.75, 0.22, 1.4, 16, 1, true);
  P.add(horn, { pos: [pa[0], pa[1], pa[2] + 0.4], rot: [Math.PI / 2 + 0.35, 0, 0.25], color: PAL.cream1 });
  P.add(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 12), { pos: [pa[0], pa[1] + 0.2, pa[2] - 0.35], rot: [Math.PI / 2 + 0.35, 0, 0.25], color: PAL.mint3 });
  Mt.add(cylX(THREE, 0.07, 11, 6), { pos: [pa[0] - 5.5, pa[1] + 0.9, WZ + 0.12], color: PAL.steel });
  P.add(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 6), { pos: [pa[0], pa[1] + 0.9 - 0.25, WZ + 0.12], color: PAL.steel });

  // ---------------- warning beacon (top right) ----------------
  const bp = [12.5, FY + 22.6, WZ + 0.9];
  P.add(rbox(THREE, 0.9, 0.35, 0.9, 0.08), { pos: [bp[0], bp[1] - 0.45, bp[2]], color: PAL.steelDark });
  P.add(rbox(THREE, 0.3, 0.2, 1.0, 0.05), { pos: [bp[0], bp[1] - 0.45, WZ + 0.4], color: PAL.steelDark });
  const domeMat = track(new THREE.MeshStandardMaterial({ color: 0xf2efe8, emissive: PAL.emergency, emissiveIntensity: 0, roughness: 0.15, transparent: true, opacity: 0.85 }));
  const dome = new THREE.Mesh(track(new THREE.SphereGeometry(0.42, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2)), domeMat);
  dome.position.set(bp[0], bp[1] - 0.3, bp[2]);
  dome.scale.set(1, 1.5, 1);
  const spinner = new THREE.Group();
  spinner.position.set(bp[0], bp[1] - 0.05, bp[2]);
  const reflector = new THREE.Mesh(track(new THREE.BoxGeometry(0.5, 0.35, 0.05)), M.chrome);
  reflector.position.z = 0.1;
  spinner.add(reflector);
  group.add(dome, spinner);

  // ---------------- failing fluorescent battens ----------------
  const tubeMats = [0, 1, 2].map(() => track(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4fffb, emissiveIntensity: 1.6, roughness: 0.4 })));
  const tubeGeo = track(new THREE.CapsuleGeometry(0.13, 4.2, 4, 10)); tubeGeo.rotateZ(Math.PI / 2);
  const battenAt = [[-21.5, 0], [-8.5, 1], [8.5, 2], [21.5, 0]];
  const tubes = [];
  for (const [x, mi] of battenAt) {
    P.add(rbox(THREE, 5.0, 0.45, 0.5, 0.1), { pos: [x, FY + 25.2, WZ + 0.3], color: PAL.cream0 });
    const tube = new THREE.Mesh(tubeGeo, tubeMats[mi]);
    tube.position.set(x, FY + 24.85, WZ + 0.45);
    group.add(tube);
  }
  tubeMats.forEach((mat, i) => tubes.push({ mat, phase: i * 0.37, failAt: [0.45, 0.3, 0.62][i], base: 1.7 }));

  // ---------------- soft props ----------------
  const rng = makeRng(42);
  // left: waiting bench, folded gowns, water cooler, cookie table, plant
  const bx = -17; const bz = -13.4;
  P.add(rbox(THREE, 4.2, 0.28, 1.1, 0.12), { pos: [bx, FY + 1.0, bz], color: PAL.mint3 });
  P.add(rbox(THREE, 4.2, 1.0, 0.22, 0.1), { pos: [bx, FY + 1.6, bz - 0.5], rot: [-0.12, 0, 0], color: PAL.mint3 });
  for (const sx of [-1.8, 1.8]) Mt.add(rbox(THREE, 0.12, 1.0, 0.9, 0.04), { pos: [bx + sx, FY + 0.5, bz], color: PAL.chrome });
  const gownCols = [0x63c9a6, 0x6fb0ec, 0xf3a865, 0xa58be0];
  for (let i = 0; i < 4; i++) Pd.add(rbox(THREE, 0.9, 0.16, 0.7, 0.06), { pos: [bx + 1.0, FY + 1.22 + i * 0.16, bz + 0.05], rot: [0, (rng() - 0.5) * 0.3, 0], color: gownCols[i] });
  // water cooler
  const wc = [-22.2, bz + 0.2];
  P.add(rbox(THREE, 1.0, 2.4, 1.0, 0.15), { pos: [wc[0], FY + 1.2, wc[1]], color: PAL.cream0 });
  Pd.add(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 16), { pos: [wc[0], FY + 2.95, wc[1]], color: 0x9ccbe8 });
  Pd.add(new THREE.SphereGeometry(0.42, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), { pos: [wc[0], FY + 3.5, wc[1]], color: 0x9ccbe8 });
  Pd.add(rbox(THREE, 0.3, 0.12, 0.2, 0.03), { pos: [wc[0], FY + 1.7, wc[1] + 0.55], color: PAL.sky });
  // cookie table (empty plate, card)
  const ct = [-12.4, -12.2];
  P.add(new THREE.CylinderGeometry(1.0, 1.0, 0.12, 24), { pos: [ct[0], FY + 1.5, ct[1]], color: PAL.cream0 });
  Mt.add(new THREE.CylinderGeometry(0.09, 0.14, 1.45, 10), { pos: [ct[0], FY + 0.75, ct[1]], color: PAL.chrome });
  Mt.add(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 18), { pos: [ct[0], FY + 0.03, ct[1]], color: PAL.steel });
  Pd.add(new THREE.CylinderGeometry(0.5, 0.36, 0.06, 24), { pos: [ct[0] - 0.15, FY + 1.59, ct[1] + 0.1], color: 0xffffff });
  Pd.add(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 10), { pos: [ct[0] - 0.05, FY + 1.63, ct[1] + 0.18], color: 0xd8b98a }); // crumbs
  Pd.add(rbox(THREE, 0.06, 0.32, 0.6, 0.02), { pos: [ct[0] + 0.55, FY + 1.72, ct[1] + 0.1], rot: [0, -1.2, 0.25], color: 0xffffff });
  sign('cookies', 0.62, ct[0] + 0.6, FY + 1.74, ct[1] + 0.12, -1.2 + Math.PI / 2);
  // potted plant
  const pp = [-25.3, -12.6];
  P.add(new THREE.CylinderGeometry(0.75, 0.55, 1.3, 14), { pos: [pp[0], FY + 0.65, pp[1]], color: PAL.cream1 });
  P.add(new THREE.CylinderGeometry(0.8, 0.8, 0.14, 14), { pos: [pp[0], FY + 1.3, pp[1]], color: PAL.mint3 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rng(); const tilt = 0.45 + rng() * 0.4;
    const leaf = new THREE.SphereGeometry(0.38, 7, 5);
    Pd.add(leaf, { pos: [pp[0] + Math.cos(a) * 0.5, FY + 2.1 + rng() * 0.6, pp[1] + Math.sin(a) * 0.5], rot: [Math.sin(a) * tilt, a, Math.cos(a) * tilt], scale: [0.55, 1.6, 0.25], color: i % 2 ? 0x5fae7c : 0x4b9a6c });
  }
  // right: wet-floor A-frame, mop bucket, O2 rack
  const wf = [12.6, -10.6];
  for (const s of [-1, 1]) {
    P.add(rbox(THREE, 1.1, 1.7, 0.06, 0.03), { pos: [wf[0], FY + 0.82, wf[1] + s * 0.25], rot: [s * 0.28, 0, 0], color: PAL.hazard });
  }
  sign('wetFloor', 1.0, wf[0], FY + 0.85, wf[1] + 0.3, 0, -0.28);
  Pd.add(new THREE.CylinderGeometry(0.55, 0.45, 0.8, 14), { pos: [13.9, FY + 0.4, -11.6], color: PAL.hazard });
  Mt.add(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), { pos: [14.0, FY + 1.6, -11.6], rot: [0, 0, 0.3], color: PAL.steel });
  for (let i = 0; i < 3; i++) {
    const ox = 21.8 + i * 1.0;
    Pd.add(new THREE.CylinderGeometry(0.36, 0.36, 2.6, 14), { pos: [ox, FY + 1.3, -13.8], color: PAL.mint3 });
    Pd.add(new THREE.SphereGeometry(0.36, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), { pos: [ox, FY + 2.6, -13.8], color: 0xf6f8f6 });
    Mt.add(new THREE.CylinderGeometry(0.08, 0.1, 0.35, 8), { pos: [ox, FY + 3.05, -13.8], color: PAL.chrome });
  }
  Mt.add(cylX(THREE, 0.06, 3.4, 6), { pos: [22.8, FY + 1.9, -13.35], color: PAL.steel });

  // ---------------- build merged meshes ----------------
  const add = (geo, mat, { cast = false, receive = true, parent = group } = {}) => {
    if (!geo) return null;
    track(geo);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = receive;
    m.matrixAutoUpdate = false; m.updateMatrix();
    parent.add(m);
    return m;
  };
  add(P.build(), M.painted, { cast: true });
  add(Mt.build(), M.paintedMetal, { cast: true });
  add(Pd.build(), M.painted, { parent: detail });
  add(S.build(), signs.material);

  const tmpC = new THREE.Color();
  let gaugeLevel = 0;
  return {
    group, tubes,
    beacon: { spinner, dome: domeMat, pos: [bp[0], bp[1], bp[2] + 0.4] },
    update(dt, state) {
      // trunnion rollers roll against the geared rim
      const k = RIM / rollerR;
      for (const r of rollers) r.rotation.z = -ctx.drumAngle * k;
      // collection tank gauge follows the tank fill (blood tint)
      const fill = state && state.pool ? Math.min(1, state.pool.fill / 0.82) : 0;
      gaugeLevel += (fill - gaugeLevel) * Math.min(1, dt * 2);
      const h = Math.max(0.02, gaugeLevel * gaugeH);
      gaugeBlood.scale.y = h;
      gaugeBlood.position.y = gaugeY0 + h / 2;
      bloodColor(ctx, tmpC);
      if (!gaugeBloodMat.color.equals(tmpC)) gaugeBloodMat.color.copy(tmpC);
    },
    setQuality(q, name) {
      detail.visible = name !== 'low';
    },
    dispose() {
      worldGroup.remove(group);
      for (const d of disposables) if (d && d.dispose) d.dispose();
    },
  };
}
