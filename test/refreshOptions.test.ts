import recorded from "./fixtures/live/publisher-heads.json";
import { assert } from "chai";
import { config } from "../package.json";
import { resolvePublisher } from "../src/modules/publisherResolver";
import {
  Cancellation,
  LIMITS,
  type PageFetcher,
  type JSONFetcher,
} from "../src/modules/publisherTransport";
import { RefreshError, type ItemSnapshot } from "../src/modules/refreshTypes";
import {
  buildPatch,
  snapshotItem,
  applyPublisherRecord,
} from "../src/modules/metadataWriter";
import { runBatch } from "../src/modules/refreshBatch";
import {
  readRefreshOptions,
  registerRefreshPreferences,
  unregisterRefreshPreferences,
} from "../src/modules/refreshPreferences";
import { getPref, setPref } from "../src/utils/prefs";
import { extractCrossrefRecord } from "../src/modules/crossref";

const data = {
  status: "ok",
  "message-type": "work",
  message: {
    DOI: "10.1234/article",
    type: "journal-article",
    title: ["Crossref title"],
    abstract: "<jats:p>New abstract</jats:p>",
  },
};
const base: ItemSnapshot = {
  id: 1,
  libraryID: 1,
  key: "ABCDEFGH",
  itemType: "journalArticle",
  fields: {
    title: "Old",
    DOI: "10.1234/article",
    url: "https://plos.org/article",
    abstractNote: "Old abstract",
  },
  creators: [],
};
const enabled = { updateAbstract: true, crossrefFallback: true };
const fail: PageFetcher = async () => {
  throw new RefreshError("unavailable");
};
async function reason(action: Promise<unknown>, expected: string) {
  try {
    await action;
    assert.fail("Expected error");
  } catch (error) {
    assert.instanceOf(error, RefreshError);
    assert.equal((error as RefreshError).reason, expected);
  }
}

describe("Crossref fallback and refresh options", function () {
  it("tries DOI, URL, then Crossref with reserved budget", async function () {
    const calls: string[] = [];
    const start = Date.now();
    const record = await resolvePublisher(
      base,
      new Cancellation(),
      async (url, budget) => {
        calls.push(url);
        assert.equal(budget.remaining, 9);
        assert.isAtMost(budget.deadline - start, 90_010);
        throw new RefreshError("unavailable");
      },
      enabled,
      async (url, budget) => {
        calls.push(url);
        assert.equal(budget.remaining, 1);
        assert.isAtMost(budget.deadline - start, 120_010);
        return data;
      },
    );
    assert.deepEqual(calls, [
      "https://doi.org/10.1234/article",
      base.fields.url,
      "https://api.crossref.org/works/10.1234%2Farticle",
    ]);
    assert.equal(record.fields.title, "Crossref title");
  });

  it("does not call Crossref after publisher success", async function () {
    let calls = 0;
    const record = await resolvePublisher(
      {
        ...base,
        fields: { ...base.fields, DOI: "10.1371/journal.pone.0000308" },
      },
      new Cancellation(),
      async () => ({
        url: recorded[0].url,
        document: new (Zotero.getMainWindow().DOMParser)().parseFromString(
          recorded[0].html,
          "text/html",
        ),
      }),
      enabled,
      async () => {
        calls++;
        return data;
      },
    );
    assert.include(record.fields.title!, "Sharing Detailed Research Data");
    assert.equal(calls, 0);
  });

  it("honors disabled fallback and skips absent DOI", async function () {
    let calls = 0;
    const json: JSONFetcher = async () => {
      calls++;
      return data;
    };
    await reason(
      resolvePublisher(
        base,
        new Cancellation(),
        fail,
        { ...enabled, crossrefFallback: false },
        json,
      ),
      "unavailable",
    );
    await reason(
      resolvePublisher(
        { ...base, fields: { url: base.fields.url } },
        new Cancellation(),
        fail,
        enabled,
        json,
      ),
      "unavailable",
    );
    assert.equal(calls, 0);
  });

  it("uses an explicit DOI item URL but prefers the DOI field", async function () {
    for (const fields of [
      { url: "https://doi.org/10.1234/article" },
      { DOI: "10.1234/article", url: "https://doi.org/10.9999/other" },
    ]) {
      await resolvePublisher(
        { ...base, fields },
        new Cancellation(),
        fail,
        enabled,
        async (url) => {
          assert.include(url, "10.1234%2Farticle");
          return data;
        },
      );
    }
  });

  it("falls back after publisher budget exhaustion and timeout, but never cancellation", async function () {
    let calls = 0;
    const json: JSONFetcher = async () => {
      calls++;
      return data;
    };
    for (const failure of ["budget", "timeout"] as const)
      await resolvePublisher(
        base,
        new Cancellation(),
        async () => {
          throw new RefreshError(failure);
        },
        enabled,
        json,
      );
    assert.equal(calls, 2);
    const cancellation = new Cancellation();
    await reason(
      resolvePublisher(
        base,
        cancellation,
        async () => {
          cancellation.cancel();
          cancellation.check();
          return fail("", { remaining: 1, deadline: 0 }, cancellation);
        },
        enabled,
        json,
      ),
      "cancelled",
    );
    assert.equal(calls, 2);
    await reason(
      resolvePublisher(base, new Cancellation(), fail, enabled, async () => {
        throw new RefreshError("unavailable");
      }),
      "unavailable",
    );
  });

  it("reserves time even when the publisher request hangs", async function () {
    const saved = { ...LIMITS };
    LIMITS.itemMs = 150;
    LIMITS.requestMs = 100;
    try {
      let fallback = false;
      await resolvePublisher(
        base,
        new Cancellation(),
        async (_url, _budget, cancellation) =>
          new Promise((_resolve, reject) =>
            cancellation.subscribe(() => reject(new RefreshError("cancelled"))),
          ),
        enabled,
        async () => {
          fallback = true;
          return data;
        },
      );
      assert.isTrue(fallback);
    } finally {
      Object.assign(LIMITS, saved);
    }
  });

  it("preserves both empty and populated abstracts for either provider when disabled", function () {
    const crossref = extractCrossrefRecord(data, "10.1234/article");
    for (const record of [crossref, { ...crossref, evidence: ["publisher"] }])
      for (const abstractNote of ["", "Local abstract"]) {
        const snapshot = { ...base, fields: { ...base.fields, abstractNote } };
        assert.notProperty(
          buildPatch(snapshot, record, { ...enabled, updateAbstract: false })
            .fields,
          "abstractNote",
        );
        assert.equal(
          buildPatch(snapshot, record, enabled).fields.abstractNote,
          "New abstract",
        );
      }
  });

  it("persists settings and freezes options for each batch", async function () {
    const previous = readRefreshOptions();
    try {
      setPref("updateAbstract", false);
      setPref("crossrefFallback", false);
      assert.strictEqual(getPref("updateAbstract"), false);
      let count = 0;
      await runBatch([base, base], new Cancellation(), () => {}, {
        resolve: async (_snapshot, _cancel, options) => {
          assert.deepEqual(options, {
            updateAbstract: false,
            crossrefFallback: false,
          });
          setPref("updateAbstract", true);
          setPref("crossrefFallback", true);
          return extractCrossrefRecord(data, "10.1234/article");
        },
        apply: async (_snapshot, _record, _cancel, options) => {
          assert.isFalse(options!.updateAbstract);
          count++;
          return { fields: {}, changedFields: [] };
        },
      });
      assert.equal(count, 2);
      assert.deepEqual(readRefreshOptions(), enabled);
    } finally {
      setPref("updateAbstract", previous.updateAbstract);
      setPref("crossrefFallback", previous.crossrefFallback);
    }
  });

  it("registers one actual settings pane across repeated registration and cleanup", async function () {
    const id = `${config.addonRef}-preferences`;
    Zotero.PreferencePanes.unregister(id);
    await registerRefreshPreferences();
    await registerRefreshPreferences();
    assert.lengthOf(
      Zotero.PreferencePanes.pluginPanes.filter((p) => p.id === id),
      1,
    );
    unregisterRefreshPreferences();
    assert.lengthOf(
      Zotero.PreferencePanes.pluginPanes.filter((p) => p.id === id),
      0,
    );
    await registerRefreshPreferences();
    assert.lengthOf(
      Zotero.PreferencePanes.pluginPanes.filter((p) => p.id === id),
      1,
    );
  });

  it("renders and binds both checkboxes in Zotero Settings", async function () {
    this.timeout(15_000);
    const previous = readRefreshOptions();
    const win = Zotero.Utilities.Internal.openPreferences(
      `${config.addonRef}-preferences`,
    );
    assert.exists(win);
    try {
      let checkbox: XUL.Checkbox | null = null;
      for (let i = 0; i < 100; i++) {
        checkbox = win!.document.getElementById(
          `zotero-prefpane-${config.addonRef}-updateAbstract`,
        ) as XUL.Checkbox | null;
        if (checkbox) break;
        await Zotero.Promise.delay(50);
      }
      assert.exists(checkbox);
      await Zotero.Promise.delay(100);
      for (const key of ["updateAbstract", "crossrefFallback"] as const) {
        const box = win!.document.getElementById(
          `zotero-prefpane-${config.addonRef}-${key}`,
        ) as XUL.Checkbox;
        assert.exists(box);
        assert.equal(
          box.getAttribute("preference"),
          `${config.prefsPrefix}.${key}`,
        );
        box.checked = false;
        box.dispatchEvent(
          new (Zotero.getMainWindow().Event)("command", { bubbles: true }),
        );
        assert.isFalse(getPref(key));
        box.checked = true;
        box.dispatchEvent(
          new (Zotero.getMainWindow().Event)("command", { bubbles: true }),
        );
        assert.isTrue(getPref(key));
      }
    } finally {
      win?.close();
      setPref("updateAbstract", previous.updateAbstract);
      setPref("crossrefFallback", previous.crossrefFallback);
    }
  });

  it("applies Crossref through the transaction while preserving abstract and user data", async function () {
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "Local");
    item.setField("abstractNote", "Keep abstract");
    item.setField("extra", "Keep extra");
    item.addTag("Keep tag");
    await item.saveTx();
    const key = item.key;
    try {
      await applyPublisherRecord(
        snapshotItem(item),
        extractCrossrefRecord(data, "10.1234/article"),
        new Cancellation(),
        { ...enabled, updateAbstract: false },
      );
      assert.equal(item.key, key);
      assert.equal(item.getField("title"), "Crossref title");
      assert.equal(item.getField("abstractNote"), "Keep abstract");
      assert.equal(item.getField("extra"), "Keep extra");
      assert.equal(item.getTags()[0].tag, "Keep tag");
    } finally {
      await item.eraseTx();
    }
  });
});
