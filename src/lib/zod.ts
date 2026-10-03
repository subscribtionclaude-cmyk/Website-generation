import { z } from 'zod/v4';

/**
 * Every `import { z } from 'zod'` in the app resolves here (alias in vite.config.ts), so this runs
 * before any schema is built or parsed — in every chunk, whatever order the bundler emits them in.
 * Zod's JIT probes `new Function`, which the production CSP forbids (no 'unsafe-eval'); jitless
 * mode skips the probe and validates the same way without eval.
 */
z.config({ jitless: true });

export { z };
