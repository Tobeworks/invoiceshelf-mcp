/**
 * Thin client for the InvoiceShelf REST API (v1).
 *
 * Deliberately no HTTP library dependency, Node's built-in fetch covers
 * everything a JSON CRUD API needs.
 */

export interface InvoiceShelfConfig {
  baseUrl: string;
  apiToken: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    method: string,
    endpoint: string,
  ) {
    super(`${method} ${endpoint} -> ${status}: ${ApiError.summarize(body)}`);
    this.name = "ApiError";
  }

  private static summarize(body: unknown): string {
    if (body && typeof body === "object") {
      const b = body as Record<string, unknown>;
      const message = typeof b.message === "string" ? b.message : "";
      const errors = b.errors ? JSON.stringify(b.errors) : "";
      return [message, errors].filter(Boolean).join(" ") || JSON.stringify(body);
    }
    return String(body);
  }
}

export class InvoiceShelfClient {
  private baseUrl: string;
  private apiToken: string;

  constructor(config: InvoiceShelfConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiToken = config.apiToken;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    options: { params?: Record<string, string | number>; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + endpoint);
    for (const [key, value] of Object.entries(options.params ?? {})) {
      url.searchParams.set(key, String(value));
    }

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
      throw new ApiError(res.status, data, method, endpoint);
    }
    return data as T;
  }

  get<T>(endpoint: string, params?: Record<string, string | number>, headers?: Record<string, string>) {
    return this.request<T>("GET", endpoint, { params, headers });
  }

  post<T>(endpoint: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>("POST", endpoint, { body, headers });
  }

  put<T>(endpoint: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>("PUT", endpoint, { body, headers });
  }

  delete<T>(endpoint: string) {
    return this.request<T>("DELETE", endpoint);
  }

  /** Whoami check, used by the test_connection tool. */
  me() {
    return this.get<{ data: Record<string, unknown> }>("/me");
  }
}
