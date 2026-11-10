import { formatINR, TOLERANCE_OPTIONS, type FareQuoteDto, type LatLng, type RideDto } from '@arriveshare/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Leaf, Loader2, MapPin, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { MapPicker } from '@/components/map/MapPicker';
import { Button } from '@/components/ui/Button';
import { Card, PageHeader } from '@/components/ui/primitives';
import { Segmented, Stepper, Toggle } from '@/components/ui/Toggle';
import { useStations } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { cn, toLocalInput } from '@/lib/utils';
import { useAuth } from '@/store/auth';

interface Place {
  label: string;
  short: string;
  lat: number;
  lng: number;
}

function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function BookRide() {
  const [params] = useSearchParams();
  const user = useAuth((s) => s.user)!;
  const { data: stations = [] } = useStations();
  const nav = useNavigate();
  const qc = useQueryClient();

  const [stationId, setStationId] = useState(params.get('station') ?? '');
  const [query, setQuery] = useState('');
  const [dest, setDest] = useState<LatLng | null>(null);
  const [label, setLabel] = useState('');
  const [arrival, setArrival] = useState(() => toLocalInput(new Date(Date.now() + 20 * 60_000)));
  const [tolerance, setTolerance] = useState<number>(15);
  const [luggage, setLuggage] = useState(1);
  const [seats, setSeats] = useState(1);
  const [flight, setFlight] = useState('');
  const isWoman = user.gender === 'female';
  const [womenOnly, setWomenOnly] = useState(isWoman && user.safety.womenOnlyDefault);
  const [femaleDriver, setFemaleDriver] = useState(isWoman && user.safety.preferFemaleDriver);
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusKey, setFocusKey] = useState(0);

  useEffect(() => {
    if (!stationId && stations[0]) setStationId(stations[0].id);
  }, [stations, stationId]);
  const station = stations.find((s) => s.id === stationId);

  const q = useDebounced(query);
  const places = useQuery({
    queryKey: ['places', q, stationId],
    queryFn: () => api.get<Place[]>(`/places?q=${encodeURIComponent(q)}&stationId=${stationId}`),
    enabled: !!stationId && searchOpen,
    staleTime: 5 * 60_000,
  });

  const quote = useQuery({
    queryKey: ['quote', stationId, dest?.lat, dest?.lng],
    queryFn: () => api.post<FareQuoteDto>('/rides/quote', { stationId, destination: dest }),
    enabled: !!stationId && !!dest,
  });

  const pickPlace = (p: Place) => {
    setDest({ lat: p.lat, lng: p.lng });
    setLabel(p.label);
    setQuery(p.short);
    setSearchOpen(false);
    setFocusKey((k) => k + 1);
  };

  const onMapPick = async (p: LatLng) => {
    setDest(p);
    setLabel('Dropped pin');
    try {
      const r = await api.get<{ label: string }>(`/places/reverse?lat=${p.lat}&lng=${p.lng}`);
      setLabel(r.label);
      setQuery(r.label.split(',')[0] ?? '');
    } catch {
      /* keep "Dropped pin" */
    }
  };

  const book = useMutation({
    mutationFn: () =>
      api.post<RideDto>('/rides', {
        stationId,
        destination: dest,
        destinationLabel: label || query,
        arrivalAt: new Date(arrival).toISOString(),
        toleranceMin: tolerance,
        seats,
        luggage,
        flightOrTrain: flight || undefined,
        womenOnly,
        preferFemaleDriver: femaleDriver,
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['rides'] });
      toast.success(r.status === 'matched' ? 'Co-riders found already! 🎉' : 'Looking for co-riders…');
      nav(`/rides/${r.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const valid = useMemo(() => !!stationId && !!dest && (label || query).length >= 2, [stationId, dest, label, query]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        <PageHeader icon={<MapPin className="h-6 w-6" />} title="Book a shared ride" subtitle="Pick your hub, drop a pin for home and we’ll find co-riders on your route." />

        <div>
          <span className="label">Arriving at</span>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
            {stations.map((s) => (
              <button
                key={s.id}
                onClick={() => setStationId(s.id)}
                className={cn(
                  'shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition',
                  s.id === stationId ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white dark:border-white/10 dark:bg-ink-800',
                )}
              >
                {s.code} · {s.name.split(' ').slice(0, 2).join(' ')}
              </button>
            ))}
          </div>
        </div>

        <div className="relative">
          <label className="label" htmlFor="dest">Going to</label>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              id="dest"
              className="input pl-12"
              placeholder="Search area, landmark or address"
              value={query}
              autoComplete="off"
              onFocus={() => setSearchOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
            />
            {places.isFetching && <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
          </div>
          {searchOpen && (places.data?.length ?? 0) > 0 && (
            <ul className="card absolute z-[700] mt-2 max-h-72 w-full overflow-y-auto p-1">
              {places.data!.map((p) => (
                <li key={`${p.lat},${p.lng}`}>
                  <button className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-white/5" onClick={() => pickPlace(p)}>
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                    <span>
                      <span className="block text-sm font-semibold">{p.short}</span>
                      <span className="line-clamp-1 text-xs text-slate-500">{p.label}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {station && (
          <div onClick={() => setSearchOpen(false)}>
            <MapPicker hub={station} hubType={station.type} value={dest} onChange={onMapPick} focusKey={focusKey} />
            {label && <p className="mt-2 line-clamp-1 text-xs text-slate-500">📍 {label}</p>}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="arr">Arrival time</label>
            <input id="arr" type="datetime-local" className="input" value={arrival} onChange={(e) => setArrival(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="flight">Flight / train no. (optional)</label>
            <input id="flight" className="input uppercase" placeholder="6E 2345" maxLength={20} value={flight} onChange={(e) => setFlight(e.target.value)} />
          </div>
        </div>

        <div>
          <span className="label flex items-center gap-1.5">
            <Clock className="h-4 w-4" /> I can wait up to
          </span>
          <Segmented value={tolerance} onChange={setTolerance} options={TOLERANCE_OPTIONS.map((t) => ({ value: t, label: `${t} min` }))} />
          <p className="mt-1.5 text-xs text-slate-500">Longer windows find more co-riders and bigger savings.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Stepper label="Bags" value={luggage} min={0} max={3} onChange={setLuggage} />
          <Stepper label="Seats" value={seats} min={1} max={2} onChange={setSeats} />
        </div>

        <Card className="p-4">
          <div className="mb-1 flex items-center gap-2 text-sm font-bold text-safe-700 dark:text-safe-400">
            <ShieldCheck className="h-4 w-4" /> Safety preferences
          </div>
          {isWoman ? (
            <>
              <Toggle tone="safe" checked={womenOnly} onChange={(v) => { setWomenOnly(v); if (v) setFemaleDriver(true); }} label="Women-only pool" description="Only women co-riders. Female drivers are offered the trip first." />
              <Toggle tone="safe" checked={femaleDriver} disabled={womenOnly} onChange={setFemaleDriver} label="Prefer a female driver" description="If none accepts within 2 min, we assign a top-rated verified driver." />
            </>
          ) : (
            <p className="text-xs text-slate-500">Every trip includes PIN-verified pickup, live tracking, route-deviation alerts and silent SOS.</p>
          )}
        </Card>
      </div>

      {/* Summary — sticky on laptops, docked at the bottom on phones */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Card className="space-y-4 p-5">
          <div className="text-sm font-bold uppercase tracking-wide text-slate-500">Fare estimate</div>
          {!dest ? (
            <p className="text-sm text-slate-500">Choose a destination to see your fare.</p>
          ) : quote.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculating road distance…
            </div>
          ) : quote.data ? (
            <>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-xs text-slate-500">Shared (est.)</div>
                  <div className="text-3xl font-extrabold text-emerald-600">{formatINR(quote.data.estimatedSharedFare)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Solo</div>
                  <div className="text-lg font-bold text-slate-400 line-through">{formatINR(quote.data.soloFare)}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <Sparkles className="h-3.5 w-3.5" /> Save ~{quote.data.estimatedSavingsPct}%
                </span>
                <span className="chip bg-slate-100 dark:bg-white/10">{quote.data.soloKm.toFixed(1)} km</span>
                <span className="chip bg-slate-100 dark:bg-white/10">~{quote.data.etaMin} min</span>
                <span className="chip bg-slate-100 dark:bg-white/10">
                  <Leaf className="h-3.5 w-3.5" /> {quote.data.co2SavedKg} kg CO₂
                </span>
              </div>
              <p className="text-xs text-slate-500">You’ll never pay more than the solo fare. Your exact share is locked when you accept a match.</p>
            </>
          ) : null}
          <Button size="lg" block disabled={!valid} loading={book.isPending} onClick={() => book.mutate()}>
            Find co-riders
          </Button>
        </Card>
      </aside>
    </div>
  );
}
