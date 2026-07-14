/**
 * Test: Cylinder mesh with a 3-bone spine chain.
 *
 * This simulates the core problem we're solving: a torso-like cylinder
 * with bones running through its center. With Euclidean distance, the
 * middle bone (Spine) gets starved because it's furthest from the surface.
 * With geodesic distance, it should get proper influence on the middle ring.
 *
 * Validates:
 *   1. Central bone (Spine) gets meaningful influence (NOT starved)
 *   2. Top/bottom vertices favor their nearest bone
 *   3. Middle vertices properly blend between bones
 */

import { computeSkinWeights } from '../src/index.js';

// ── Build a cylinder: 8 rings of 16 vertices, capped ──
const RINGS = 8;
const SEGMENTS = 16;
const RADIUS = 0.3;
const HEIGHT = 2.0;  // -1.0 to +1.0

const verts = [];
const tris = [];

// Side vertices
for (let r = 0; r <= RINGS; r++) {
  const y = -HEIGHT / 2 + (r / RINGS) * HEIGHT;
  for (let s = 0; s < SEGMENTS; s++) {
    const angle = (s / SEGMENTS) * Math.PI * 2;
    verts.push(
      Math.cos(angle) * RADIUS,
      y,
      Math.sin(angle) * RADIUS
    );
  }
}

// Side faces
for (let r = 0; r < RINGS; r++) {
  for (let s = 0; s < SEGMENTS; s++) {
    const curr = r * SEGMENTS + s;
    const next = r * SEGMENTS + (s + 1) % SEGMENTS;
    const currUp = (r + 1) * SEGMENTS + s;
    const nextUp = (r + 1) * SEGMENTS + (s + 1) % SEGMENTS;

    tris.push(curr, next, currUp);
    tris.push(next, nextUp, currUp);
  }
}

// Cap centers
const bottomCenter = verts.length / 3;
verts.push(0, -HEIGHT / 2, 0);
const topCenter = verts.length / 3;
verts.push(0, HEIGHT / 2, 0);

// Bottom cap
for (let s = 0; s < SEGMENTS; s++) {
  tris.push(bottomCenter, (s + 1) % SEGMENTS, s);
}
// Top cap
const topRing = RINGS * SEGMENTS;
for (let s = 0; s < SEGMENTS; s++) {
  tris.push(topCenter, topRing + s, topRing + (s + 1) % SEGMENTS);
}

const positions = new Float32Array(verts);
const indices = new Uint32Array(tris);

// 3-bone spine chain through the cylinder center
// Simulates: Hips → Spine → Chest
const bones = [
  { head: [0, -0.9, 0], tail: [0, -0.3, 0] },  // Bone 0: "Hips" (bottom)
  { head: [0, -0.3, 0], tail: [0, 0.3, 0] },    // Bone 1: "Spine" (center)
  { head: [0, 0.3, 0], tail: [0, 0.9, 0] },     // Bone 2: "Chest" (top)
];

console.log('═══════════════════════════════════════════');
console.log(' @poqpoq/voxel-skinner — Cylinder Test');
console.log(' (Central Bone Starvation Validation)');
console.log('═══════════════════════════════════════════\n');

console.log(`Mesh: ${Math.floor(positions.length / 3)} vertices, ${Math.floor(indices.length / 3)} triangles`);
console.log(`Bones: Hips (y: -0.9 to -0.3), Spine (y: -0.3 to 0.3), Chest (y: 0.3 to 0.9)\n`);

const result = computeSkinWeights(positions, indices, bones, {
  resolution: 32,
  onProgress: (stage, detail) => {
    if (stage === 'voxelize') process.stdout.write('  Voxelizing...\r');
    if (stage === 'geodesic') process.stdout.write(`  Geodesic: bone ${detail.boneIndex + 1}/${detail.totalBones}\r`);
    if (stage === 'extract') process.stdout.write('  Extracting weights...\r');
  },
});

console.log(`\nStats: ${JSON.stringify(result.stats.timing)}ms`);
console.log(`Grid: ${result.stats.resolution}`);
console.log(`Voxels: boundary=${result.stats.voxels.boundary}, interior=${result.stats.voxels.interior}\n`);

// ── Analyze weights by ring height ──
console.log('Weight distribution by ring:\n');
console.log('  Ring  │  Y     │ Hips    │ Spine   │ Chest   │ Primary');
console.log('  ──────┼────────┼─────────┼─────────┼─────────┼────────');

const boneInfluences = [0, 0, 0]; // Total influence per bone across all vertices

for (let r = 0; r <= RINGS; r++) {
  const y = -HEIGHT / 2 + (r / RINGS) * HEIGHT;
  let avgWeights = [0, 0, 0];
  let count = 0;

  for (let s = 0; s < SEGMENTS; s++) {
    const v = r * SEGMENTS + s;
    if (v >= Math.floor(positions.length / 3)) continue;

    const base = v * 4;
    for (let i = 0; i < 4; i++) {
      const boneIdx = result.skinIndices[base + i];
      const weight = result.skinWeights[base + i];
      if (boneIdx < 3) {
        avgWeights[boneIdx] += weight;
        boneInfluences[boneIdx] += weight;
      }
    }
    count++;
  }

  if (count > 0) {
    avgWeights = avgWeights.map(w => w / count);
  }

  const primary = avgWeights.indexOf(Math.max(...avgWeights));
  const names = ['Hips', 'Spine', 'Chest'];

  console.log(
    `  ${String(r).padStart(4)}  │ ${y.toFixed(2).padStart(6)} │ ${avgWeights[0].toFixed(3).padStart(7)} │ ${avgWeights[1].toFixed(3).padStart(7)} │ ${avgWeights[2].toFixed(3).padStart(7)} │ ${names[primary]}`
  );
}

// ── Central Bone Starvation Check ──
console.log('\n── Central Bone Starvation Check ──');

const totalInfluence = boneInfluences[0] + boneInfluences[1] + boneInfluences[2];
const spineShare = boneInfluences[1] / totalInfluence;

console.log(`  Hips total influence:  ${boneInfluences[0].toFixed(2)} (${(boneInfluences[0] / totalInfluence * 100).toFixed(1)}%)`);
console.log(`  Spine total influence: ${boneInfluences[1].toFixed(2)} (${(spineShare * 100).toFixed(1)}%)`);
console.log(`  Chest total influence: ${boneInfluences[2].toFixed(2)} (${(boneInfluences[2] / totalInfluence * 100).toFixed(1)}%)`);

// Spine should get roughly 1/3 of total influence (it covers the middle third)
if (spineShare > 0.15) {
  console.log(`\n  ✅ PASS: Spine bone has ${(spineShare * 100).toFixed(1)}% influence (>15% threshold)`);
  console.log('  Central bone starvation is NOT present!');
} else {
  console.log(`\n  ❌ FAIL: Spine bone has only ${(spineShare * 100).toFixed(1)}% influence (<15%)`);
  console.log('  Central bone starvation detected!');
}

console.log('\n═══════════════════════════════════════════\n');
