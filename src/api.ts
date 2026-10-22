export type ApiRecord = Record<string, unknown> & { id: string };

const configuredApiUrl = (import.meta.env.VITE_API_URL?.trim() || "https://library-backend-c7zn.onrender.com").replace(/\/+$/, "");
const API_BASE = /\/api$/i.test(configuredApiUrl) ? configuredApiUrl : `${configuredApiUrl}/api`;
const CACHE_PREFIX = "library-cache-v1:";
const QUEUE_KEY = "library-offline-queue-v1";
const COLLECTION_PATHS = new Set([
  "/books",
  "/exam-sheets",
  "/patrons",
  "/loans",
  "/inventory",
  "/media",
  "/reservations",
  "/custom-fields",
  "/portal/loans",
  "/portal/reservations",
  "/audit-logs",
]);

type QueuedAction = { id: string; userId: string; path: string; data: unknown };

const EMPTY_DASHBOARD = {
  totalBooks: 0,
  availableBooks: 0,
  borrowedBooks: 0,
  activeStudents: 0,
  borrowersThisMonth: 0,
  overdueBooks: 0,
  finesCollected: 0,
  borrowingTrends: [],
  categories: [],
  bookCategories: [],
  recentLoans: [],
};

function currentUserId(): string {
  try {
    const user = JSON.parse(localStorage.getItem("library-user") || "null") as { id?: unknown } | null;
    return typeof user?.id === "string" ? user.id : "anonymous";
  } catch {
    return "anonymous";
  }
}

function cachePrefix(): string {
  return `${CACHE_PREFIX}${encodeURIComponent(currentUserId())}:`;
}

function readCache<T>(path: string): T | undefined {
  try {
    const cached = localStorage.getItem(`${cachePrefix()}${encodeURIComponent(path)}`);
    return cached === null ? undefined : JSON.parse(cached) as T;
  } catch {
    return undefined;
  }
}

function writeCache(path: string, value: unknown): void {
  try {
    localStorage.setItem(`${cachePrefix()}${encodeURIComponent(path)}`, JSON.stringify(value));
  } catch {
    // Keep the network response usable when browser storage is unavailable or full.
  }
}

function readQueue(): QueuedAction[] {
  try {
    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]") as unknown;
    return Array.isArray(queue) ? queue as QueuedAction[] : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedAction[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    throw new Error("Unable to save this action for offline sync. Free some browser storage and try again.");
  }
}

function getCachedResource(pathname: string): Record<string, unknown>[] {
  const prefix = cachePrefix();
  const found: Record<string, unknown>[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    try {
      const cachedPath = decodeURIComponent(key.slice(prefix.length));
      if (new URL(cachedPath, window.location.origin).pathname !== pathname) continue;
      const value = JSON.parse(localStorage.getItem(key) || "null") as unknown;
      if (Array.isArray(value)) found.push(...value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")));
    } catch {
      continue;
    }
  }
  return [...new Map(found.map((record) => [String(record.id), record])).values()];
}

function filterCached(path: string): unknown | undefined {
  const exact = readCache<unknown>(path);
  if (exact !== undefined) return exact;
  let requested: URL;
  try {
    requested = new URL(path, window.location.origin);
  } catch {
    return undefined;
  }
  const records = getCachedResource(requested.pathname);
  if (!records.length) return undefined;
  const params = requested.searchParams;
  const search = params.get("search")?.trim().toLowerCase();
  const filtered = records.filter((record) => {
    if (search && !Object.values(record).some((value) => String(value ?? "").toLowerCase().includes(search))) return false;
    const type = params.get("type");
    const recordType = record.type ?? record.borrowerType;
    if (type && type !== "ALL" && recordType && String(recordType) !== type) return false;
    const status = params.get("status");
    if (status && status !== "ALL" && record.status && String(record.status) !== status && !(status === "ACTIVE" && record.status === "CHECKED_OUT")) return false;
    const patronId = params.get("patronId");
    if (patronId && String(record.patronId ?? "") !== patronId) return false;
    return true;
  });
  return filtered;
}

function emptyResponse(path: string): unknown | undefined {
  let pathname: string;
  try {
    pathname = new URL(path, window.location.origin).pathname;
  } catch {
    return undefined;
  }
  if (pathname === "/dashboard") return EMPTY_DASHBOARD;
  if (COLLECTION_PATHS.has(pathname)) return [];
  return undefined;
}

function isQueueable(path: string): boolean {
  return path === "/patrons" || path === "/loans";
}

function queueAction(path: string, data: unknown): Record<string, unknown> {
  const id = `offline-${crypto.randomUUID()}`;
  const action = { id, userId: currentUserId(), path, data };
  writeQueue([...readQueue(), action]);
  if (path === "/patrons") return { ...(data as Record<string, unknown>), id, active: true, offlinePending: true };
  return { id, offlinePending: true };
}

function pendingRecords(path: string, records: Record<string, unknown>[]): Record<string, unknown>[] {
  const params = new URL(path, window.location.origin).searchParams;
  const pending = readQueue().filter((action) => action.userId === currentUserId());
  const additions: Record<string, unknown>[] = [];
  for (const action of pending) {
    const data = action.data as Record<string, unknown>;
    if (action.path === "/patrons" && path.split("?", 1)[0] === "/patrons") {
      if (!params.get("type") || params.get("type") === data.type) additions.push({ ...data, id: action.id, active: true, offlinePending: true });
    }
    if (action.path === "/loans" && path.split("?", 1)[0] === "/loans") {
      if (params.get("type") && params.get("type") !== "ALL" && params.get("type") !== data.patronType) continue;
      const patron = getCachedResource("/patrons").find((record) => record.id === data.patronId);
      const items = Array.isArray(data.items) ? data.items as { type: string; id: string }[] : [];
      for (const [index, item] of items.entries()) {
        const resourcePath = item.type === "BOOK" ? "/books" : "/exam-sheets";
        const resource = getCachedResource(resourcePath).find((record) => record.id === item.id);
        additions.push({
          id: `${action.id}-${index}`, loanItemId: `${action.id}-${index}`, loanId: action.id,
          itemType: item.type, title: resource?.title ?? "Offline queued item", author: resource?.author ?? resource?.subject ?? "",
          borrowerName: patron?.name ?? "", memberCode: patron?.memberCode ?? "", patronId: data.patronId,
          borrowerType: data.patronType, dueDate: data.dueDate, status: "CHECKED_OUT", fine: 0, finePaid: 0, fineRemaining: 0,
          offlinePending: true,
        });
      }
    }
  }
  return [...records, ...additions.filter((item) => !records.some((record) => record.id === item.id))];
}

async function syncOfflineQueue(): Promise<void> {
  if (!navigator.onLine || syncingQueue) return;
  syncingQueue = true;
  try {
    const queue = readQueue();
    const actions = [...queue];
    const remaining: QueuedAction[] = [];
    for (const [index, action] of actions.entries()) {
      if (action.userId !== currentUserId()) {
        remaining.push(action);
        continue;
      }
      try {
        const result = await request<unknown>(action.path, { method: "POST", body: JSON.stringify(action.data) }, false);
        if (action.path === "/patrons" && result && typeof result === "object" && typeof (result as { id?: unknown }).id === "string") {
          const realPatronId = (result as { id: string }).id;
          for (const later of actions.slice(index + 1)) {
            if (later.path !== "/loans" || !later.data || typeof later.data !== "object") continue;
            const loanData = later.data as Record<string, unknown>;
            if (loanData.patronId === action.id) later.data = { ...loanData, patronId: realPatronId };
          }
        }
      } catch {
        remaining.push(...actions.slice(index));
        break;
      }
    }
    writeQueue(remaining);
    if (remaining.length < queue.length) window.dispatchEvent(new Event("library:offline-sync-complete"));
  } finally {
    syncingQueue = false;
  }
}

let syncingQueue = false;
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { void syncOfflineQueue(); });
  if (navigator.onLine) void syncOfflineQueue();
}

async function fetchApi(path: string, options: RequestInit): Promise<Response> {
  const url = `${API_BASE}${path}`;
  try {
    return await fetch(url, options);
  } catch (cause) {
    const method = options.method || "GET";
    let endpoint: string;
    try {
      const parsedUrl = new URL(url);
      endpoint = `${parsedUrl.origin}${parsedUrl.pathname}`;
    } catch {
      endpoint = API_BASE;
    }
    console.error(`[API] Network request failed: ${method} ${endpoint}`, cause);
    throw new Error(`Could not reach the library API at ${endpoint}. Confirm the server is running and allows this frontend origin.`);
  }
}

export async function request<T>(path: string, options: RequestInit = {}, allowQueue = true): Promise<T> {
  const method = options.method || "GET";
  if (method === "GET" && !navigator.onLine) {
    const cached = filterCached(path);
    if (cached !== undefined) return pendingRecords(path, Array.isArray(cached) ? cached as Record<string, unknown>[] : []) as T;
    const fallback = emptyResponse(path);
    if (fallback !== undefined) return fallback as T;
    throw new Error("No cached data is available for this view while offline.");
  }
  if (allowQueue && method === "POST" && isQueueable(path) && !navigator.onLine) {
    return queueAction(path, JSON.parse(String(options.body || "{}"))) as T;
  }
  const token = localStorage.getItem("library-token");
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && options.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetchApi(path, { ...options, headers });
  } catch (cause) {
    if (method === "GET") {
      const cached = filterCached(path);
      if (cached !== undefined) return pendingRecords(path, Array.isArray(cached) ? cached as Record<string, unknown>[] : []) as T;
      const fallback = emptyResponse(path);
      if (fallback !== undefined) return fallback as T;
    }
    if (allowQueue && method === "POST" && isQueueable(path)) return queueAction(path, JSON.parse(String(options.body || "{}"))) as T;
    throw cause;
  }
  if (response.status === 401) {
    localStorage.removeItem("library-token");
    window.dispatchEvent(new Event("library:unauthorized"));
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`[API] Request returned ${response.status}: ${options.method || "GET"} ${path}`, body);
    if (method === "GET" && response.status >= 500) {
      const cached = filterCached(path);
      if (cached !== undefined) return pendingRecords(path, Array.isArray(cached) ? cached as Record<string, unknown>[] : []) as T;
      const fallback = emptyResponse(path);
      if (fallback !== undefined) return fallback as T;
    }
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  if (method === "GET") {
    writeCache(path, body);
    if (Array.isArray(body)) return pendingRecords(path, body as Record<string, unknown>[]) as T;
  }
  return body as T;
}

export async function download(path: string): Promise<Blob> {
  const token = localStorage.getItem("library-token");
  const response = await fetchApi(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    console.error(`[API] Download returned ${response.status}: GET ${path}`);
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.blob();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(data) }),
  put: <T>(path: string, data: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
