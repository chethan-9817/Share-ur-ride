import type { LatLng } from '@arriveshare/shared';
import { Crosshair, LocateFixed } from 'lucide-react';
import { useEffect, useState } from 'react';
import type L from 'leaflet';
import { MapContainer, Marker, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import { toast } from 'sonner';
import { currentPosition } from '@/hooks/useGeolocation';
import { cn } from '@/lib/utils';
import { AutoResize, fitTo, MapButton, Tiles } from './LiveMap';
import { destIcon, hubIcon, meIcon } from './markers';

function ClickToPick({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** Re-frames only when the hub changes or a place is chosen from search — never on a tap. */
function Frame({ hub, value, focusKey }: { hub: LatLng; value: LatLng | null; focusKey: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(hub, 11);
  }, [hub.lat, hub.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (focusKey > 0 && value) fitTo(map, [hub, value], 14);
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Destination picker: tap anywhere or drag the pin. Search results call
 * `focusKey++` so the map flies to them; taps never move the camera.
 */
export function MapPicker({
  hub,
  hubType,
  value,
  onChange,
  focusKey = 0,
  className,
}: {
  hub: LatLng;
  hubType: string;
  value: LatLng | null;
  onChange: (p: LatLng) => void;
  focusKey?: number;
  className?: string;
}) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [me, setMe] = useState<LatLng | null>(null);

  const locate = async () => {
    const p = await currentPosition();
    if (!p) {
      toast.error('Could not get your location — check location permission');
      return;
    }
    setMe(p);
    map?.setView(p, 15, { animate: true });
  };

  return (
    <div className={cn('relative isolate h-64 overflow-hidden rounded-2xl ring-1 ring-indigo-100 sm:h-80', className)}>
      <MapContainer ref={setMap} center={hub} zoom={11} zoomControl={false} className="h-full w-full">
        <Tiles />
        <ZoomControl position="bottomright" />
        <AutoResize />
        <Frame hub={hub} value={value} focusKey={focusKey} />
        <ClickToPick onPick={onChange} />
        <Marker position={hub} icon={hubIcon(hubType)} />
        {me && <Marker position={me} icon={meIcon} />}
        {value && (
          <Marker
            position={value}
            icon={destIcon}
            draggable
            autoPan
            eventHandlers={{
              dragend: (e) => {
                const ll = (e.target as L.Marker).getLatLng();
                onChange({ lat: ll.lat, lng: ll.lng });
              },
            }}
          />
        )}
      </MapContainer>

      <div className="absolute right-3 top-3 z-[500] flex flex-col gap-2">
        <MapButton label="Show hub and drop" onClick={() => map && fitTo(map, value ? [hub, value] : [hub], 14)}>
          <Crosshair className="h-5 w-5" />
        </MapButton>
        <MapButton label="My location" onClick={locate}>
          <LocateFixed className="h-5 w-5" />
        </MapButton>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[500] mx-auto w-fit max-w-[80%] rounded-full bg-slate-900/80 px-3 py-1.5 text-center text-xs font-medium text-white">
        {value ? 'Drag the pin to fine-tune your drop-off' : 'Tap the map to drop your pin'}
      </div>
    </div>
  );
}
