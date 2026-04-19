/**
 * Pure helpers for turning a backend `TerrainGrid` into an R3F-ready
 * heightfield geometry. No React, no store access — safe to call from any
 * render path or test.
 *
 * Convention:
 *   - The terrain mesh is centered on the building's site at world (0, 0).
 *   - The grid is square, side = `window_m`, in meters.
 *   - Elevations are already normalized so the center vertex is y=0
 *     (backend-side); we just apply them as per-vertex Y displacement.
 */

import { BufferAttribute, PlaneGeometry } from 'three';

import type { TerrainGrid } from '../../api/types';

/**
 * Build a BufferGeometry heightfield from a TerrainGrid. The returned
 * geometry lies in the XZ plane with Y up; ownership transfers to the caller
 * (dispose on unmount).
 *
 * Triangles: (grid_nx - 1) * (grid_ny - 1) * 2, so a 65x65 grid produces
 * 8,192 triangles — a single trivial draw call.
 */
export const buildHeightfieldGeometry = (grid: TerrainGrid): PlaneGeometry => {
  const { grid_nx: nx, grid_ny: ny, window_m, elevations_m } = grid;
  const geom = new PlaneGeometry(window_m, window_m, nx - 1, ny - 1);
  geom.rotateX(-Math.PI / 2);

  const pos = geom.attributes.position as BufferAttribute;
  const total = nx * ny;
  for (let k = 0; k < total; k++) {
    pos.setY(k, elevations_m[k] ?? 0);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
};

/**
 * Human-readable label for the terrain source, shown in the HUD chip.
 * Keeps the copy in one place so we don't drift between component and panel.
 */
export const terrainSourceLabel = (grid: TerrainGrid): string => {
  switch (grid.source) {
    case 'USGS3DEP_10m':
      return 'USGS 3DEP · 10 m';
    case 'SRTMGL3_90m':
      return 'SRTM · 90 m';
    case 'synthetic':
      return 'demo approximation';
  }
};
