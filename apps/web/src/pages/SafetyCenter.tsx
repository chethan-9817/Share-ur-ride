import type { SafetyPrefs, UserDto } from '@arriveshare/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Moon, Phone, PhoneIncoming, Share2, ShieldAlert, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FakeCall } from '@/components/safety/FakeCall';
import { SosButton } from '@/components/safety/SosButton';
import { Button } from '@/components/ui/Button';
import { Badge, Card, SectionTitle } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { Toggle } from '@/components/ui/Toggle';
import { qk, useContacts, useMySos } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { fmtDateTime } from '@/lib/utils';
import { useAuth } from '@/store/auth';

const HELPLINES = [
  { name: 'Emergency (Police/Fire/Ambulance)', number: '112' },
  { name: 'Women Helpline', number: '1091' },
  { name: 'Women Helpline (Domestic Abuse)', number: '181' },
  { name: 'Bengaluru Police — Suraksha', number: '100' },
];

export default function SafetyCenter() {
  const { user, setUser } = useAuth();
  const qc = useQueryClient();
  const { data: contacts = [] } = useContacts();
  const { data: sos = [] } = useMySos();
  const [adding, setAdding] = useState(false);
  const [fakeCall, setFakeCall] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', relation: '' });

  const prefs = useMutation({
    mutationFn: (safety: Partial<SafetyPrefs>) => api.patch<UserDto>('/me', { safety }),
    onSuccess: (u) => setUser(u),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const add = useMutation({
    mutationFn: () => api.post('/me/contacts', { ...form, email: form.email || undefined, relation: form.relation || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.contacts });
      setAdding(false);
      setForm({ name: '', phone: '', email: '', relation: '' });
      toast.success('Trusted contact added');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/me/contacts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.contacts }),
  });

  if (!user) return null;
  const s = user.safety;
  const isWoman = user.gender === 'female';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-safe-100 text-safe-600 dark:bg-safe-500/15">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold">Safety centre</h1>
          <p className="text-sm text-slate-500">Your safety tools, contacts and preferences.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card className="space-y-3 p-5">
            <SosButton />
            <p className="text-xs text-slate-500">
              Hold for 1.5 s. Alerts our 24×7 safety desk and your trusted contacts with your live location. Your driver is not notified.
            </p>
            <Button variant="secondary" block icon={<PhoneIncoming className="h-4 w-4" />} onClick={() => { setFakeCall(true); toast('A fake call will ring in 5 seconds'); }}>
              Schedule a fake call
            </Button>
          </Card>

          <section>
            <SectionTitle
              action={
                contacts.length < 5 && (
                  <Button size="sm" variant="ghost" icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>
                    Add
                  </Button>
                )
              }
            >
              Trusted contacts ({contacts.length}/5)
            </SectionTitle>
            <Card className="divide-y divide-slate-100 dark:divide-white/5">
              {contacts.length === 0 && (
                <div className="flex items-center gap-3 p-4 text-sm text-slate-500">
                  <Users className="h-5 w-5" /> Add someone who should know when you travel.
                </div>
              )}
              {contacts.map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">
                      {c.name} {c.relation && <span className="text-xs font-normal text-slate-500">· {c.relation}</span>}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {c.phone} {c.email && `· ${c.email}`}
                    </div>
                  </div>
                  <a href={`tel:${c.phone}`} className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-white/10" aria-label={`Call ${c.name}`}>
                    <Phone className="h-4 w-4" />
                  </a>
                  <button onClick={() => remove.mutate(c.id)} className="rounded-full p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10" aria-label={`Remove ${c.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </Card>
          </section>
        </div>

        <div className="space-y-6">
          <section>
            <SectionTitle>Preferences</SectionTitle>
            <Card className="divide-y divide-slate-100 px-4 dark:divide-white/5">
              <Toggle checked={s.autoShareTrips} onChange={(v) => prefs.mutate({ autoShareTrips: v })} icon={<Share2 className="h-5 w-5" />} label="Auto-share every trip" description="Email a live link to contacts when the trip starts" />
              <Toggle checked={s.nightCheckIns} onChange={(v) => prefs.mutate({ nightCheckIns: v })} icon={<Moon className="h-5 w-5" />} label="Night-ride check-ins" description="Periodic 'Are you okay?' prompts between 10 PM and 6 AM" />
              {isWoman && (
                <>
                  <Toggle tone="safe" checked={s.womenOnlyDefault} onChange={(v) => prefs.mutate({ womenOnlyDefault: v, ...(v ? { preferFemaleDriver: true } : {}) })} icon={<Users className="h-5 w-5" />} label="Women-only pools by default" description="Only match with women co-riders" />
                  <Toggle tone="safe" checked={s.preferFemaleDriver} onChange={(v) => prefs.mutate({ preferFemaleDriver: v })} icon={<ShieldCheck className="h-5 w-5" />} label="Prefer female drivers" description="Female drivers are offered your trip first" />
                </>
              )}
            </Card>
          </section>

          <section>
            <SectionTitle>Helplines (India)</SectionTitle>
            <Card className="divide-y divide-slate-100 dark:divide-white/5">
              {HELPLINES.map((h) => (
                <a key={h.number} href={`tel:${h.number}`} className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5">
                  <span className="text-sm">{h.name}</span>
                  <span className="flex items-center gap-1.5 font-bold text-safe-600">
                    <Phone className="h-4 w-4" /> {h.number}
                  </span>
                </a>
              ))}
            </Card>
          </section>

          {sos.length > 0 && (
            <section>
              <SectionTitle>Your SOS history</SectionTitle>
              <Card className="divide-y divide-slate-100 dark:divide-white/5">
                {sos.map((x) => (
                  <div key={x.id} className="flex items-center gap-3 p-4">
                    <ShieldAlert className="h-5 w-5 text-red-500" />
                    <div className="flex-1 text-sm">
                      <div className="font-semibold">{x.message ?? 'SOS'}</div>
                      <div className="text-xs text-slate-500">{fmtDateTime(x.createdAt)}</div>
                    </div>
                    <Badge tone={x.status === 'resolved' ? 'green' : x.status === 'false_alarm' ? 'slate' : 'red'}>{x.status.replace('_', ' ')}</Badge>
                  </div>
                ))}
              </Card>
            </section>
          )}
        </div>
      </div>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add trusted contact">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <input className="input" placeholder="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="Mobile (10 digits)" required inputMode="tel" maxLength={10} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })} />
          <input className="input" type="email" placeholder="Email — needed for live alerts" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="input" placeholder="Relation (e.g. Sister)" value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })} />
          <Button type="submit" block size="lg" loading={add.isPending}>
            Save contact
          </Button>
        </form>
      </Sheet>
      <FakeCall open={fakeCall} onClose={() => setFakeCall(false)} />
    </div>
  );
}
