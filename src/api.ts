export type ApiRecord = Record<string, unknown> & { id: string };

const API_BASE = (import.meta.env.VITE_API_URL?.trim() || "https://library-backend-c7zn.onrender.com/api").replace(/\/+$/, "");

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

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("library-token");
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && options.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetchApi(path, { ...options, headers });
  if (response.status === 401) {
    localStorage.removeItem("library-token");
    window.dispatchEvent(new Event("library:unauthorized"));
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`[API] Request returned ${response.status}: ${options.method || "GET"} ${path}`, body);
    throw new Error(body.error || `Request failed (${response.status})`);
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
