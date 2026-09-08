import { RefreshError, type RetrievedPage } from "./refreshTypes";
import { scheduleTimeout } from "../utils/timer";

export const LIMITS = {
  requestMs: 30_000,
  itemMs: 120_000,
  requests: 10,
  bytes: 5 * 1024 * 1024,
};

export class Cancellation {
  cancelled = false;
  private callbacks = new Set<() => void>();
  check() {
    if (this.cancelled) throw new RefreshError("cancelled");
  }
  subscribe(callback: () => void): () => void {
    if (this.cancelled) callback();
    else this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }
  cancel() {
    this.cancelled = true;
    for (const callback of this.callbacks) callback();
    this.callbacks.clear();
  }
}

/** Conservatively reject special-use IPs, including IPv4-mapped IPv6. */
export function isPublicAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (ip.includes(":")) {
    // Only global unicast; exclude documentation, Teredo and 6to4 tunnelling.
    return (
      /^[23][0-9a-f]{3}:/.test(ip) &&
      !/^(2001:(?:0:|db8:|[012][0-9a-f]?:)|2002:)/.test(ip)
    );
  }
  const octets = ip.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return false;
  const [a, b, c] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export function publicURL(value: string, base?: string): URL {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new RefreshError("invalid-url");
  }
  const host = url.hostname.toLowerCase();
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "80" && url.port !== "443") ||
    (!host.includes(".") && !host.includes(":")) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host) ||
    ((/^[\d.]+$/.test(host) || host.includes(":")) && !isPublicAddress(host))
  ) {
    throw new RefreshError("invalid-url");
  }
  url.hash = "";
  return url;
}

export async function resolvePublicHost(
  host: string,
  cancellation: Cancellation,
): Promise<void> {
  cancellation.check();
  const services = Zotero.getMainWindow().Services;
  await new Promise<void>((resolve, reject) => {
    let request: nsICancelable | undefined;
    let remove = () => {};
    const clearTimer = scheduleTimeout(() => {
      request?.cancel(0x804b0002);
      remove();
      reject(new RefreshError("timeout"));
    }, LIMITS.requestMs);
    remove = cancellation.subscribe(() => {
      request?.cancel(0x804b0002);
      clearTimer();
      reject(new RefreshError("cancelled"));
    });
    const listener = {
      onLookupComplete(
        _request: nsICancelable,
        record: nsIDNSRecord,
        status: number,
      ) {
        clearTimer();
        remove();
        if (status || !record) {
          reject(new RefreshError("unavailable"));
          return;
        }
        try {
          const addresses = record.QueryInterface!(
            Zotero.getMainWindow().Components.interfaces.nsIDNSAddrRecord,
          );
          let count = 0;
          while (addresses.hasMore()) {
            if (!isPublicAddress(addresses.getNextAddrAsString()))
              throw new RefreshError("invalid-url");
            count++;
          }
          if (!count) throw new RefreshError("unavailable");
          resolve();
        } catch (error) {
          reject(error);
        }
      },
    };
    try {
      request = services.dns.asyncResolve(
        host.replace(/^\[|\]$/g, ""),
        0,
        0,
        null as unknown as nsIDNSAdditionalInfo,
        listener as unknown as nsIDNSListener,
        services.tm.currentThread,
        {},
      );
    } catch {
      clearTimer();
      remove();
      reject(new RefreshError("unavailable"));
    }
  });
}

export interface RequestBudget {
  remaining: number;
  deadline: number;
}
export function createBudget(): RequestBudget {
  return { remaining: LIMITS.requests, deadline: Date.now() + LIMITS.itemMs };
}
export type PageFetcher = (
  url: string,
  budget: RequestBudget,
  cancellation: Cancellation,
) => Promise<RetrievedPage>;

function createResponseFetcher(
  resolveHost = resolvePublicHost,
  request: typeof Zotero.HTTP.request = (...args) =>
    Zotero.HTTP.request(...args),
  accept = "text/html,application/xhtml+xml",
) {
  return async (
    input: string,
    budget: RequestBudget,
    cancellation: Cancellation,
  ) => {
    let url = publicURL(input);
    const visited = new Set<string>();
    while (true) {
      cancellation.check();
      if (Date.now() >= budget.deadline) throw new RefreshError("timeout");
      if (budget.remaining-- <= 0 || visited.has(url.href))
        throw new RefreshError("budget");
      visited.add(url.href);
      await resolveHost(url.hostname, cancellation);
      cancellation.check();
      const remainingMs = budget.deadline - Date.now();
      if (remainingMs <= 0) throw new RefreshError("timeout");
      let tooLarge = false;
      let remove = () => {};
      let response: XMLHttpRequest;
      try {
        // successCodes:false and errorDelayMax:0 disable Zotero's built-in retries.
        const options = {
          followRedirects: false,
          responseType: "arraybuffer",
          successCodes: false as const,
          errorDelayMax: 0,
          noRetryOnThrottle: true,
          anon: true,
          foreground: false,
          timeout: Math.min(LIMITS.requestMs, remainingMs),
          headers: { Accept: accept },
          cancellerReceiver: (cancel: () => void) => {
            remove = cancellation.subscribe(cancel);
          },
          requestObserver: (xhr: XMLHttpRequest) => {
            xhr.addEventListener("progress", (rawEvent) => {
              const event = rawEvent as ProgressEvent;
              if (
                event.loaded > LIMITS.bytes ||
                (event.lengthComputable && event.total > LIMITS.bytes)
              ) {
                tooLarge = true;
                xhr.abort();
              }
            });
            xhr.addEventListener("readystatechange", () => {
              if (
                xhr.readyState === 2 &&
                Number(xhr.getResponseHeader("Content-Length")) > LIMITS.bytes
              ) {
                tooLarge = true;
                xhr.abort();
              }
            });
          },
        };
        response = await request("GET", url.href, options);
      } catch (error) {
        cancellation.check();
        if (tooLarge) throw new RefreshError("too-large");
        if (
          Date.now() >= budget.deadline ||
          (error instanceof Error &&
            /timeout/i.test(error.name + error.message))
        )
          throw new RefreshError("timeout");
        throw new RefreshError("unavailable");
      } finally {
        remove();
      }
      cancellation.check();
      if (tooLarge) throw new RefreshError("too-large");
      if (response.status >= 300 && response.status < 400) {
        const location = response.getResponseHeader("Location");
        if (!location) throw new RefreshError("unavailable");
        url = publicURL(location, url.href);
        continue;
      }
      if (response.status < 200 || response.status >= 300)
        throw new RefreshError("unavailable");
      const contentType = response.getResponseHeader("Content-Type") || "";
      const bytes = response.response as ArrayBuffer;
      if (!bytes || bytes.byteLength > LIMITS.bytes)
        throw new RefreshError("too-large");
      return { bytes, contentType, url: url.href };
    }
  };
}

export function createPageFetcher(
  resolveHost = resolvePublicHost,
  request: typeof Zotero.HTTP.request = (...args) =>
    Zotero.HTTP.request(...args),
): PageFetcher {
  const fetch = createResponseFetcher(resolveHost, request);
  return async (input, budget, cancellation) => {
    const { bytes, contentType, url } = await fetch(
      input,
      budget,
      cancellation,
    );
    if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(contentType))
      throw new RefreshError("unsupported-page");
    const win = Zotero.getMainWindow();
    const charset =
      /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] || "utf-8";
    let html: string;
    try {
      html = new win.TextDecoder(charset).decode(bytes);
    } catch {
      html = new win.TextDecoder().decode(bytes);
    }
    const document = new win.DOMParser().parseFromString(html, "text/html");
    return { document, url };
  };
}

export const fetchPublisherPage: PageFetcher = (...args) =>
  createPageFetcher()(...args);

export type JSONFetcher = (
  url: string,
  budget: RequestBudget,
  cancellation: Cancellation,
) => Promise<unknown>;
export function createJSONFetcher(
  resolveHost = resolvePublicHost,
  request: typeof Zotero.HTTP.request = (...args) =>
    Zotero.HTTP.request(...args),
): JSONFetcher {
  const fetch = createResponseFetcher(resolveHost, request, "application/json");
  return async (url, budget, cancellation) => {
    const response = await fetch(url, budget, cancellation);
    if (!/^application\/json\b/i.test(response.contentType))
      throw new RefreshError("incomplete");
    try {
      return JSON.parse(
        new (Zotero.getMainWindow().TextDecoder)().decode(response.bytes),
      );
    } catch {
      throw new RefreshError("incomplete");
    }
  };
}
export const fetchJSON: JSONFetcher = (...args) => createJSONFetcher()(...args);
