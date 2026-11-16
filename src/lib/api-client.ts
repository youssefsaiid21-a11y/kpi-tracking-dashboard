/**
 * Typed API client — eliminates manual fetch + json() + error checking boilerplate.
 *
 * Usage:
 *   const data = await api.get<MeetingsResponse>("/api/meetings", { status: "pending" });
 *   const result = await api.post<ReviewResponse>("/api/meetings/123/review", body);
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, init);

  if (res.status === 401) {
    // Don't redirect immediately — let React Query exhaust retries first.
    // Only redirect if not an abort (page navigation).
    throw new ApiError(401, "Unauthorized");
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, `Server returned non-JSON response (HTTP ${res.status})`);
  }

  if (!json.success) {
    throw new ApiError(res.status, json.error || "Request failed");
  }

  return json as T;
}

function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return path;
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `${path}?${qs}` : path;
}

export const api = {
  get<T>(path: string, params?: Record<string, string | number | boolean | undefined>, signal?: AbortSignal): Promise<T> {
    return request<T>(buildUrl(path, params), { signal });
  },

  post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  },

  put<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return request<T>(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  },

  delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>, signal?: AbortSignal): Promise<T> {
    return request<T>(buildUrl(path, params), { method: "DELETE", signal });
  },
};
