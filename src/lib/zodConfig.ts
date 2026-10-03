import { z } from 'zod';

/**
 * Imported first by main.tsx. Zod's JIT probes `new Function`, which the production CSP forbids
 * (no 'unsafe-eval'); jitless mode skips the probe and validates the same way without eval.
 */
z.config({ jitless: true });
