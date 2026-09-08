import { assert } from "chai";
import { createPrivateRequest } from "../src/modules/privateRequest";
import {
  Cancellation,
  createBudget,
  createPageFetcher,
} from "../src/modules/publisherTransport";
import { RefreshError } from "../src/modules/refreshTypes";

const marker = "synthetic-private-query";
const target = `https://journals.plos.org/article?id=${marker}`;

class FakeXHR {
  mozBackgroundRequest = false;
  responseType = "";
  timeout = 0;
  status = 200;
  response = new (Zotero.getMainWindow().TextEncoder)().encode("<html></html>")
    .buffer;
  channel = {
    loadFlags: 0,
    notificationCallbacks: null as nsIInterfaceRequestor | null,
  };
  listeners = new Map<string, Set<EventListener>>();
  opened = "";
  sent = 0;
  aborted = false;
  onSend = () => this.emit("load");
  open(_method: string, url: string) {
    this.opened = url;
  }
  send() {
    this.sent++;
    this.onSend();
  }
  abort() {
    this.aborted = true;
    this.emit("abort");
  }
  setRequestHeader() {}
  getResponseHeader(name: string) {
    return name.toLowerCase() === "content-type" ? "text/html" : null;
  }
  addEventListener(name: string, listener: EventListener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(listener);
  }
  removeEventListener(name: string, listener: EventListener) {
    this.listeners.get(name)?.delete(listener);
  }
  emit(name: string) {
    for (const listener of [...(this.listeners.get(name) || [])])
      if (typeof listener === "function")
        listener(new (Zotero.getMainWindow().Event)(name));
  }
  get xhr() {
    return this as unknown as XMLHttpRequest;
  }
  assertClean() {
    assert.isTrue([...this.listeners.values()].every((set) => !set.size));
    assert.isNull(this.channel.notificationCallbacks);
  }
}

describe("private request adapter", function () {
  it("keeps query parameters while disabling cookies, caching, and dialogs", async function () {
    const fake = new FakeXHR();
    const request = createPrivateRequest(() => fake.xhr);
    assert.strictEqual(await request("GET", target), fake.xhr);
    assert.equal(fake.opened, target);
    assert.isTrue(fake.mozBackgroundRequest);
    const flags = Zotero.getMainWindow().Components.interfaces.nsIRequest;
    for (const flag of [
      flags.LOAD_ANONYMOUS!,
      flags.LOAD_BYPASS_CACHE!,
      flags.INHIBIT_CACHING!,
    ])
      assert.equal(fake.channel.loadFlags & flag, flag);
    fake.assertClean();
  });

  it("never logs private URLs or returns native details on any terminal path", async function () {
    const originalDebug = Zotero.debug;
    const originalError = Zotero.logError;
    let leaked = false;
    const inspect = (...args: unknown[]) => {
      if (args.some((arg) => String(arg).includes(marker))) leaked = true;
    };
    Zotero.debug = inspect;
    Zotero.logError = inspect;
    try {
      for (const event of ["load", "error", "timeout", "abort", "throw"]) {
        const fake = new FakeXHR();
        fake.onSend = () => {
          if (event === "throw") throw new Error(target);
          fake.emit(event);
        };
        const action = createPrivateRequest(() => fake.xhr)("GET", target);
        if (event === "load") await action;
        else {
          try {
            await action;
            assert.fail("Expected sanitized failure");
          } catch (error) {
            assert.instanceOf(error, RefreshError);
            assert.equal(
              (error as RefreshError).reason,
              event === "timeout" ? "timeout" : "unavailable",
            );
            assert.notInclude(String(error), marker);
          }
        }
        fake.assertClean();
      }
      assert.isFalse(leaked);
    } finally {
      Zotero.debug = originalDebug;
      Zotero.logError = originalError;
    }
  });

  it("denies channel redirects and revalidates destinations before a second request", async function () {
    for (const destination of [
      `https://journals.plos.org/next?id=${marker}`,
      `http://127.0.0.1/private?id=${marker}`,
    ]) {
      const first = new FakeXHR();
      const second = new FakeXHR();
      const calls: string[] = [];
      let denied = false;
      first.onSend = () => {
        const { interfaces: Ci, results: Cr } =
          Zotero.getMainWindow().Components;
        const sink = first.channel.notificationCallbacks!.getInterface(
          Ci.nsIChannelEventSink,
        );
        sink.asyncOnChannelRedirect(
          { cancel: () => first.emit("abort") } as unknown as nsIChannel,
          { URI: { spec: destination } } as nsIChannel,
          0,
          {
            onRedirectVerifyCallback: (status: number) => {
              denied = status === Cr.NS_BINDING_ABORTED;
              first.emit("abort");
            },
          } as nsIAsyncVerifyRedirectCallback,
        );
      };
      let count = 0;
      const fetch = createPageFetcher(
        async (host) => {
          calls.push(host);
        },
        createPrivateRequest(() => (count++ ? second.xhr : first.xhr)),
      );
      const action = fetch(target, createBudget(), new Cancellation());
      if (destination.startsWith("https")) {
        assert.equal((await action).url, destination);
        assert.equal(count, 2);
        second.assertClean();
      } else {
        try {
          await action;
          assert.fail("Expected private redirect rejection");
        } catch (error) {
          assert.equal((error as RefreshError).reason, "invalid-url");
        }
        assert.equal(count, 1);
        assert.lengthOf(calls, 1);
      }
      assert.isTrue(denied);
      first.assertClean();
    }
  });

  it("cancels before send and during a request, removing all listeners", async function () {
    for (const beforeSend of [true, false]) {
      const fake = new FakeXHR();
      let cancel = () => {};
      fake.onSend = () => cancel();
      try {
        await createPrivateRequest(() => fake.xhr)("GET", target, {
          cancellerReceiver: (callback: () => void) => {
            cancel = callback;
            if (beforeSend) cancel();
          },
        });
        assert.fail("Expected cancellation");
      } catch (error) {
        assert.instanceOf(error, RefreshError);
        assert.notInclude(String(error), marker);
      }
      assert.equal(fake.sent, beforeSend ? 0 : 1);
      assert.isTrue(fake.aborted);
      fake.assertClean();
    }
  });
});
