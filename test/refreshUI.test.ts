import { assert } from "chai";
import { config } from "../package.json";
import {
  registerRefreshWindow,
  unregisterRefreshWindow,
  startRefresh,
  shutdownRefresh,
} from "../src/modules/refreshUI";
import {
  RefreshError,
  type PublisherRecord,
} from "../src/modules/refreshTypes";
import type { BatchDependencies } from "../src/modules/refreshBatch";
import { scheduleTimeout } from "../src/utils/timer";

describe("manual refresh window lifecycle", function () {
  this.timeout(20_000);
  let first: _ZoteroTypes.MainWindow;
  let second: _ZoteroTypes.MainWindow;
  let item: Zotero.Item;
  let instance: typeof addon;
  let previousAddon: PropertyDescriptor | undefined;
  let firstSelection: typeof first.ZoteroPane.getSelectedItems;
  let secondSelection: typeof second.ZoteroPane.getSelectedItems;

  before(async function () {
    instance = (Zotero as unknown as Record<string, typeof addon>)[
      config.addonInstance
    ];
    previousAddon = Object.getOwnPropertyDescriptor(globalThis, "addon");
    Object.defineProperty(globalThis, "addon", {
      value: instance,
      configurable: true,
    });
    first = Zotero.getMainWindow();
    const before = new Set(Zotero.getMainWindows());
    Zotero.openMainWindow();
    for (let i = 0; i < 100; i++) {
      second = Zotero.getMainWindows().find((win) => !before.has(win))!;
      if (
        second?.document.getElementById("zotero-itemmenu") &&
        second.ZoteroPane?.initialized
      )
        break;
      await Zotero.Promise.delay(100);
    }
    assert.exists(second);
    await Zotero.Promise.delay(300);
    await instance.hooks.onMainWindowUnload(first);
    await instance.hooks.onMainWindowUnload(second);
    item = new Zotero.Item("journalArticle");
    item.setField("title", "UI test article");
    await item.saveTx();
    firstSelection = first.ZoteroPane.getSelectedItems;
    secondSelection = second.ZoteroPane.getSelectedItems;
    first.ZoteroPane.getSelectedItems = (() => [item]) as typeof firstSelection;
    second.ZoteroPane.getSelectedItems = (() => [
      item,
    ]) as typeof secondSelection;
  });

  after(async function () {
    shutdownRefresh();
    if (firstSelection) first.ZoteroPane.getSelectedItems = firstSelection;
    if (secondSelection) second.ZoteroPane.getSelectedItems = secondSelection;
    if (second) second.close();
    if (item) await item.eraseTx();
    await instance.hooks.onMainWindowLoad(first);
    if (previousAddon)
      Object.defineProperty(globalThis, "addon", previousAddon);
    else Reflect.deleteProperty(globalThis, "addon");
  });

  afterEach(function () {
    shutdownRefresh();
  });

  it("registers once per window and removes all UI on unload", function () {
    registerRefreshWindow(first);
    registerRefreshWindow(first);
    registerRefreshWindow(second);
    for (const win of [first, second]) {
      const submenu = win.document.querySelector(
        "#zotero-itemmenu > #metadata-updater-menu",
      );
      assert.exists(submenu);
      assert.equal(submenu!.localName, "menu");
      assert.equal(submenu!.getAttribute("label"), "metadata-updater");
      assert.exists(
        submenu!.querySelector(
          ":scope > menupopup > #publisher-metadata-refresh-command",
        ),
      );
      assert.lengthOf(
        win.document.querySelectorAll("#metadata-updater-menu"),
        1,
      );
    }
    assert.lengthOf(
      first.document.querySelectorAll("#publisher-metadata-refresh-command"),
      1,
    );
    assert.lengthOf(
      second.document.querySelectorAll("#publisher-metadata-refresh-command"),
      1,
    );
    unregisterRefreshWindow(first);
    assert.isNull(first.document.getElementById("metadata-updater-menu"));
    assert.isNull(
      first.document.getElementById("publisher-metadata-refresh-command"),
    );
    assert.exists(
      second.document.getElementById("publisher-metadata-refresh-command"),
    );
    registerRefreshWindow(first);
    assert.lengthOf(
      first.document.querySelectorAll("#publisher-metadata-refresh-command"),
      1,
    );
  });

  it("allows only one active batch across windows and Cancel stops its write", async function () {
    registerRefreshWindow(first);
    registerRefreshWindow(second);
    let resolves = 0;
    let writes = 0;
    const dependencies: BatchDependencies = {
      resolve: (_snapshot, cancellation) =>
        new Promise<PublisherRecord>((_resolve, reject) => {
          resolves++;
          cancellation.subscribe(() => reject(new RefreshError("cancelled")));
        }),
      apply: async () => {
        writes++;
        return { fields: {}, changedFields: [] };
      },
    };
    const running = startRefresh(first, dependencies);
    await startRefresh(first, dependencies);
    await startRefresh(second, dependencies);
    assert.equal(resolves, 1);
    assert.isNull(second.document.getElementById("publisher-refresh-panel"));
    await Zotero.Promise.delay(100);
    const bounds = first.document
      .getElementById("publisher-refresh-panel")!
      .getBoundingClientRect();
    assert.isAbove(bounds.width, 300);
    assert.isAbove(bounds.height, 150);
    assert.isAtMost(bounds.right, first.innerWidth);
    assert.isAtMost(bounds.bottom, first.innerHeight);
    (
      first.document.querySelector(
        "#publisher-refresh-panel button",
      ) as HTMLButtonElement
    ).click();
    await running;
    assert.equal(writes, 0);
    assert.include(
      first.document.getElementById("publisher-refresh-panel")!.textContent!,
      "Cancelled",
    );
  });

  it("shutdown cancels outstanding work and re-enable permits another batch", async function () {
    registerRefreshWindow(first);
    let writes = 0;
    const running = startRefresh(first, {
      resolve: (_snapshot, cancellation) =>
        new Promise<PublisherRecord>((_resolve, reject) =>
          cancellation.subscribe(() => reject(new RefreshError("cancelled"))),
        ),
      apply: async () => {
        writes++;
        return { fields: {}, changedFields: [] };
      },
    });
    shutdownRefresh();
    await running;
    assert.equal(writes, 0);
    assert.isNull(first.document.getElementById("publisher-refresh-panel"));
    registerRefreshWindow(first);
    await startRefresh(first, {
      resolve: async () => ({
        fields: { title: "UI test article" },
        sourceURL: "https://plos.org/article",
        retrievedAt: new Date().toISOString(),
        evidence: [],
      }),
      apply: async () => ({ fields: {}, changedFields: [] }),
    });
    assert.include(
      first.document.getElementById("publisher-refresh-panel")!.textContent!,
      "Unchanged",
    );
  });

  it("keeps request deadlines alive when an unrelated window closes", async function () {
    let fired = false;
    const clear = scheduleTimeout(() => {
      fired = true;
    }, 20);
    second.close();
    await new Promise<void>((resolve) => first.setTimeout(resolve, 100));
    clear();
    assert.isTrue(fired);
  });
});
