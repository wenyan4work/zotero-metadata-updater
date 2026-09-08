import { RefreshError } from "./refreshTypes";

/** A deliberately small GET adapter: no HTTP helper logging or automatic retries. */
export function createPrivateRequest(
  createXHR: () => XMLHttpRequest = () =>
    new (Zotero.getMainWindow().XMLHttpRequest)({ mozAnon: true }),
): typeof Zotero.HTTP.request {
  return async (method, url, options = {}) => {
    if (method !== "GET") throw new RefreshError("unavailable");
    return new Promise<XMLHttpRequest>((resolve, reject) => {
      let xhr: XMLHttpRequest | undefined;
      let channel: nsIChannel | undefined;
      let previous: nsIInterfaceRequestor | null = null;
      let settled = false;
      const listeners: [string, EventListener][] = [];
      const cleanup = () => {
        for (const [event, listener] of listeners)
          xhr?.removeEventListener(event, listener);
        listeners.length = 0;
        if (channel)
          channel.notificationCallbacks = previous as nsIInterfaceRequestor;
      };
      const finish = (response?: XMLHttpRequest, reason = "unavailable") => {
        if (settled) return;
        settled = true;
        try {
          cleanup();
        } catch {
          // Cleanup failures must not surface native request details.
        }
        if (response) resolve(response);
        else
          reject(
            new RefreshError(reason === "timeout" ? "timeout" : "unavailable"),
          );
      };
      const abort = () => {
        finish();
        try {
          xhr?.abort();
        } catch {
          // Native exceptions can contain private request URLs.
        }
      };
      try {
        const win = Zotero.getMainWindow();
        const { interfaces: Ci, results: Cr } = win.Components;
        xhr = createXHR();
        xhr.mozBackgroundRequest = true;
        xhr.open("GET", url, true);
        xhr.responseType = "arraybuffer";
        xhr.timeout = options.timeout || 30_000;
        channel = xhr.channel as unknown as nsIChannel;
        if (!channel) throw new RefreshError("unavailable");
        channel.loadFlags |=
          Ci.nsIRequest.LOAD_ANONYMOUS! |
          Ci.nsIRequest.LOAD_BYPASS_CACHE! |
          Ci.nsIRequest.INHIBIT_CACHING!;
        previous = channel.notificationCallbacks;
        const sink = {
          QueryInterface: win.ChromeUtils.generateQI(["nsIChannelEventSink"]),
          asyncOnChannelRedirect(
            oldChannel: nsIChannel,
            newChannel: nsIChannel,
            _flags: number,
            callback: nsIAsyncVerifyRedirectCallback,
          ) {
            try {
              const location = newChannel.URI.spec;
              // Deny the channel redirect. The caller validates the new URL and
              // DNS before creating a separate anonymous request.
              finish({
                status: 302,
                getResponseHeader: (name: string) =>
                  name.toLowerCase() === "location" ? location : null,
              } as XMLHttpRequest);
              callback.onRedirectVerifyCallback(Cr.NS_BINDING_ABORTED);
              oldChannel.cancel(Cr.NS_BINDING_ABORTED);
            } catch {
              abort();
            }
          },
        };
        channel.notificationCallbacks = {
          QueryInterface: win.ChromeUtils.generateQI(["nsIInterfaceRequestor"]),
          getInterface(iid: { equals(other: unknown): boolean }) {
            if (iid.equals(Ci.nsIChannelEventSink)) return sink;
            if (previous) return previous.getInterface(iid as unknown as nsIID);
            throw Cr.NS_ERROR_NO_INTERFACE;
          },
        } as unknown as nsIInterfaceRequestor;
        const listen = (event: string, listener: EventListener) => {
          listeners.push([event, listener]);
          xhr!.addEventListener(event, listener);
        };
        listen("load", () => finish(xhr));
        listen("error", () => finish());
        listen("timeout", () => finish(undefined, "timeout"));
        listen("abort", () => finish());
        for (const [name, value] of Object.entries(options.headers || {}))
          xhr.setRequestHeader(name, String(value));
        options.requestObserver?.(xhr);
        options.cancellerReceiver?.(abort);
        if (!settled) xhr.send();
      } catch {
        abort();
      }
    });
  };
}

export const requestPrivately: typeof Zotero.HTTP.request = (...args) =>
  createPrivateRequest()(...args);
