import { formatNumber } from '../lib/format';

interface Props {
  value: number;
  format?: boolean; // true: '14k' / '14,440'; false: raw
  className?: string;
}

// Signature type contrast — Instrument Serif italic numbers against Geist body.
// Used in hero bands, big-number displays, per design doc §4.
export function NumberStyled({ value, format = true, className = '' }: Props) {
  return (
    <span className={`font-display italic ${className}`}>
      {format ? formatNumber(value) : value}
    </span>
  );
}
