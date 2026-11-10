import type { LatLng } from '@arriveshare/shared';
import L from 'leaflet';
import { Crosshair, Layers, Navigation } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, ZoomControl, useMap } from 'react-leaflet';
import { cn } from '@/lib/utils';
import { routeColors, useMapLayer, type MapLayer } from '@/store/mapLayer';
import { carIcon, destIcon, hubIcon, stopIcon } from './markers';

export interface MapStop extends LatLng {
  index: number;
  label?: string;
  mine?: boolean;
  done?: boolean;
}

const BENGALURU: LatLng = { lat: 12.9716, lng: 77.5946 };

/**
 * Keep every map on the service area. Without limits a bad fit (e.g. a container that
 * had no size yet) zooms out until the whole of India is on screen.
 * Zoom 7 is roughly the Bengaluru ⇄ Mangaluru span; the bounds cover Karnataka and neighbours.
 */
export const MAP_LIMITS = {
  minZoom: 7,
  maxZoom: 20,
  maxBounds: L.latLngBounds([8.0, 72.0], [19.5, 81.0]),
  maxBoundsViscosity: 0.9,
};

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const ESRI_ATTR = 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics';

/**
 * Base map. "hybrid" = satellite imagery + roads + place names (Google-style),
 * "satellite" = imagery only, "streets" = CARTO Voyager street map.
 */
export function Tiles() {
  const layer = useMapLayer((s) => s.layer);
  if (layer === 'streets') {
    return (
      <TileLayer
        key="streets"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
        maxZoom={20}
        maxNativeZoom={19}
        detectRetina
      />
    );
  }
  return (
    <>
      <TileLayer key="imagery" attribution={ESRI_ATTR} url={`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`} maxZoom={20} maxNativeZoom={18} />
      {layer === 'hybrid' && (
        <>
          <TileLayer key="roads" url={`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`} maxZoom={20} maxNativeZoom={19} opacity={0.6} />
          <TileLayer key="labels" url={`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`} maxZoom={20} maxNativeZoom={19} />
        </>
      )}
    </>
  );
}

const LAYERS: { id: MapLayer; label: string; swatch: string }[] = [
  { id: 'hybrid', label: 'Satellite + labels', swatch: 'bg-[linear-gradient(135deg,#14532d,#365314_45%,#facc15_46%,#facc15_52%,#1e3a8a_53%)]' },
  { id: 'satellite', label: 'Satellite', swatch: 'bg-[linear-gradient(135deg,#14532d,#3f6212,#1e3a8a)]' },
  { id: 'streets', label: 'Streets', swatch: 'bg-[linear-gradient(135deg,#f8fafc,#e2e8f0_45%,#fde68a_46%,#fde68a_52%,#bfdbfe_53%)]' },
];

/** Google-style layer chooser shown in the map corner. */
export function LayerSwitcher() {
  const { layer, setLayer } = useMapLayer();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <MapButton label="Map type" onClick={() => setOpen((o) => !o)} active={open}>
        <Layers className="h-5 w-5" />
      </MapButton>
      {open && (
        <div className="absolute right-12 top-0 w-48 rounded-2xl bg-white p-2 shadow-soft ring-1 ring-indigo-100">
          {LAYERS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                setLayer(l.id);
                setOpen(false);
              }}
              className={cn('flex w-full items-center gap-3 rounded-xl p-2 text-left text-sm font-semibold', layer === l.id ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-50')}
            >
              <span className={cn('h-8 w-8 shrink-0 rounded-lg ring-1 ring-black/10', l.swatch)} />
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Keeps Leaflet's size in sync with its container (rotation, sidebar, lazy mount). */
export function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize({ pan: false });
    const t = setTimeout(fix, 150);
    const ro = new ResizeObserver(fix);
    ro.observe(map.getContainer());
    window.addEventListener('orientationchange', fix);
    return () => {
      clearTimeout(t);
      ro.disconnect();
      window.removeEventListener('orientationchange', fix);
    };
  }, [map]);
  return null;
}

export function fitTo(map: L.Map, points: LatLng[], maxZoom = 15) {
  if (points.length === 0) return;
  // fitBounds uses the container's size; make sure Leaflet has measured it first.
  map.invalidateSize({ pan: false });
  if (points.length === 1) map.setView(points[0]!, Math.min(maxZoom, 14), { animate: true });
  else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [48, 48], maxZoom, animate: true });
}

/** Fits once when the set of places changes — not on every GPS ping. */
function AutoFit({ points, fitKey }: { points: LatLng[]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    fitTo(map, points);
    // Fit again once layout has settled (lazy routes, phone rotation, sticky sidebars).
    const t = setTimeout(() => fitTo(map, points), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

/** Follows the cab, pausing as soon as the user pans the map themselves. */
function Follow({ target, enabled, onPause }: { target: LatLng | null; enabled: boolean; onPause: () => void }) {
  const map = useMap();
  useEffect(() => {
    const pause = () => onPause();
    map.on('dragstart', pause);
    return () => {
      map.off('dragstart', pause);
    };
  }, [map, onPause]);
  useEffect(() => {
    if (enabled && target) map.panTo(target, { animate: true, duration: 1 });
  }, [enabled, target?.lat, target?.lng, map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Glides the marker between GPS fixes instead of jumping every few seconds. */
export function AnimatedMarker({ position, icon, duration = 1500, children }: { position: LatLng; icon: L.DivIcon; duration?: number; children?: ReactNode }) {
  const ref = useRef<L.Marker | null>(null);
  const initial = useRef(position);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const start = m.getLatLng();
    const end = L.latLng(position.lat, position.lng);
    if (start.distanceTo(end) > 3000) {
      m.setLatLng(end); // big jump (e.g. first real fix) — don't animate across the city
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / duration);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      m.setLatLng([start.lat + (end.lat - start.lat) * e, start.lng + (end.lng - start.lng) * e]);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [position.lat, position.lng, duration]);
  return (
    <Marker ref={ref} position={initial.current} icon={icon} zIndexOffset={1000}>
      {children}
    </Marker>
  );
}

export function MapButton({ onClick, label, children, active }: { onClick: () => void; label: string; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-xl shadow-soft transition active:scale-95',
        active ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  );
}

export function LiveMap({
  hub,
  hubType = 'airport',
  hubLabel,
  center,
  stops = [],
  route = [],
  driver,
  destination,
  extraFit = [],
  follow,
  className,
  children,
}: {
  hub?: LatLng;
  hubType?: string;
  hubLabel?: string;
  /** Initial centre when there is no hub (e.g. the ops map). */
  center?: LatLng;
  stops?: MapStop[];
  route?: LatLng[];
  driver?: (LatLng & { heading?: number | null }) | null;
  destination?: LatLng | null;
  /** Additional points to include when fitting (e.g. all drivers on the ops map). */
  extraFit?: LatLng[];
  follow?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [following, setFollowing] = useState(!!follow);
  const colors = routeColors(useMapLayer((s) => s.layer));
  useEffect(() => setFollowing(!!follow), [follow]);

  const fitPoints = useMemo(() => {
    const pts: LatLng[] = [];
    if (hub) pts.push(hub);
    pts.push(...stops);
    if (destination) pts.push(destination);
    if (route.length > 1) pts.push(...route.filter((_, i) => i % 8 === 0), route[route.length - 1]!);
    pts.push(...extraFit);
    // Nothing else to show? Frame the cab itself.
    if (pts.length === 0 && driver) pts.push(driver);
    return pts;
  }, [hub, stops, destination, route, extraFit, driver]);

  // Re-fit only when the places change, never because the cab moved.
  const fitKey = useMemo(
    () =>
      [hub && `${hub.lat},${hub.lng}`, destination && `${destination.lat},${destination.lng}`, stops.length, route.length, extraFit.length, fitPoints.length === 1 && driver ? 'd' : '']
        .filter(Boolean)
        .join('|'),
    [hub, destination, stops.length, route.length, extraFit.length, fitPoints.length, driver],
  );

  const recenter = () => {
    if (!map) return;
    if (follow && driver) {
      setFollowing(true);
      map.setView(driver, Math.max(map.getZoom(), 15), { animate: true });
    } else fitTo(map, fitPoints);
  };

  return (
    <div className={cn('relative isolate h-72 overflow-hidden rounded-2xl ring-1 ring-indigo-100 sm:h-96', className)}>
      <MapContainer
        ref={setMap}
        center={hub ?? center ?? destination ?? driver ?? BENGALURU}
        zoom={12}
        scrollWheelZoom
        zoomControl={false}
        attributionControl
        className="h-full w-full"
        {...MAP_LIMITS}
      >
        <Tiles />
        <ZoomControl position="bottomright" />
        <AutoResize />
        <AutoFit points={fitPoints} fitKey={fitKey} />
        {follow && <Follow target={driver ?? null} enabled={following} onPause={() => setFollowing(false)} />}
        {route.length > 1 && (
          <>
            <Polyline positions={route} pathOptions={{ color: colors.casing, weight: 9, opacity: 0.85, lineCap: 'round' }} />
            <Polyline positions={route} pathOptions={{ color: colors.line, weight: 5, lineCap: 'round' }} />
          </>
        )}
        {hub && (
          <Marker position={hub} icon={hubIcon(hubType)}>
            {hubLabel && <Tooltip direction="top" offset={[0, -38]}>{hubLabel}</Tooltip>}
          </Marker>
        )}
        {stops.map((s) => (
          <Marker key={`${s.index}-${s.lat}-${s.lng}`} position={s} icon={stopIcon(s.index + 1, s.mine)} opacity={s.done ? 0.45 : 1}>
            {s.label && <Tooltip direction="top" offset={[0, -32]}>{s.label}</Tooltip>}
          </Marker>
        ))}
        {destination && <Marker position={destination} icon={destIcon} />}
        {driver && <AnimatedMarker position={driver} icon={carIcon(driver.heading ?? null)} />}
        {children}
      </MapContainer>

      <div className="absolute right-3 top-3 z-[500] flex flex-col gap-2">
        <LayerSwitcher />
        <MapButton onClick={recenter} label={follow ? 'Follow the cab' : 'Show whole route'} active={follow && following}>
          {follow ? <Navigation className="h-5 w-5" /> : <Crosshair className="h-5 w-5" />}
        </MapButton>
      </div>
    </div>
  );
}
