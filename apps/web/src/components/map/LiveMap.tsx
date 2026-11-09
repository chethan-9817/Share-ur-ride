import type { LatLng } from '@arriveshare/shared';
import L from 'leaflet';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { cn } from '@/lib/utils';
import { carIcon, destIcon, hubIcon, stopIcon } from './markers';

export interface MapStop extends LatLng {
  index: number;
  label?: string;
  mine?: boolean;
  done?: boolean;
}

function useDarkTiles() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export function Tiles() {
  const dark = useDarkTiles();
  return (
    <TileLayer
      key={dark ? 'dark' : 'light'}
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
      url={`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'rastertiles/voyager'}/{z}/{x}/{y}{r}.png`}
      subdomains="abcd"
      maxZoom={19}
    />
  );
}

/** Fits the viewport to the route once, then lets the user pan freely. */
function FitBounds({ points, follow }: { points: LatLng[]; follow?: LatLng | null }) {
  const map = useMap();
  const key = points.length ? `${points[0]!.lat},${points.at(-1)!.lng},${points.length}` : '';
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0]!, 13);
    else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [36, 36] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (follow) map.panTo(follow, { animate: true });
  }, [follow, map]);
  // Leaflet needs a nudge when its container resizes (e.g. sidebar collapse, rotation).
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export function LiveMap({
  hub,
  hubType = 'airport',
  hubLabel,
  stops = [],
  route = [],
  driver,
  destination,
  follow,
  className,
  children,
}: {
  hub?: LatLng;
  hubType?: string;
  hubLabel?: string;
  stops?: MapStop[];
  route?: LatLng[];
  driver?: (LatLng & { heading?: number | null }) | null;
  destination?: LatLng | null;
  follow?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const fitPoints = useMemo(() => {
    const pts: LatLng[] = [];
    if (hub) pts.push(hub);
    pts.push(...stops);
    if (destination) pts.push(destination);
    if (route.length > 1) pts.push(...route.filter((_, i) => i % 10 === 0));
    return pts;
  }, [hub, stops, destination, route]);

  const center = hub ?? destination ?? { lat: 12.9716, lng: 77.5946 };

  return (
    <div className={cn('relative h-72 overflow-hidden rounded-2xl sm:h-96', className)}>
      <MapContainer center={center} zoom={11} scrollWheelZoom zoomControl={false} attributionControl>
        <Tiles />
        <FitBounds points={fitPoints} follow={follow && driver ? driver : null} />
        {route.length > 1 && (
          <>
            <Polyline positions={route} pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.9 }} />
            <Polyline positions={route} pathOptions={{ color: '#4f46e5', weight: 5 }} />
          </>
        )}
        {hub && (
          <Marker position={hub} icon={hubIcon(hubType)}>
            {hubLabel && <Tooltip direction="top" offset={[0, -36]}>{hubLabel}</Tooltip>}
          </Marker>
        )}
        {stops.map((s) => (
          <Marker key={`${s.index}-${s.lat}`} position={s} icon={stopIcon(s.index + 1, s.mine)} opacity={s.done ? 0.45 : 1}>
            {s.label && <Tooltip direction="top" offset={[0, -32]}>{s.label}</Tooltip>}
          </Marker>
        ))}
        {destination && <Marker position={destination} icon={destIcon} />}
        {driver && <Marker position={driver} icon={carIcon(driver.heading ?? null)} zIndexOffset={1000} />}
        {children}
      </MapContainer>
    </div>
  );
}
