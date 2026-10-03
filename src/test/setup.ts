import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// CI runners are slower than workstations: give findBy* / waitFor up to 5 s before failing (a real
// failure still fails — it just reports after 5 s instead of 1 s). Per-test timeouts stay explicit.
configure({ asyncUtilTimeout: 5000 });

// jsdom has <dialog> but not the modal API; emulate the parts the Drawer relies on.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

beforeEach(() => {
  if (typeof window === 'undefined') return; // node-environment test files
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.documentElement.lang = 'ar-EG';
  document.documentElement.dir = 'rtl';
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  cleanup();
});
