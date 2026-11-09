import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** Pure-HTML markers: crisp at any DPI, themeable, no image assets to load. */

const pin = (bg: string, inner: string, size = 34) =>
  L.divIcon({
    className: 'as-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    html: `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${bg};box-shadow:0 6px 14px -4px rgba(0,0,0,.45);border:2px solid #fff">
      <div style="transform:rotate(45deg);color:#fff;font:700 13px Inter,sans-serif">${inner}</div></div>`,
  });

export const hubIcon = (type: string) => pin('#4f46e5', type === 'airport' ? '✈' : type === 'bus' ? '🚌' : '🚆', 38);

export const stopIcon = (n: number, mine = false) => pin(mine ? '#db2777' : '#0f766e', String(n));

export const destIcon = pin('#db2777', '★', 36);

export function carIcon(heading: number | null) {
  return L.divIcon({
    className: 'as-marker',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `<div style="position:relative;width:44px;height:44px">
      <div style="position:absolute;inset:0;border-radius:9999px;background:rgba(79,70,229,.22);animation:radar 2.4s infinite"></div>
      <div style="position:absolute;inset:8px;border-radius:9999px;background:#111827;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px -4px rgba(0,0,0,.5);transform:rotate(${heading ?? 0}deg)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M12 2l6 18-6-4-6 4z"/></svg>
      </div></div>`,
  });
}

export const meIcon = L.divIcon({
  className: 'as-marker',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  html: '<div style="width:20px;height:20px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25)"></div>',
});
