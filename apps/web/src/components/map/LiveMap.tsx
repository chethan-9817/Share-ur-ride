import type { LatLng } from '@arriveshare/shared';
import L from 'leaflet';
import { Crosshair, Navigation } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, ZoomControl, useMap } from 'react-leaflet';
import { cn } from '@/lib/utils';
import { carIcon, destIcon, hubIcon, stopIcon } from './markers';

export interface MapStop extends LatLng {
  index: number;
  label?: string;
  mine?: boolean;
  done?: boolean;
}

const BENGALURU: LatLng = { lat: 12.9716, lng: 77.5946 };

/** Bright, readable street tiles (CARTO Voyager) with retina support. */
export function Tiles() {
  return (
    <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
      url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      subdomains="abcd"
      maxZoom={19}
      detectRetina
    />
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
  if (points.length === 1) map.setView(points[0]!, Math.min(maxZoom, 14), { animate: true });
  else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [48, 48], maxZoom, animate: true });
}

/** Fits once when the set of places changes — not on every GPS ping. */
function AutoFit({ points, fitKey }: { points: LatLng[]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    fitTo(map, points);
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
        zoom={11}
        scrollWheelZoom
        zoomControl={false}
        attributionControl
        className="h-full w-full"
      >
        <Tiles />
        <ZoomControl position="bottomright" />
        <AutoResize />
        <AutoFit points={fitPoints} fitKey={fitKey} />
        {follow && <Follow target={driver ?? null} enabled={following} onPause={() => setFollowing(false)} />}
        {route.length > 1 && (
          <>
            <Polyline positions={route} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.95, lineCap: 'round' }} />
            <Polyline positions={route} pathOptions={{ color: '#4f46e5', weight: 5, lineCap: 'round' }} />
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
        <MapButton onClick={recenter} label={follow ? 'Follow the cab' : 'Show whole route'} active={follow && following}>
          {follow ? <Navigation className="h-5 w-5" /> : <Crosshair className="h-5 w-5" />}
        </MapButton>
      </div>
    </div>
  );
}
