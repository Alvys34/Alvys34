import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaBelow, solveLevel, liquidPolygon, polygonArea, heightRange, localToWorld, worldToLocal } from '../src/sim/geom.js';
import { createRng } from '../src/core/rng.js';

const HW = 8; const HH = 5; const TOTAL = 4 * HW * HH;

test('level drum: surface height is linear in area', () => {
  for (const area of [0.5, 10, 40, 80, 120, 159]) {
    const s = solveLevel(0, HW, HH, area);
    assert.ok(Math.abs(s - (-HH + area / (2 * HW))) < 1e-6, `area ${area}: ${s}`);
  }
});

test('upside-down and sideways drums', () => {
  assert.ok(Math.abs(solveLevel(Math.PI, HW, HH, 32) - (-HH + 2)) < 1e-6);
  // rotated 90 deg: the 10 m side is horizontal
  assert.ok(Math.abs(solveLevel(Math.PI / 2, HW, HH, 50) - (-HW + 5)) < 1e-6);
});

test('area <-> height round trip for random angles and fills', () => {
  const rng = createRng(42);
  for (let i = 0; i < 400; i++) {
    const theta = rng.range(-10, 10);
    const area = rng.range(0, TOTAL);
    const s = solveLevel(theta, HW, HH, area);
    const back = areaBelow(theta, HW, HH, s);
    assert.ok(Math.abs(back - area) < 1e-6 * TOTAL, `theta ${theta} area ${area} -> ${back}`);
    assert.ok(s >= -heightRange(theta, HW, HH) - 1e-9 && s <= heightRange(theta, HW, HH) + 1e-9);
    const poly = liquidPolygon(theta, HW, HH, s);
    assert.ok(Math.abs(polygonArea(poly) - area) < 1e-6 * TOTAL);
  }
});

test('surface is level in the world', () => {
  const theta = 0.7; const s = solveLevel(theta, HW, HH, 60);
  const poly = liquidPolygon(theta, HW, HH, s);
  for (const [x, y] of poly) {
    const [, wy] = localToWorld(theta, x, y);
    assert.ok(wy <= s + 1e-6, 'every liquid vertex is at or below the surface');
  }
  const onSurface = poly.filter(([x, y]) => Math.abs(localToWorld(theta, x, y)[1] - s) < 1e-6);
  assert.equal(onSurface.length, 2, 'exactly one surface edge');
  const [lx, ly] = worldToLocal(theta, ...localToWorld(theta, 1.5, -2));
  assert.ok(Math.abs(lx - 1.5) < 1e-9 && Math.abs(ly + 2) < 1e-9);
});

test('edge cases: empty and full', () => {
  assert.equal(solveLevel(0.3, HW, HH, 0), -heightRange(0.3, HW, HH));
  assert.equal(solveLevel(0.3, HW, HH, TOTAL), heightRange(0.3, HW, HH));
});
