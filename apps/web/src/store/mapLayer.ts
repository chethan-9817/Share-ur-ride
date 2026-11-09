import { create } from 'zustand';

export type MapLayer = 'hybrid' | 'satellite' | 'streets';

const KEY = 'as-map-layer';

function initial(): MapLayer {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'hybrid' || v === 'satellite' || v === 'streets') return v;
  } catch {
    /* storage unavailable */
  }
  return 'hybrid';
}

/** Chosen base map, shared by every map on the page and remembered on this device. */
export const useMapLayer = create<{ layer: MapLayer; setLayer: (l: MapLayer) => void }>((set) => ({
  layer: initial(),
  setLayer: (layer) => {
    try {
      localStorage.setItem(KEY, layer);
    } catch {
      /* ignore */
    }
    set({ layer });
  },
}));

/** Route line colours that stay visible on top of aerial imagery and on street tiles. */
export const routeColors = (layer: MapLayer) =>
  layer === 'streets' ? { casing: '#ffffff', line: '#4f46e5' } : { casing: '#0f172a', line: '#22d3ee' };
