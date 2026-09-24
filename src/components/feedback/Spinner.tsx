import { LoaderCircle } from 'lucide-react';
import styles from './feedback.module.css';

export function Spinner({ label }: { label: string }) {
  return (
    <span className={styles.spinner} role="status">
      <LoaderCircle className={styles.spinnerIcon} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
