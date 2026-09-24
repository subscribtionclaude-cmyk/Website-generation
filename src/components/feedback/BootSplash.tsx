import styles from './feedback.module.css';

/** Neutral full-screen loading state used before settings/runtime are ready (no text needed). */
export function BootSplash() {
  return (
    <div className={styles.splash} role="status" aria-live="polite">
      <img
        className={styles.splashMark}
        src="/brand/malek-store-mark-192.webp"
        alt=""
        width={72}
        height={71}
      />
      <span className="visually-hidden">Loading… جارٍ التحميل…</span>
    </div>
  );
}
