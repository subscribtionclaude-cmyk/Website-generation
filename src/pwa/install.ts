/**
 * Service worker registration and the browser's install prompt (Chromium's
 * `beforeinstallprompt`). Kept tiny: it runs in the storefront entry.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function subscribeInstall(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const canInstall = () => deferred !== null;

/** Show the browser's install dialog; resolves true when the visitor accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  notify();
  await event.prompt();
  return (await event.userChoice).outcome === 'accepted';
}

/** Never inside the Site Editor preview frame (or any frame), never in development. */
export function isPwaContext(win: Window = window) {
  return win.self === win.top && !win.name.startsWith('malek-preview');
}

export function setupPwa() {
  if (!isPwaContext()) return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Offline support is an enhancement: the store works the same without it.
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
