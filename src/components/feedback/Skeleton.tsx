import type { CSSProperties } from 'react';
import styles from './feedback.module.css';

export function Skeleton({
  width = '100%',
  height = '1rem',
  radius,
  className,
}: {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  radius?: CSSProperties['borderRadius'];
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={[styles.skeleton, className].filter(Boolean).join(' ')}
      style={{ width, height, borderRadius: radius }}
    />
  );
}
