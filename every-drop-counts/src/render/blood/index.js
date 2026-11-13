/**
 * Blood droplets + splats (VFX owns). Baseline, purely visual (the sim already credited the litres):
 *  - droplets fly ballistically in WORLD space (gravity straight down on screen), spawned from the
 *    sim's active bleeders (state.blood.bleeders) and from burst events on the bus
 *  - when a droplet hits a drum wall / the glass it becomes a persistent splat (in the drum group, so
 *    stains rotate with the drum); when it reaches the pool surface it just disappears into it.
 *
 * createBlood(ctx) -> { update(dt, state, alpha), setQuality(q), dispose() }
 */
export function createBlood(ctx) {
  const { THREE, worldGroup, drumGroup, bus } = ctx;
  const HW = 8; const HH = 5; const HD = 2.5;
  let MAXD = ctx.quality.droplets || 1200;
  let MAXS = ctx.quality.splats || 600;
  const CAP_D = 2000; const CAP_S = 900;

  const dropGeo = new THREE.IcosahedronGeometry(1, 1);
  const dropMat = new THREE.MeshStandardMaterial({ color: 0xc4001a, roughness: 0.15, metalness: 0.05, emissive: 0x250003 });
  const drops = new THREE.InstancedMesh(dropGeo, dropMat, CAP_D);
  drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  drops.frustumCulled = false; drops.count = 0;
  worldGroup.add(drops);

  const splatGeo = new THREE.CircleGeometry(1, 10);
  const splatMat = new THREE.MeshStandardMaterial({ color: 0xa30014, roughness: 0.35, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const splats = new THREE.InstancedMesh(splatGeo, splatMat, CAP_S);
  splats.frustumCulled = false; splats.count = 0;
  drumGroup.add(splats);

  // droplet SoA
  const px = new Float32Array(CAP_D); const py = new Float32Array(CAP_D); const pz = new Float32Array(CAP_D);
  const vx = new Float32Array(CAP_D); const vy = new Float32Array(CAP_D); const vz = new Float32Array(CAP_D);
  const sz = new Float32Array(CAP_D); const life = new Float32Array(CAP_D);
  let count = 0;
  let splatHead = 0; let splatCount = 0;

  const pending = [];
  const offs = [
    bus.on('blood:spurt', (p) => { if (p.pos && p.burst) pending.push({ pos: p.pos, liters: p.liters || 0.1, dir: p.dir, speed: 4 }); }),
    bus.on('limb:sever', (p) => { if (p.pos) pending.push({ pos: p.pos, liters: 0.25, speed: 5 }); }),
    bus.on('donor:death', (p) => { if (p.pos && p.cause !== 'drown') pending.push({ pos: p.pos, liters: 0.12, speed: 3 }); }),
  ];

  const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const v = new THREE.Vector3(); const s3 = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1); const nrm = new THREE.Vector3();
  let rngState = 12345;
  const rnd = () => { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 4294967296; };

  function spawnLocal(state, lx, ly, lz, lvx, lvy, lvz, size) {
    if (count >= MAXD) return;
    const th = ctx.drumAngle; const c = Math.cos(th); const s = Math.sin(th);
    const w = state.drum.omega;
    // drum-frame velocity -> world: add the drum's rotational velocity w x r
    const rvx = lvx - w * ly; const rvy = lvy + w * lx;
    const i = count++;
    px[i] = c * lx - s * ly + drumGroup.position.x; py[i] = s * lx + c * ly + drumGroup.position.y; pz[i] = lz;
    vx[i] = c * rvx - s * rvy; vy[i] = s * rvx + c * rvy; vz[i] = lvz;
    sz[i] = size; life[i] = 4;
  }

  function addSplat(lx, ly, lz, nx, ny, nz, size) {
    const i = splatHead;
    splatHead = (splatHead + 1) % MAXS;
    splatCount = Math.min(MAXS, splatCount + 1);
    nrm.set(nx, ny, nz);
    q.setFromUnitVectors(zAxis, nrm);
    const r = size * (2.2 + rnd() * 2.5);
    m4.compose(v.set(lx + nx * 0.012, ly + ny * 0.012, lz + nz * 0.012), q, s3.set(r, r * (0.6 + rnd() * 0.6), 1));
    splats.setMatrixAt(i, m4);
    splats.count = splatCount;
    splats.instanceMatrix.needsUpdate = true;
  }

  function emitBurst(state, b) {
    const n = Math.min(70, Math.round(b.liters * 160) + 6);
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2; const e = rnd() * 2 - 1; const sp = b.speed * (0.4 + rnd());
      const ce = Math.sqrt(1 - e * e);
      spawnLocal(state, b.pos[0], b.pos[1], b.pos[2], Math.cos(a) * ce * sp + state.drum.ux * 2, Math.sin(a) * ce * sp + state.drum.uy * 2, e * sp * 0.6, 0.03 + rnd() * 0.05);
    }
  }

  return {
    update(dtIn, state) {
      if (!(dtIn > 0)) return;
      const dt = Math.min(dtIn, 0.05); // big debug steps: don't teleport droplets through walls
      // sources
      while (pending.length) emitBurst(state, pending.shift());
      for (const b of state.blood.bleeders) {
        const want = b.rate * dt * 260;
        let n = Math.floor(want) + (rnd() < want % 1 ? 1 : 0);
        n = Math.min(n, 6);
        const sp = Math.min(6.5, 1.2 + b.rate * 9);
        for (let k = 0; k < n; k++) {
          spawnLocal(state, b.x, b.y, b.z,
            b.dx * sp + (rnd() - 0.5) * 1.6, b.dy * sp + (rnd() - 0.5) * 1.6, b.dz * sp + (rnd() - 0.5) * 1.6,
            0.02 + rnd() * 0.035);
        }
      }
      // integrate + collide
      const th = ctx.drumAngle; const c = Math.cos(th); const s = Math.sin(th);
      const ox = drumGroup.position.x; const oy = drumGroup.position.y;
      const level = state.pool.fill > 0.0005 ? state.pool.level : -999;
      let i = 0;
      while (i < count) {
        vy[i] -= 9.81 * dt;
        px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
        life[i] -= dt;
        const wx = px[i] - ox; const wy = py[i] - oy;
        const lx = c * wx + s * wy; const ly = -s * wx + c * wy; const lz = pz[i];
        let dead = life[i] <= 0;
        if (!dead && wy < level) dead = true; // into the pool
        else if (!dead) {
          let nx = 0; let ny = 0; let nz = 0;
          if (lx < -HW) nx = 1; else if (lx > HW) nx = -1;
          else if (ly < -HH) ny = 1; else if (ly > HH) ny = -1;
          else if (lz < -HD) nz = 1; else if (lz > HD) nz = -1;
          if (nx || ny || nz) {
            dead = true;
            if (rnd() < 0.55) addSplat(Math.max(-HW, Math.min(HW, lx)), Math.max(-HH, Math.min(HH, ly)), Math.max(-HD, Math.min(HD, lz)), nx, ny, nz, sz[i]);
          }
        }
        if (dead) {
          const j = --count;
          px[i] = px[j]; py[i] = py[j]; pz[i] = pz[j]; vx[i] = vx[j]; vy[i] = vy[j]; vz[i] = vz[j]; sz[i] = sz[j]; life[i] = life[j];
          continue;
        }
        i++;
      }
      for (let k = 0; k < count; k++) {
        const sp = Math.hypot(vx[k], vy[k], vz[k]);
        const stretch = 1 + Math.min(1.8, sp * 0.1);
        v.set(vx[k], vy[k], vz[k]);
        if (sp > 1e-3) q.setFromUnitVectors(zAxis, v.multiplyScalar(1 / sp)); else q.identity();
        m4.compose(v.set(px[k], py[k], pz[k]), q, s3.set(sz[k], sz[k], sz[k] * stretch));
        drops.setMatrixAt(k, m4);
      }
      drops.count = count;
      drops.instanceMatrix.needsUpdate = true;
    },
    onLevel() {
      count = 0; drops.count = 0; splatHead = 0; splatCount = 0; splats.count = 0; pending.length = 0;
    },
    setQuality(qq) { MAXD = Math.min(CAP_D, qq.droplets || MAXD); MAXS = Math.min(CAP_S, qq.splats || MAXS); },
    get dropletCount() { return count; },
    dispose() {
      offs.forEach((o) => o());
      worldGroup.remove(drops); drumGroup.remove(splats);
      dropGeo.dispose(); dropMat.dispose(); splatGeo.dispose(); splatMat.dispose();
    },
  };
}
