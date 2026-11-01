import { AsyncLocalStorage } from "node:async_hooks";

const tenantStorage = new AsyncLocalStorage<string | null>();

export function currentTenantId(): string | null {
  return tenantStorage.getStore() ?? null;
}

export function runWithTenant<T>(tenantId: string | null, callback: () => T): T {
  return tenantStorage.run(tenantId, callback);
}
