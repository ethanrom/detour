// Error codes of the page proxy. They travel in the `X-Detour-Proxy-Error` header and in the `error`
// field of the `mode=check` JSON, so the UI can show a friendly message per code.

export type ProxyErrorCode =
  | "bad-url"
  | "blocked-host"
  | "not-html"
  | "too-large"
  | "timeout"
  | "fetch-failed"
  | "rate-limited"
  | `upstream-${number}`;

export class ProxyError extends Error {
  readonly code: ProxyErrorCode;
  readonly status: number;
  constructor(code: ProxyErrorCode, message: string) {
    super(message);
    this.name = "ProxyError";
    this.code = code;
    this.status = statusForCode(code);
  }
}

export function statusForCode(code: ProxyErrorCode): number {
  if (code === "bad-url") return 400;
  if (code === "blocked-host") return 403;
  if (code === "not-html" || code === "too-large") return 422;
  if (code === "rate-limited") return 429;
  if (code === "timeout") return 504;
  return 502; // fetch-failed and upstream-<status>
}
