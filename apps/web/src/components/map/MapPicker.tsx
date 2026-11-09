import type { LatLng } from '@arriveshare/shared';
import L from 'leaflet';
import { useEffect } from 'react';
import { MapContainer, Marker, useMap, useMapEvents } from 'react-leaflet';
import { cn } from '@/lib/utils';
import { Tiles } from './LiveMap';
import { destIcon, hubIcon } from './markers';

function ClickToPick({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

function Recenter({ hub, value }: { hub: LatLng; value: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (value) map.fitBounds(L.latLngBounds([hub, value]), { padding: [40, 40], maxZoom: 14 });
    else map.setView(hub, 11);
  }, [hub, value, map]);
  return null;
}

/** Tap anywhere (or drag the pin) to choose a drop-off point. */
export function MapPicker({
  hub,
  hubType,
  value,
  onChange,
  className,
}: {
  hub: LatLng;
  hubType: string;
  value: LatLng | null;
  onChange: (p: LatLng) => void;
  className?: string;
}) {
  return (
    <div className={cn('relative h-64 overflow-hidden rounded-2xl sm:h-80', className)}>
      <MapContainer center={hub} zoom={11} zoomControl={false}>
        <Tiles />
        <Recenter hub={hub} value={value} />
        <ClickToPick onPick={onChange} />
        <Marker position={hub} icon={hubIcon(hubType)} />
        {value && (
          <Marker
            position={value}
            icon={destIcon}
            draggable
            eventHandlers={{ dragend: (e) => onChange(e.target.getLatLng()) }}
          />
        )}
      </MapContainer>
      {!value && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[500] mx-auto w-fit rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white">
          Tap the map to drop your pin
        </div>
      )}
    </div>
  );
}
