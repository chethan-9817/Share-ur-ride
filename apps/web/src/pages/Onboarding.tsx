import { GENDERS, type Gender, type UserDto } from '@arriveshare/shared';
import { useMutation } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/primitives';
import { Toggle } from '@/components/ui/Toggle';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';

const genderLabels: Record<Gender, string> = {
  female: 'Woman',
  male: 'Man',
  non_binary: 'Non-binary',
  undisclosed: 'Prefer not to say',
};

export default function Onboarding() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone?.replace('+91', '') ?? '');
  const [gender, setGender] = useState<Gender>(user?.gender ?? 'undisclosed');
  const [womenOnly, setWomenOnly] = useState(false);
  const [contact, setContact] = useState({ name: '', phone: '', email: '' });

  const save = useMutation({
    mutationFn: async () => {
      const u = await api.patch<UserDto>('/me', {
        name,
        phone,
        gender,
        safety: { womenOnlyDefault: gender === 'female' && womenOnly, preferFemaleDriver: gender === 'female' && womenOnly },
      });
      if (contact.name && contact.phone) {
        await api.post('/me/contacts', { ...contact, relation: 'Emergency contact' });
      }
      return u;
    },
    onSuccess: (u) => {
      setUser(u);
      if (!u.onboarded) {
        toast.error('Please choose how you identify — we use it only for women-only pooling.');
        return;
      }
      toast.success('You’re all set!');
      nav('/', { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="pt-safe mx-auto min-h-screen max-w-lg px-4 py-8">
      <h1 className="text-2xl font-extrabold">Let’s set up your profile</h1>
      <p className="mt-1 text-sm text-slate-500">Takes 30 seconds. Co-riders only ever see your first name.</p>

      <form
        className="mt-6 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Card className="space-y-4 p-5">
          <div>
            <label className="label" htmlFor="name">Full name</label>
            <input id="name" className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <div>
            <label className="label" htmlFor="phone">Mobile number</label>
            <div className="flex">
              <span className="flex h-12 items-center rounded-l-xl border border-r-0 border-slate-300 bg-slate-50 px-3 text-sm font-semibold dark:border-white/10 dark:bg-ink-700">+91</span>
              <input id="phone" className="input rounded-l-none" required inputMode="tel" autoComplete="tel-national" pattern="[6-9]\d{9}" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} />
            </div>
            <p className="mt-1 text-xs text-slate-500">Drivers see a masked number. Never shared with co-riders.</p>
          </div>
          <div>
            <span className="label">I identify as</span>
            <div className="grid grid-cols-2 gap-2">
              {GENDERS.map((g) => (
                <button
                  type="button"
                  key={g}
                  onClick={() => setGender(g)}
                  className={cn(
                    'h-11 rounded-xl border text-sm font-semibold transition',
                    gender === g ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'border-slate-200 dark:border-white/10',
                  )}
                >
                  {genderLabels[g]}
                </button>
              ))}
            </div>
          </div>
          {gender === 'female' && (
            <Toggle tone="safe" checked={womenOnly} onChange={setWomenOnly} label="Women-only rides by default" description="Pool only with women and get female drivers first" icon={<ShieldCheck className="h-5 w-5 text-safe-600" />} />
          )}
        </Card>

        <Card className="space-y-3 p-5">
          <div>
            <div className="font-bold">Emergency contact (recommended)</div>
            <p className="text-xs text-slate-500">They get a live trip link when you ride, and an alert if you press SOS.</p>
          </div>
          <input className="input" placeholder="Name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
          <input className="input" placeholder="Mobile (10 digits)" inputMode="tel" maxLength={10} value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value.replace(/\D/g, '') })} />
          <input className="input" placeholder="Email (for live alerts)" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
        </Card>

        <Button type="submit" size="lg" block loading={save.isPending}>
          Continue
        </Button>
      </form>
    </div>
  );
}
