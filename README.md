# @poqpoq/voxel-skinner

Voxel geodesic skin weight computation for 3D character meshes.

The first standalone browser-native JavaScript library for automatic skin weight computation using volumetric geodesic distance. No native dependencies, no WASM, no GPU required.

> _Part of the [BlackBox creative suite](https://poqpoq.com) by [p0qp0q](https://poqpoq.com) — AI-first tools for rigging, animating, and populating 3D worlds._

## The Problem

Distance-based skin weight solvers use Euclidean (straight-line) distance from bones to vertices. This causes **central bone starvation** -- interior bones like Hips, Spine, and Chest get near-zero influence because they're geometrically far from the mesh surface, even though they should control large body regions.

## The Solution

This library voxelizes the mesh interior and computes **geodesic distances** (shortest paths through the volume) from each bone to every vertex. Heat from a bone deep inside the pelvis flows through the mesh interior to reach pelvis skin vertices -- it doesn't need to fly through empty space.

Based on: Dionne & de Lasa, "Geodesic Voxel Binding for Production Character Meshing" (SCA 2013). This is the same approach used by Autodesk Maya's geodesic voxel binding.

## Quick Start

```js
import { computeSkinWeights } from '@poqpoq/voxel-skinner';

// positions: Float32Array [x,y,z, x,y,z, ...]
// indices: Uint32Array [i0,i1,i2, ...] (triangle indices)
// bones: array of { head: [x,y,z], tail: [x,y,z] }

const result = computeSkinWeights(positions, indices, bones, {
  resolution: 64,     // voxel grid resolution (32=fast, 64=good, 128=high quality)
  maxInfluences: 4,   // max bone influences per vertex (standard for real-time)
  smoothing: 0.1,     // weight falloff smoothing (0=sharp, 1=very smooth)
});

// result.skinIndices  — Uint16Array, 4 bone indices per vertex
// result.skinWeights  — Float32Array, 4 weight values per vertex
// result.stats        — timing, voxel counts, resolution info
```

## Output Format

The output matches the standard glTF / Three.js / Babylon.js skinning convention:

- **skinIndices**: `Uint16Array` of length `vertexCount * 4` -- bone indices
- **skinWeights**: `Float32Array` of length `vertexCount * 4` -- normalized weights (sum to 1.0)

These can be directly applied to a `THREE.SkinnedMesh`, exported to GLB, or used with any engine that supports standard skeletal animation.

## Pipeline

```
Mesh Triangles ──> Voxelizer ──> GeodesicSolver ──> WeightExtractor ──> Skin Weights
                    │                │                    │
                    ▼                ▼                    ▼
              Classified        Distance fields      skinIndices +
              voxel grid        per bone             skinWeights
              (INTERIOR/        (Dijkstra on         (normalized,
               BOUNDARY/         voxel grid)          thresholded)
               EMPTY)
```

### Modules

| Module | Purpose |
|--------|---------|
| `VoxelGrid` | 3D grid data structure (flat typed arrays, Web Worker transferable) |
| `Voxelizer` | Triangle mesh to classified voxel grid (SAT intersection + flood fill) |
| `GeodesicSolver` | Dijkstra shortest paths from bones through voxel volume |
| `WeightExtractor` | Distance fields to normalized per-vertex skin weights |

Each module can be used independently:

```js
import { voxelize } from '@poqpoq/voxel-skinner/Voxelizer';
import { computeGeodesicDistances } from '@poqpoq/voxel-skinner/GeodesicSolver';
import { extractWeights } from '@poqpoq/voxel-skinner/WeightExtractor';
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `resolution` | 64 | Voxels along longest mesh axis. 32=fast, 64=balanced, 128=high quality |
| `maxInfluences` | 4 | Max bone influences per vertex (4 is standard for real-time) |
| `smoothing` | 0.1 | Weight falloff curve. 0=sharp boundaries, 1=very gradual blending |
| `threshold` | 0.01 | Minimum weight to keep (below is zeroed and renormalized) |
| `use26Connected` | false | Use 26-neighbor connectivity instead of 6. More accurate, ~4x slower |
| `onProgress` | null | Callback `(stage, detail)` for UI progress reporting |

## Performance

Tested on a 146-vertex cylinder with 3 bones at resolution 32:

| Stage | Time |
|-------|------|
| Voxelize | 7ms |
| Geodesic (3 bones) | 7ms |
| Extract weights | 1ms |
| **Total** | **14ms** |

For production characters (~10K vertices, 72 bones, resolution 64), expect ~2-8 seconds on CPU. Bones are computed sequentially but are fully independent -- Web Worker parallelism is straightforward.

## Validation: Central Bone Starvation

The cylinder test demonstrates the core fix. Three bones through a cylinder center (simulating Hips/Spine/Chest):

```
Ring  │  Y     │ Hips    │ Spine   │ Chest   │ Primary
──────┼────────┼─────────┼─────────┼─────────┼────────
   0  │  -1.00 │   0.884 │   0.086 │   0.030 │ Hips
   1  │  -0.75 │   0.806 │   0.152 │   0.041 │ Hips
   2  │  -0.50 │   0.635 │   0.312 │   0.053 │ Hips
   3  │  -0.25 │   0.463 │   0.463 │   0.073 │ Hips
   4  │   0.00 │   0.174 │   0.602 │   0.223 │ Spine
   5  │   0.25 │   0.073 │   0.463 │   0.463 │ Spine
   6  │   0.50 │   0.053 │   0.312 │   0.635 │ Chest
   7  │   0.75 │   0.041 │   0.152 │   0.806 │ Chest
   8  │   1.00 │   0.030 │   0.086 │   0.884 │ Chest
```

**Spine gets 29.2% of total influence** (expected ~33% for middle third coverage). With Euclidean distance, Spine would get close to 0%.

## Integration with Three.js

```js
import { computeSkinWeights } from '@poqpoq/voxel-skinner';

// After loading an unrigged mesh and creating a skeleton:
const geometry = mesh.geometry;
const positions = geometry.attributes.position.array;
const indices = geometry.index?.array || null;

// Extract bone head/tail from your skeleton
const bones = skeleton.bones.map(bone => {
  const head = new THREE.Vector3();
  const tail = new THREE.Vector3();
  bone.getWorldPosition(head);
  // Tail = first child's position, or head + bone direction
  if (bone.children.length > 0) {
    bone.children[0].getWorldPosition(tail);
  } else {
    tail.copy(head).add(new THREE.Vector3(0, 0.1, 0));
  }
  return { head: head.toArray(), tail: tail.toArray() };
});

const { skinIndices, skinWeights } = computeSkinWeights(positions, indices, bones);

// Apply to geometry
geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
```

## Known limitations

- **Nearest-voxel weight sampling** — each vertex reads the geodesic distance of the single voxel it occupies, so very dense meshes at low `resolution` can show slight faceting at bone boundaries. Raise `resolution`, or watch for trilinear field sampling (roadmap).
- **Sequential bone solve** — distance fields are computed one bone at a time on the CPU. They're fully independent, so Web Worker parallelism is the natural speedup (roadmap).
- **Safety cap** — grids above ~64M voxels (`resolution` far beyond 128 on a cubic mesh) throw a `RangeError` rather than risk an out-of-memory crash.

## Roadmap

- **v0.2**: Web Worker support (parallel bone distance computation) + trilinear weight sampling
- **v0.3**: WebGL2 GPU acceleration (GPGPU ping-pong for distance crawl)
- **v0.4**: WebGPU compute shader path
- **v1.0**: Ray-cast visibility gating (Blender-style normal-weighted distance)

## References

- Dionne & de Lasa, "Geodesic Voxel Binding for Production Character Meshing" (SCA 2013)
- Baran & Popovic, "Automatic Rigging and Animation of 3D Characters" (SIGGRAPH 2007)
- Akenine-Moller, "Fast 3D Triangle-Box Overlap Testing" (2001)
- [SketchPunk Labs autoskinning](https://github.com/sketchpunklabs/autoskinning) -- GPU reference implementation

## License

MIT © [Allen Partridge (p0qp0q)](https://poqpoq.com)

Built as part of the [BlackBox creative suite](https://poqpoq.com) — see also [Animator](https://poqpoq.com/animator/) (GLB animation + IK) and [Skinner](https://poqpoq.com/skinner/) (vertex weight painting).
