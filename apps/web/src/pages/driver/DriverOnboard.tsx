import { VEHICLE_TYPES, type DriverProfileDto, type UserDto, type VehicleType } from '@arriveshare/shared';
import { useMutation } from '@tanstack/react-query';
import { Car } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/Toggle';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/store/auth';

export default function DriverOnboard() {
  const nav = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const [f, setF] = useState({ vehicleNumber: '', vehicleModel: '', vehicleColor: '', licenseNumber: '' });
  const [type, setType] = useState<VehicleType>('sedan');

  const submit = useMutation({
    mutationFn: async () => {
      const r = await api.post<{ profile: DriverProfileDto; accessToken: string }>('/driver/onboard', {
        ...f,
        vehicleType: type,
        seats: type === 'suv' ? 6 : 4,
      });
      // New token carries the driver role.
      useAuth.setState({ token: r.accessToken });
      const me = await api.get<UserDto>('/me');
      setSession(r.accessToken, me);
      return r.profile;
    },
    onSuccess: (p) => {
      toast.success(p.verified ? 'You’re verified — go online to start earning!' : 'Submitted! We’ll verify your documents shortly.');
      nav('/driver', { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const field = (k: keyof typeof f, label: string, placeholder: string, extra = '') => (
    <div>
      <label className="label" htmlFor={k}>{label}</label>
      <input id={k} className={`input ${extra}`} required placeholder={placeholder} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </div>
  );

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-500/15">
          <Car className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold">Drive with ArriveShare</h1>
          <p className="text-sm text-slate-500">Full cabs on every hub run, plus a 10% full-cab bonus.</p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        <Card className="space-y-4 p-5">
          {field('vehicleNumber', 'Registration number', 'KA01AB1234', 'uppercase')}
          <div className="grid grid-cols-2 gap-3">
            {field('vehicleModel', 'Model', 'Maruti Dzire')}
            {field('vehicleColor', 'Colour', 'White')}
          </div>
          <div>
            <span className="label">Vehicle type</span>
            <Segmented value={type} onChange={setType} options={VEHICLE_TYPES.map((t) => ({ value: t, label: t[0]!.toUpperCase() + t.slice(1) }))} />
          </div>
          {field('licenseNumber', 'Driving licence number', 'KA0120190001234', 'uppercase')}
          <p className="text-xs text-slate-500">
            All drivers go through licence, RC and background verification before they can accept trips. Women riders can choose to ride only with female drivers.
          </p>
          <Button type="submit" size="lg" block loading={submit.isPending}>
            Submit for verification
          </Button>
        </Card>
      </form>
    </div>
  );
}
