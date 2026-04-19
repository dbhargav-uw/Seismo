import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';

import { buildHeightfieldGeometry } from '../features/structure/terrain';
import { useViabilityStore } from '../features/viability/store';

/**
 * Site-context heightfield rendered under and around the building. Reads
 * `terrain` from the store; returns `null` when no grid is loaded yet
 * (the existing `<GroundSlab>` covers that case). Not animated — the
 * geometry is rebuilt only when the grid identity changes.
 *
 * Shading is a matte standard material with computed vertex normals; the
 * existing directional light in the scene handles hillshade for free, so
 * there's no shader code to maintain here.
 */
export const TerrainMesh = (): JSX.Element | null => {
  const grid = useViabilityStore((s) => s.terrain);
  const invalidate = useThree((s) => s.invalidate);

  const geometry = useMemo(() => (grid ? buildHeightfieldGeometry(grid) : null), [grid]);

  useEffect(() => {
    if (!geometry) return;
    // Demand-mode scene: nudge a repaint so the new mesh appears immediately
    // without waiting for the next input-driven frame.
    invalidate();
    return () => {
      geometry.dispose();
    };
  }, [geometry, invalidate]);

  if (!grid || !geometry) return null;

  return (
    <mesh
      geometry={geometry}
      // Sit just below the building's ground plane so its top edge blends into
      // the GroundSlab at the center without z-fighting.
      position={[0, -0.06, 0]}
      receiveShadow
      castShadow={false}
    >
      <meshStandardMaterial
        color="#343842"
        metalness={0.04}
        roughness={0.92}
        flatShading={false}
      />
    </mesh>
  );
};
