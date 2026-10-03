import '@/styles/fonts';
import '@/styles/tokens.css';
import '@/styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { ConfigErrorScreen } from '@/app/ConfigErrorScreen';
import { resolveAppConfig } from '@/config/env';
import { setupPwa } from '@/pwa/install';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

const result = resolveAppConfig(import.meta.env);
const root = createRoot(container);

setupPwa();

/**
 * First app paint with the real fonts: wait briefly for the faces the first screen uses (the boot
 * screen stays up meanwhile), so text does not reflow — a layout shift — when they arrive after the
 * first paint. Capped: a slow or blocked font never holds the page back for long, and the normal
 * `font-display: swap` applies after the cap.
 */
const FONT_WAIT_MS = 1000;

function firstScreenFonts(): Promise<unknown> {
  const fonts = typeof document.fonts?.load === 'function' ? document.fonts : null;
  if (!fonts) return Promise.resolve();
  const english = /^\/en(\/|$)/.test(window.location.pathname);
  // Each face with a sample covering the subsets it serves (Arabic + Latin, digits for prices).
  const faces = english
    ? ['400 1em "Manrope Variable"', '700 1em "Manrope Variable"']
    : [400, 500, 600, 700].map((weight) => `${weight} 1em "IBM Plex Sans Arabic"`);
  const sample = english ? 'Aa0' : '\u0627Aa';
  return Promise.race([
    Promise.all([
      ...faces.map((face) => fonts.load(face, sample)),
      fonts.load('700 1em "Manrope Variable"', '0123'),
    ]).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
  ]);
}

// A promise chain, not top-level await: that would change how the bundler splits the entry chunk.
void firstScreenFonts().then(() => {
  root.render(
    <StrictMode>
      {result.ok ? <App config={result.config} /> : <ConfigErrorScreen issues={result.issues} />}
    </StrictMode>,
  );
});
