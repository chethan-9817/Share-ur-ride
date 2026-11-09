import { RATING_TAGS, type RatingTag } from '@arriveshare/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const tagLabel = (t: RatingTag) => t.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const NEGATIVE: RatingTag[] = ['rash_driving', 'late', 'rude', 'unsafe'];

export function RateRide({ rideId, who = 'your driver' }: { rideId: string; who?: string }) {
  const [score, setScore] = useState(0);
  const [tags, setTags] = useState<RatingTag[]>([]);
  const [comment, setComment] = useState('');
  const qc = useQueryClient();

  const submit = useMutation({
    mutationFn: () => api.post('/ratings', { rideId, score, tags, comment: comment || undefined }),
    onSuccess: () => {
      toast.success('Thanks for the feedback!');
      qc.invalidateQueries({ queryKey: ['ride', rideId] });
      qc.invalidateQueries({ queryKey: ['rides'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const visible = RATING_TAGS.filter((t) => (score > 0 && score <= 3 ? true : !NEGATIVE.includes(t)));

  return (
    <Card className="space-y-4 p-5">
      <div className="text-center">
        <div className="font-bold">How was your ride with {who}?</div>
        <div className="mt-3 flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setScore(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`}>
              <Star className={cn('h-9 w-9 transition', n <= score ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600')} />
            </button>
          ))}
        </div>
      </div>
      {score > 0 && (
        <>
          <div className="flex flex-wrap justify-center gap-2">
            {visible.map((t) => (
              <button
                key={t}
                onClick={() => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t].slice(0, 5)))}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-semibold',
                  tags.includes(t)
                    ? NEGATIVE.includes(t)
                      ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-500/10'
                      : 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                    : 'border-slate-200 dark:border-white/10',
                )}
              >
                {tagLabel(t)}
              </button>
            ))}
          </div>
          {tags.includes('unsafe') && (
            <p className="rounded-xl bg-red-50 p-3 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
              Marking a ride unsafe opens a review with our safety team. If you are in danger now, use SOS or call 112.
            </p>
          )}
          <textarea className="input h-24 py-3" placeholder="Anything else? (optional)" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
          <Button block loading={submit.isPending} onClick={() => submit.mutate()}>
            Submit rating
          </Button>
        </>
      )}
    </Card>
  );
}
