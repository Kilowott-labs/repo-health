import { relativeTime } from '../lib/format';

interface Props {
  iso: string;
  className?: string;
}

export function RelativeTime({ iso, className = '' }: Props) {
  return (
    <time dateTime={iso} title={iso || undefined} className={className}>
      {relativeTime(iso)}
    </time>
  );
}
