export default async function teardown() {
  const h = (globalThis as any).__e2e;
  if (h) { h.server.close(); await h.stack.stop(); }
}
