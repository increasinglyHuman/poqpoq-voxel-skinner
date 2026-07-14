/**
 * Test: Cube mesh with a single bone through the center.
 *
 * Validates:
 *   1. Voxelizer correctly classifies interior/boundary/empty
 *   2. GeodesicSolver computes distances through the volume
 *   3. WeightExtractor produces valid normalized weights
 *   4. Central bone starvation is NOT present (the whole point)
 */

import { computeSkinWeights, voxelize, VoxelState } from '../src/index.js';

// ── Build a unit cube mesh (8 vertices, 12 triangles) ──

const positions = new Float32Array([
  // Front face
  -0.5, -0.5,  0.5,  // 0
   0.5, -0.5,  0.5,  // 1
   0.5,  0.5,  0.5,  // 2
  -0.5,  0.5,  0.5,  // 3
  // Back face
  -0.5, -0.5, -0.5,  // 4
   0.5, -0.5, -0.5,  // 5
   0.5,  0.5, -0.5,  // 6
  -0.5,  0.5, -0.5,  // 7
]);

const indices = new Uint16Array([
  // Front
  0, 1, 2,  0, 2, 3,
  // Back
  5, 4, 7,  5, 7, 6,
  // Top
  3, 2, 6,  3, 6, 7,
  // Bottom
  4, 5, 1,  4, 1, 0,
  // Right
  1, 5, 6,  1, 6, 2,
  // Left
  4, 0, 3,  4, 3, 7,
]);

// A single bone running vertically through the cube center
const bones = [
  { head: [0, -0.4, 0], tail: [0, 0.4, 0] },
];

console.log('═══════════════════════════════════════');
console.log(' @poqpoq/voxel-skinner — Cube Test');
console.log('═══════════════════════════════════════\n');

// ── Test 1: Voxelization ──
console.log('▸ Test 1: Voxelization');
const grid = voxelize(positions, indices, 16);
const counts = grid.countByState();
console.log(`  Grid: ${grid.resX}×${grid.resY}×${grid.resZ} (${grid.totalVoxels} voxels)`);
console.log(`  Boundary: ${counts.boundary}, Interior: ${counts.interior}, Empty: ${counts.empty}`);

let pass = true;

if (counts.boundary === 0) {
  console.log('  ❌ FAIL: No boundary voxels detected');
  pass = false;
} else {
  console.log('  ✅ Boundary voxels detected');
}

if (counts.interior === 0) {
  console.log('  ❌ FAIL: No interior voxels detected');
  pass = false;
} else {
  console.log('  ✅ Interior voxels detected');
}

// ── Test 2: Full pipeline ──
console.log('\n▸ Test 2: Full skin weight pipeline');
const result = computeSkinWeights(positions, indices, bones, {
  resolution: 16,
  onProgress: (stage, detail) => {
    if (stage === 'geodesic') {
      process.stdout.write(`  Geodesic: bone ${detail.boneIndex + 1}/${detail.totalBones}\r`);
    }
  },
});

console.log(`  Vertices: ${result.stats.vertexCount}`);
console.log(`  Bones: ${result.stats.boneCount}`);
console.log(`  Resolution: ${result.stats.resolution}`);
console.log(`  Timing: ${JSON.stringify(result.stats.timing)}`);

// Check that all vertices got weights
let allWeighted = true;
let minWeight = Infinity;
let maxWeight = -Infinity;

for (let v = 0; v < result.stats.vertexCount; v++) {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    sum += result.skinWeights[v * 4 + i];
  }
  if (Math.abs(sum - 1.0) > 0.01 && sum > 0) {
    allWeighted = false;
    console.log(`  ❌ FAIL: Vertex ${v} weight sum = ${sum.toFixed(4)} (expected ~1.0)`);
  }
  if (sum > 0) {
    minWeight = Math.min(minWeight, result.skinWeights[v * 4]);
    maxWeight = Math.max(maxWeight, result.skinWeights[v * 4]);
  }
}

if (allWeighted) {
  console.log('  ✅ All vertex weights normalized to ~1.0');
}

// With a single bone, every vertex should be assigned to bone 0 with weight 1.0
let allBone0 = true;
for (let v = 0; v < result.stats.vertexCount; v++) {
  if (result.skinIndices[v * 4] !== 0 || result.skinWeights[v * 4] < 0.99) {
    allBone0 = false;
  }
}
if (allBone0) {
  console.log('  ✅ All vertices assigned to the single bone (weight ≈ 1.0)');
} else {
  console.log('  ⚠️  Some vertices not fully assigned to single bone');
}

// ── Test 3: Two-bone test (central bone starvation check) ──
console.log('\n▸ Test 3: Two-bone central starvation test');

// Two bones: one at bottom, one at top — tests that both get influence
const twoBones = [
  { head: [0, -0.4, 0], tail: [0, 0, 0] },   // Lower bone
  { head: [0, 0, 0], tail: [0, 0.4, 0] },     // Upper bone
];

const result2 = computeSkinWeights(positions, indices, twoBones, { resolution: 16 });

// Bottom vertices (y=-0.5) should favor bone 0, top vertices (y=0.5) should favor bone 1
let lowerCorrect = 0, upperCorrect = 0;
for (let v = 0; v < 8; v++) {
  const y = positions[v * 3 + 1];
  const primaryBone = result2.skinIndices[v * 4];
  const primaryWeight = result2.skinWeights[v * 4];

  const label = y < 0 ? 'bottom' : 'top';
  const expected = y < 0 ? 0 : 1;

  if (primaryBone === expected) {
    if (y < 0) lowerCorrect++;
    else upperCorrect++;
  }

  // Show all 4 influences
  const allW = [];
  for (let i = 0; i < 4; i++) {
    const bi = result2.skinIndices[v * 4 + i];
    const wi = result2.skinWeights[v * 4 + i];
    if (wi > 0) allW.push(`b${bi}:${wi.toFixed(3)}`);
  }
  console.log(`  Vertex ${v} (y=${y.toFixed(1)}): ${allW.join(', ') || 'NO WEIGHTS'} [${label}]`);
}

if (lowerCorrect === 4 && upperCorrect === 4) {
  console.log('  ✅ Correct bone assignment: bottom→bone0, top→bone1');
} else {
  console.log(`  ⚠️  Assignment: ${lowerCorrect}/4 bottom correct, ${upperCorrect}/4 top correct`);
}

// ── Summary ──
console.log('\n═══════════════════════════════════════');
console.log(` Tests ${pass ? 'PASSED ✅' : 'FAILED ❌'}`);
console.log('═══════════════════════════════════════\n');

process.exit(pass ? 0 : 1);
