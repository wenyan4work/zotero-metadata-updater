import { assert } from "chai";
import {
  Cancellation,
  createBudget,
  createPageFetcher,
  createJSONFetcher,
  LIMITS,
} from "../src/modules/publisherTransport";
import { RefreshError } from "../src/modules/refreshTypes";

const htmlResponse = (
  status = 200,
  headers: Record<string, string> = {},
  body = "<html><head></head><body>article</body></html>",
) =>
  ({
    status,
    response: new (Zotero.getMainWindow().TextEncoder)().encode(body).buffer,
    getResponseHeader: (key: string) =>
      headers[key.toLowerCase()] ??
      (key.toLowerCase() === "content-type"
        ? "text/html; charset=utf-8"
        : null),
  }) as XMLHttpRequest;
async function fails(action: Promise<unknown>, reason: string) {
  try {
    await action;
    assert.fail("Expected failure");
  } catch (error) {
    assert.instanceOf(error, RefreshError);
    assert.equal((error as RefreshError).reason, reason);
  }
}

describe("bounded publisher transport", function () {
  it("validates every redirect and uses inert document parsing with no retries", async function () {
    const hosts: string[] = [];
    const urls: string[] = [];
    const fetch = createPageFetcher(
      async (host) => {
        hosts.push(host);
      },
      async (_method, url, options) => {
        urls.push(url);
        assert.isFalse(options!.followRedirects);
        assert.strictEqual(options!.successCodes, false);
        assert.equal(options!.errorDelayMax, 0);
        assert.isAtMost(options!.timeout!, LIMITS.requestMs);
        if (urls.length === 1)
          return htmlResponse(302, {
            location: "https://journals.plos.org/article",
          });
        return htmlResponse(
          200,
          {},
          '<html><body><script>throw new Error("must not execute")</script><img src="http://127.0.0.1/private" /></body></html>',
        );
      },
    );
    const page = await fetch(
      "https://doi.org/10.1234/x",
      createBudget(),
      new Cancellation(),
    );
    assert.deepEqual(hosts, ["doi.org", "journals.plos.org"]);
    assert.equal(page.url, "https://journals.plos.org/article");
    assert.isNull(page.document.defaultView);
  });

  it("rejects redirects to private destinations before making another request", async function () {
    let calls = 0;
    const fetch = createPageFetcher(
      async () => {},
      async () => {
        calls++;
        return htmlResponse(302, {
          location: "http://169.254.169.254/latest/meta-data",
        });
      },
    );
    await fails(
      fetch("https://doi.org/10.1234/x", createBudget(), new Cancellation()),
      "invalid-url",
    );
    assert.equal(calls, 1);
  });

  it("enforces request count, deadline, redirect loops and DNS failures", async function () {
    let calls = 0;
    const fetch = createPageFetcher(
      async () => {},
      async (_method, url) => {
        calls++;
        return htmlResponse(302, { location: `${url}/next` });
      },
    );
    const budget = createBudget();
    await fails(
      fetch("https://plos.org/a", budget, new Cancellation()),
      "budget",
    );
    assert.equal(calls, 10);
    await fails(
      fetch(
        "https://plos.org/a",
        { remaining: 10, deadline: Date.now() - 1 },
        new Cancellation(),
      ),
      "timeout",
    );
    assert.equal(calls, 10);
    const loop = createPageFetcher(
      async () => {},
      async () => htmlResponse(302, { location: "https://plos.org/a" }),
    );
    await fails(
      loop("https://plos.org/a", createBudget(), new Cancellation()),
      "budget",
    );
    const dns = createPageFetcher(
      async () => {
        throw new RefreshError("invalid-url");
      },
      async () => {
        assert.fail("DNS failure must stop request");
      },
    );
    await fails(
      dns("https://plos.org/a", createBudget(), new Cancellation()),
      "invalid-url",
    );
  });

  it("rejects PDFs, errors and oversized responses", async function () {
    for (const [response, reason] of [
      [
        htmlResponse(200, { "content-type": "application/pdf" }),
        "unsupported-page",
      ],
      [htmlResponse(429), "unavailable"],
      [htmlResponse(503), "unavailable"],
      [
        { ...htmlResponse(), response: new ArrayBuffer(LIMITS.bytes + 1) },
        "too-large",
      ],
    ] as const) {
      let calls = 0;
      const fetch = createPageFetcher(
        async () => {},
        async () => {
          calls++;
          return response as XMLHttpRequest;
        },
      );
      await fails(
        fetch("https://plos.org/a", createBudget(), new Cancellation()),
        reason,
      );
      assert.equal(calls, 1);
    }
  });

  it("aborts oversized streaming responses before parsing", async function () {
    let aborted = false;
    const fetch = createPageFetcher(
      async () => {},
      async (_method, _url, options) => {
        const listeners = new Map<string, (event: unknown) => void>();
        options!.requestObserver!({
          addEventListener: (type: string, fn: (event: unknown) => void) =>
            listeners.set(type, fn),
          abort: () => {
            aborted = true;
          },
        });
        listeners.get("progress")!({
          loaded: LIMITS.bytes + 1,
          lengthComputable: false,
        });
        return htmlResponse();
      },
    );
    await fails(
      fetch("https://plos.org/a", createBudget(), new Cancellation()),
      "too-large",
    );
    assert.isTrue(aborted);
  });

  it("propagates cancellation to the active request and never returns a late page", async function () {
    const cancellation = new Cancellation();
    let aborted = false;
    const fetch = createPageFetcher(
      async () => {},
      async (_method, _url, options) => {
        options!.cancellerReceiver!(() => {
          aborted = true;
        });
        cancellation.cancel();
        return htmlResponse();
      },
    );
    await fails(
      fetch("https://plos.org/a", createBudget(), cancellation),
      "cancelled",
    );
    assert.isTrue(aborted);
  });

  describe("bounded Crossref JSON transport", function () {
    it("requests JSON without credentials/retries and validates its content", async function () {
      const fetch = createJSONFetcher(
        async () => {},
        async (_method, _url, options) => {
          assert.equal(options!.headers!.Accept, "application/json");
          assert.isTrue((options as { anon?: boolean }).anon);
          assert.equal(options!.errorDelayMax, 0);
          return htmlResponse(
            200,
            { "content-type": "application/json; charset=utf-8" },
            '{"status":"ok"}',
          );
        },
      );
      assert.deepEqual(
        await fetch(
          "https://api.crossref.org/works/10.1234%2Fx",
          createBudget(),
          new Cancellation(),
        ),
        { status: "ok" },
      );
    });

    it("rejects throttling, invalid JSON, HTML and oversized responses without retries", async function () {
      for (const [response, expected] of [
        [htmlResponse(429), "unavailable"],
        [htmlResponse(404), "unavailable"],
        [
          htmlResponse(200, { "content-type": "application/json" }, "{"),
          "incomplete",
        ],
        [htmlResponse(), "incomplete"],
        [
          htmlResponse(
            200,
            { "content-type": "application/json" },
            " ".repeat(LIMITS.bytes + 1),
          ),
          "too-large",
        ],
      ] as const) {
        let calls = 0;
        const fetch = createJSONFetcher(
          async () => {},
          async () => {
            calls++;
            return response;
          },
        );
        await fails(
          fetch(
            "https://api.crossref.org/works/10.1234%2Fx",
            createBudget(),
            new Cancellation(),
          ),
          expected,
        );
        assert.equal(calls, 1);
      }
    });
  });
});
