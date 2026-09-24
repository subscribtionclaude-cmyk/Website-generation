interface DeviceHints {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

/**
 * Hybrid motion model: full motion on capable devices, reduced motion when the OS asks for it
 * (handled in CSS) or when the device looks constrained (data saver, ≤2 cores, ≤2 GB memory).
 */
export function shouldReduceMotion(hints: DeviceHints): boolean {
  if (hints.connection?.saveData) return true;
  if (typeof hints.hardwareConcurrency === 'number' && hints.hardwareConcurrency <= 2) return true;
  if (typeof hints.deviceMemory === 'number' && hints.deviceMemory <= 2) return true;
  return false;
}
