import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router/dom';
import { BootSplash } from '@/components/feedback/BootSplash';
import type { AppConfig } from '@/config/env';
import { createRuntime } from '@/runtime/createRuntime';
import type { AppRuntime } from '@/runtime/types';
import { AppProviders } from './AppProviders';
import { createAppRouter } from './router';

type BootState =
  { status: 'booting' } | { status: 'ready'; runtime: AppRuntime } | { status: 'failed' };

export function App({ config }: { config: AppConfig }) {
  const [boot, setBoot] = useState<BootState>({ status: 'booting' });
  const [router] = useState(createAppRouter);

  useEffect(() => {
    let active = true;
    createRuntime(config).then(
      (runtime) => active && setBoot({ status: 'ready', runtime }),
      (error: unknown) => {
        console.error('Failed to start the application runtime', error);
        if (active) setBoot({ status: 'failed' });
      },
    );
    return () => {
      active = false;
    };
  }, [config]);

  if (boot.status === 'booting') return <BootSplash />;
  if (boot.status === 'failed') return <BootFailed />;

  return (
    <AppProviders runtime={boot.runtime}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}

/** The app bundle could not start (usually a failed chunk download on a flaky connection). */
function BootFailed() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
        <img src="/brand/malek-store-mark-192.webp" alt="MALEK STORE" width={56} height={55} />
        <p lang="ar" dir="rtl">
          تعذر تحميل الموقع. تأكد من الاتصال بالإنترنت وحاول مرة أخرى.
        </p>
        <p lang="en">We couldn&apos;t load the site. Check your connection and try again.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            minHeight: 44,
            padding: '0 20px',
            borderRadius: 999,
            border: 0,
            background: '#0b0b0c',
            color: '#fff',
            fontWeight: 600,
          }}
        >
          حاول تاني · Try again
        </button>
      </div>
    </main>
  );
}
