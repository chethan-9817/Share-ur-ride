import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Car } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge, Card, EmptyState, PageHeader, PageLoader, Rating } from '@/components/ui/primitives';
import { qk } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';

interface AdminDriver {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  gender: string;
  status: string;
  verified: boolean;
  simulated: boolean;
  vehicle: string;
  vehicleNumber: string;
  licenseNumber: string;
  rating: number | null;
}

export default function AdminDrivers() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: qk.admin('drivers'), queryFn: () => api.get<AdminDriver[]>('/admin/drivers') });
  const verify = useMutation({
    mutationFn: ({ id, verified }: { id: string; verified: boolean }) => api.patch(`/admin/drivers/${id}`, { verified }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.admin('drivers') });
      toast.success('Driver updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) return <PageLoader />;
  return (
    <div className="space-y-6">
      <PageHeader icon={<Car className="h-6 w-6" />} title="Drivers" subtitle="Verify documents and see who is on the road." />
      {!data?.length ? (
        <EmptyState icon={<Car />} title="No drivers yet" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((d) => (
            <Card key={d.id} className="p-4">
              <div className="flex items-center gap-3">
                <Avatar name={d.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-bold">
                    {d.name} {d.verified && <BadgeCheck className="h-4 w-4 text-sky-500" />}
                  </div>
                  <div className="truncate text-xs text-slate-500">{d.email}</div>
                </div>
                <Badge tone={d.status === 'online' ? 'green' : d.status === 'busy' ? 'brand' : 'slate'}>{d.status}</Badge>
              </div>
              <div className="mt-3 space-y-1 text-sm">
                <div>
                  {d.vehicle} · <span className="font-mono font-semibold">{d.vehicleNumber}</span>
                </div>
                <div className="text-xs text-slate-500">Licence {d.licenseNumber}</div>
                <div className="flex items-center gap-2">
                  <Rating value={d.rating} />
                  {d.gender === 'female' && <Badge tone="pink">Female</Badge>}
                  {d.simulated && <Badge>Simulated</Badge>}
                </div>
              </div>
              <Button
                size="sm"
                className="mt-3"
                variant={d.verified ? 'secondary' : 'primary'}
                loading={verify.isPending && verify.variables?.id === d.id}
                onClick={() => verify.mutate({ id: d.id, verified: !d.verified })}
              >
                {d.verified ? 'Revoke verification' : 'Approve documents'}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
