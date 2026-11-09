import { MapPinOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/primitives';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <EmptyState
        icon={<MapPinOff />}
        title="This page took a wrong turn"
        body="The link may be broken or the page may have moved."
        action={
          <Link to="/">
            <Button>Back home</Button>
          </Link>
        }
      />
    </div>
  );
}
