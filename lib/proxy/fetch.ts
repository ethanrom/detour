// Guarded page fetch: manual redirects (every hop re-validated), 10 s total budget, 4 MB body cap,
// HTML-only content types. The default transport connects to the addresses the guard validated.

import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { pipeline, type Readable } from "node:stream";
import zlib from "node:zlib";
import { ProxyError } from "./errors";
import { defaultLookup, resolvePublicHost, validateUrl, type LookupFn, type ResolvedAddress } from "./guard";

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
export const MAX_REDIRECTS = 4;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface UpstreamResponse {
  status: number;
  /** Lower-case header names. */
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  /** Release the connection without reading the rest of the body. */
  destroy(): void;
}

export interface TransportRequest {
  url: URL;
  /** Already validated by the guard; the transport must connect to one of these and nowhere else. */
  addresses: ResolvedAddress[];
  headers: Record<string, string>;
  signal: AbortSignal;
}

export type Transport = (req: TransportRequest) => Promise<UpstreamResponse>;

export interface FetchDeps {
  transport?: Transport;
  lookup?: LookupFn;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface FetchedPage {
  finalUrl: string;
  html: string;
  /** Size of the decoded upstream body in bytes. */
  bytes: number;
}

// ---- default transport (node:http / node:https, connect pinned to validated addresses) ----------

export const nodeTransport: Transport = ({ url, addresses, headers, signal }) =>
  new Promise<UpstreamResponse>((resolve, reject) => {
    const pinned: LookupFunction = (_host, options, callback) => {
      if (options.all) {
        callback(null, addresses.map((a) => ({ address: a.address, family: a.family })));
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    };
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(url, { method: "GET", headers, lookup: pinned, signal, agent: false }, (res) => {
      const encoding = String(res.headers["content-encoding"] ?? "").trim().toLowerCase();
      let body: Readable = res;
      if (encoding === "gzip" || encoding === "x-gzip") body = pipeline(res, zlib.createGunzip(), () => {});
      else if (encoding === "br") body = pipeline(res, zlib.createBrotliDecompress(), () => {});
      else if (encoding === "deflate") body = pipeline(res, zlib.createInflate(), () => {});
      else if (encoding && encoding !== "identity") {
        res.destroy();
        reject(new ProxyError("fetch-failed", "The site sent a response in an unsupported encoding."));
        return;
      }
      const out: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(res.headers)) out[k] = Array.isArray(v) ? v.join(", ") : v;
      resolve({
        status: res.statusCode ?? 0,
        headers: out,
        body,
        destroy: () => {
          body.destroy();
          res.destroy();
        },
      });
    });
    req.on("error", reject);
    req.end();
  });

// ---- helpers --------------------------------------------------------------------------------------

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ProxyError("timeout", "The site took too long to respond."));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ProxyError("timeout", "The site took too long to respond."));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function isHtmlContentType(value: string | undefined): boolean {
  const type = (value ?? "").split(";")[0].trim().toLowerCase();
  return type === "text/html" || type === "application/xhtml+xml";
}

async function readCapped(res: UpstreamResponse, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const declared = Number(res.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    res.destroy();
    throw new ProxyError("too-large", "That page is too large to analyse (over 4 MB).");
  }
  const onAbort = () => res.destroy();
  signal.addEventListener("abort", onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const chunk of res.body) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        res.destroy();
        throw new ProxyError("too-large", "That page is too large to analyse (over 4 MB).");
      }
      chunks.push(chunk);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  if (signal.aborted) throw new ProxyError("timeout", "The site took too long to respond.");
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Decode with the charset from the header, else from an early <meta>, else UTF-8. */
export function decodeHtml(bytes: Uint8Array, contentType: string | undefined): string {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? "")?.[1];
  let label = fromHeader;
  if (!label) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
    label = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(label ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// ---- main entry -----------------------------------------------------------------------------------

export async function fetchHtml(rawUrl: string, deps: FetchDeps = {}): Promise<FetchedPage> {
  const transport = deps.transport ?? nodeTransport;
  const lookup = deps.lookup ?? defaultLookup;
  const maxBytes = deps.maxBytes ?? MAX_BODY_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? FETCH_TIMEOUT_MS);
  const { signal } = controller;

  try {
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = validateUrl(current);
      const addresses = await raceAbort(resolvePublicHost(url, lookup), signal);
      const res = await raceAbort(
        transport({
          url,
          addresses,
          signal,
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
            "Accept-Language": "en",
            "Accept-Encoding": "gzip, br",
          },
        }),
        signal,
      );

      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const location = res.headers.location;
        res.destroy();
        if (!location) throw new ProxyError(`upstream-${res.status}`, "The site redirected without saying where.");
        if (hop === MAX_REDIRECTS) throw new ProxyError("fetch-failed", "The site redirected too many times.");
        try {
          current = new URL(location, url).href;
        } catch {
          throw new ProxyError("fetch-failed", "The site sent an invalid redirect.");
        }
        continue; // the next iteration re-validates the new target
      }
      if (res.status < 200 || res.status >= 300) {
        res.destroy();
        throw new ProxyError(`upstream-${res.status}`, `The site answered with HTTP ${res.status}.`);
      }
      if (!isHtmlContentType(res.headers["content-type"])) {
        res.destroy();
        throw new ProxyError("not-html", "That address is not a web page (HTML).");
      }
      const bytes = await readCapped(res, maxBytes, signal);
      return {
        finalUrl: url.href,
        html: decodeHtml(bytes, res.headers["content-type"]),
        bytes: bytes.byteLength,
      };
    }
    throw new ProxyError("fetch-failed", "The site redirected too many times.");
  } catch (error) {
    if (error instanceof ProxyError) throw error;
    if (signal.aborted) throw new ProxyError("timeout", "The site took too long to respond.");
    throw new ProxyError("fetch-failed", "The site could not be reached.");
  } finally {
    clearTimeout(timer);
  }
}
