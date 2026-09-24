import type { ConfigIssue } from '@/config/env';
import styles from './ConfigErrorScreen.module.css';

/**
 * Shown when the environment is misconfigured (e.g. live mode without Supabase, or a secret key in
 * the bundle). Deliberately standalone and bilingual: it renders before any provider exists.
 * It names variables, never their values.
 */
export function ConfigErrorScreen({ issues }: { issues: ConfigIssue[] }) {
  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <img src="/brand/malek-store-mark-192.webp" alt="MALEK STORE" width={56} height={55} />
        <div lang="ar" dir="rtl" className={styles.block}>
          <h1>إعدادات التشغيل غير مكتملة</h1>
          <p>لا يمكن تشغيل الموقع بالإعدادات الحالية. راجع ملف البيئة واتبع التعليمات في README.</p>
        </div>
        <div lang="en" dir="ltr" className={styles.block}>
          <h2>Configuration incomplete</h2>
          <p>
            The site can&apos;t start with the current environment. Fix the variables below (see
            README).
          </p>
          <ul className={styles.issues}>
            {issues.map((issue) => (
              <li key={issue.code}>
                <code>{issue.variable}</code> — {issue.message}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
