import { extractCrossrefRecord } from "../src/modules/crossref";
import { assert } from "chai";
import { config } from "../package.json";
import {
  snapshotItem,
  applyPublisherRecord,
  buildPatch,
} from "../src/modules/metadataWriter";
import { captureSelection, runBatch } from "../src/modules/refreshBatch";
import { resolvePublisher as resolveWithCrossref } from "../src/modules/publisherResolver";
import {
  Cancellation,
  publicURL,
  isPublicAddress,
  type PageFetcher,
} from "../src/modules/publisherTransport";
import {
  RefreshError,
  type ItemSnapshot,
  type PublisherRecord,
} from "../src/modules/refreshTypes";
import recorded from "./fixtures/live/publisher-heads.json";
import { extractPublisherPage } from "../src/modules/publisherExtraction";

const resolvePublisher = (
  snapshot: ItemSnapshot,
  cancellation: Cancellation,
  fetch: PageFetcher,
) =>
  resolveWithCrossref(snapshot, cancellation, fetch, {
    updateAbstract: true,
    crossrefFallback: false,
  });

const documentFor = (html: string) =>
  new (Zotero.getMainWindow().DOMParser)().parseFromString(html, "text/html");
const record: PublisherRecord = {
  fields: {
    title: "Publisher title",
    DOI: "10.1234/article",
    date: "2025",
    volume: "8",
    abstractNote: "Publisher abstract",
  },
  authors: [{ firstName: "New", lastName: "Author" }],
  sourceURL: "https://journals.plos.org/article",
  retrievedAt: "2026-09-07T00:00:00Z",
  evidence: ["test fixture"],
};
const base: ItemSnapshot = {
  id: 1,
  libraryID: 1,
  key: "ABCD1234",
  itemType: "journalArticle",
  fields: {
    title: "Old",
    DOI: "10.1234/article",
    url: "https://journals.plos.org/fallback",
  },
  creators: [],
};

async function expectReason(action: Promise<unknown>, reason: string) {
  try {
    await action;
    assert.fail("Expected failure");
  } catch (error) {
    assert.instanceOf(error, RefreshError);
    assert.equal((error as RefreshError).reason, reason);
  }
}

describe("publisher refresh", function () {
  describe("publisher resolution and request policy", function () {
    it("preserves DOI identity through indirect links and resets only for item-URL fallback", async function () {
      const calls: string[] = [];
      const fetch: PageFetcher = async (url) => {
        calls.push(url);
        if (url.startsWith("https://doi.org/"))
          return {
            url: "https://arxiv.org/abs/1234.5678",
            document: documentFor(
              '<html><body><a href="https://journals.plos.org/article">Published version</a></body></html>',
            ),
          };
        return {
          url: recorded[0].url,
          document: documentFor(recorded[0].html),
        };
      };
      await expectReason(
        resolvePublisher(
          { ...base, fields: { DOI: "10.1234/article" } },
          new Cancellation(),
          fetch,
        ),
        "doi-mismatch",
      );
      assert.lengthOf(calls, 2);
      calls.length = 0;
      const result = await resolvePublisher(base, new Cancellation(), fetch);
      assert.equal(calls[2], base.fields.url);
      assert.equal(result.fields.DOI, "10.1371/journal.pone.0000308");
    });

    it("rejects local, credentialed, non-HTTP and special-use destinations", function () {
      for (const url of [
        "file:///etc/passwd",
        "http://localhost/x",
        "http://127.1/x",
        "http://2130706433/",
        "https://10.1.2.3",
        "http://[::ffff:127.0.0.1]/",
        "https://user:pass@plos.org",
        "http://192.168.1.1",
        "http://example.local",
        "https://plos.org:8080/x",
      ]) {
        assert.throws(() => publicURL(url), RefreshError, "invalid-url", url);
      }
      assert.isFalse(isPublicAddress("169.254.169.254"));
      assert.isFalse(isPublicAddress("2001:db8::1"));
      assert.isFalse(isPublicAddress("fc00::1"));
      assert.isTrue(isPublicAddress("8.8.8.8"));
      assert.equal(
        publicURL("/article", "https://plos.org/start").href,
        "https://plos.org/article",
      );
    });

    it("uses DOI first and falls back to the URL on a broken DOI", async function () {
      const calls: string[] = [];
      const fetchPage: PageFetcher = async (url) => {
        calls.push(url);
        if (url.startsWith("https://doi.org/"))
          throw new RefreshError("unavailable");
        return {
          document: documentFor(recorded[0].html),
          url: recorded[0].url,
        };
      };
      const result = await resolvePublisher(
        base,
        new Cancellation(),
        fetchPage,
      );
      assert.equal(calls[0], "https://doi.org/10.1234/article");
      assert.equal(calls[1], base.fields.url);
      assert.equal(result.fields.DOI, "10.1371/journal.pone.0000308");
    });

    it("trusts a matching DOI despite wrong local title and skips URL lookup", async function () {
      let calls = 0;
      const result = await resolvePublisher(
        {
          ...base,
          fields: { ...base.fields, DOI: "10.1371/journal.pone.0000308" },
        },
        new Cancellation(),
        async () => {
          calls++;
          return {
            document: documentFor(recorded[0].html),
            url: recorded[0].url,
          };
        },
      );
      assert.equal(calls, 1);
      assert.include(result.fields.title!, "Sharing Detailed Research Data");
    });

    it("falls back when DOI page metadata conflicts and reports failure if URL is also broken", async function () {
      let calls = 0;
      await expectReason(
        resolvePublisher(base, new Cancellation(), async () => {
          calls++;
          if (calls === 1)
            return {
              document: documentFor(recorded[0].html),
              url: recorded[0].url,
            };
          throw new RefreshError("unavailable");
        }),
        "unavailable",
      );
      assert.equal(calls, 2);
    });

    it("follows an explicitly labeled repository publication DOI", async function () {
      const calls: string[] = [];
      const result = await resolvePublisher(
        {
          ...base,
          fields: { title: "Old", url: "https://arxiv.org/abs/1234.5678" },
        },
        new Cancellation(),
        async (url) => {
          calls.push(url);
          if (calls.length === 1)
            return {
              url,
              document: documentFor(
                '<html><body><a class="arxiv-doi" href="https://doi.org/10.1371/journal.pone.0000308">Published DOI</a></body></html>',
              ),
            };
          return {
            document: documentFor(recorded[0].html),
            url: recorded[0].url,
          };
        },
      );
      assert.lengthOf(calls, 2);
      assert.equal(calls[1], "https://doi.org/10.1371/journal.pone.0000308");
      assert.equal(result.sourceURL, recorded[0].url);
    });

    it("skips missing identifiers without requests and does not retry a failure", async function () {
      let calls = 0;
      const fail: PageFetcher = async () => {
        calls++;
        throw new RefreshError("timeout");
      };
      await expectReason(
        resolvePublisher(
          { ...base, fields: { title: "Old" } },
          new Cancellation(),
          fail,
        ),
        "missing-link",
      );
      assert.equal(calls, 0);
      await expectReason(
        resolvePublisher(
          { ...base, fields: { DOI: "bad", url: base.fields.url } },
          new Cancellation(),
          fail,
        ),
        "timeout",
      );
      assert.equal(calls, 1);
    });

    it("extracts recorded PLOS and PMLR publisher metadata", function () {
      for (const fixture of recorded) {
        const result = extractPublisherPage(
          { document: documentFor(fixture.html), url: fixture.url },
          { viaDOI: false },
        );
        assert.exists(result.record, result.reason);
        assert.isAbove(result.record!.authors!.length, 2);
        assert.isNotEmpty(result.record!.fields.title);
        assert.equal(result.record!.sourceURL, fixture.url);
        if (fixture.name === "pmlr") {
          assert.equal(result.record!.fields.pages, "8748-8763");
          assert.include(
            result.record!.fields.proceedingsTitle!,
            "Machine Learning",
          );
        }
      }
    });
  });

  describe("transactional metadata preservation", function () {
    let item: Zotero.Item;
    let cleanup: number[];
    let cleanupFiles: string[];

    beforeEach(async function () {
      cleanup = [];
      cleanupFiles = [];
      item = new Zotero.Item("journalArticle");
      item.setField("title", "Local title");
      item.setField("DOI", "10.1234/article");
      item.setField("url", "https://journals.plos.org/article");
      item.setField("issue", "Keep this issue");
      item.setField("extra", "User Extra\nCitation Key: keep-me");
      item.setField("abstractNote", "Old abstract");
      item.setCreators([
        { creatorType: "author", firstName: "Old", lastName: "Author" },
        { creatorType: "contributor", name: "Keep Organization" },
      ]);
      item.addTag("user tag");
      await item.saveTx();
      cleanup.push(item.id);
    });

    afterEach(async function () {
      for (const file of cleanupFiles) await Zotero.File.removeIfExists(file);
      for (const id of cleanup.reverse()) {
        const current = await Zotero.Items.getAsync(id);
        if (current) await current.eraseTx();
      }
    });

    it("preserves attachments and user data for publisher and Crossref updates", async function () {
      for (const provider of ["publisher", "crossref"]) {
        item.setField("title", "Local title");
        item.setField("abstractNote", "Old abstract");
        await item.saveTx();
        const updateRecord =
          provider === "publisher"
            ? record
            : extractCrossrefRecord(
                {
                  status: "ok",
                  "message-type": "work",
                  message: {
                    DOI: "10.1234/article",
                    type: "journal-article",
                    title: ["Publisher title"],
                    abstract: "Publisher abstract",
                    author: [{ given: "New", family: "Author" }],
                  },
                },
                "10.1234/article",
              );
        try {
          const collection = new Zotero.Collection({
            libraryID: Zotero.Libraries.userLibraryID,
          });
          collection.name = "Keep collection";
          await collection.saveTx();
          const related = new Zotero.Item("journalArticle");
          related.setField("title", "Related");
          await related.saveTx();
          cleanup.push(related.id);
          item.addToCollection(collection.id);
          item.addRelatedItem(related);
          await item.saveTx();
          const note = new Zotero.Item("note");
          note.libraryID = item.libraryID;
          note.parentID = item.id;
          note.setNote("<p>Keep note</p>");
          await note.saveTx();
          cleanup.push(note.id);
          const attachment = new Zotero.Item("attachment");
          attachment.libraryID = item.libraryID;
          attachment.parentID = item.id;
          const pdfPath = `${Zotero.DataDirectory.dir}/refresh-preservation-${item.key}.pdf`;
          const pdfBytes =
            "%PDF-1.1\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n";
          await Zotero.File.putContentsAsync(pdfPath, pdfBytes);
          cleanupFiles.push(pdfPath);
          attachment.attachmentLinkMode =
            Zotero.Attachments.LINK_MODE_LINKED_FILE;
          attachment.attachmentPath = pdfPath;
          attachment.attachmentContentType = "application/pdf";
          attachment.setField("url", "https://journals.plos.org/keep.pdf");
          await attachment.saveTx();
          cleanup.push(attachment.id);
          const annotation = new Zotero.Item("annotation");
          annotation.libraryID = item.libraryID;
          annotation.parentID = attachment.id;
          annotation.annotationType = "highlight";
          annotation.annotationText = "Keep highlight";
          annotation.annotationComment = "Keep comment";
          annotation.annotationColor = "#ffd400";
          annotation.annotationPageLabel = "1";
          (
            annotation as unknown as { annotationSortIndex: string }
          ).annotationSortIndex = "00000|000000|00000";
          annotation.annotationPosition = JSON.stringify({
            pageIndex: 0,
            rects: [[0, 0, 10, 10]],
          });
          await annotation.saveTx();
          cleanup.push(annotation.id);
          const preserved = {
            key: item.key,
            type: item.itemTypeID,
            created: item.dateAdded,
            extra: item.getField("extra"),
            tags: item.getTags(),
            collections: item.getCollections(),
            relations: item.getRelations(),
            attachment: attachment.toJSON(),
            note: note.toJSON(),
            annotation: annotation.toJSON(),
          };
          try {
            const patch = await applyPublisherRecord(
              snapshotItem(item),
              updateRecord,
              new Cancellation(),
            );
            assert.include(patch.changedFields, "title");
            await item.reload(["primaryData", "itemData", "creators"], true);
            assert.equal(item.getField("title"), "Publisher title");
            assert.equal(item.getField("abstractNote"), "Publisher abstract");
            assert.equal(item.getField("issue"), "Keep this issue");
            assert.equal(item.key, preserved.key);
            assert.equal(item.itemTypeID, preserved.type);
            assert.equal(item.dateAdded, preserved.created);
            assert.equal(item.getField("extra"), preserved.extra);
            assert.deepEqual(item.getTags(), preserved.tags);
            assert.deepEqual(item.getCollections(), preserved.collections);
            assert.deepEqual(item.getRelations(), preserved.relations);
            assert.deepEqual(item.getCreatorsJSON()[1], {
              creatorType: "contributor",
              name: "Keep Organization",
            });
            assert.deepEqual(attachment.toJSON(), preserved.attachment);
            assert.equal(await Zotero.File.getContentsAsync(pdfPath), pdfBytes);
            assert.deepEqual(note.toJSON(), preserved.note);
            assert.deepEqual(annotation.toJSON(), preserved.annotation);
            const unchanged = await applyPublisherRecord(
              snapshotItem(item),
              updateRecord,
              new Cancellation(),
            );
            assert.isEmpty(unchanged.changedFields);
          } finally {
            await collection.eraseTx();
          }
        } catch (error) {
          assert.fail(`Preservation integration error: ${String(error)}`);
        }
      }
    });

    it("does not apply a stale snapshot or erase later manual edits", async function () {
      const before = snapshotItem(item);
      item.setField("title", "User changed title");
      await item.saveTx();
      await expectReason(
        applyPublisherRecord(before, record, new Cancellation()),
        "concurrent-edit",
      );
      assert.equal(item.getField("title"), "User changed title");
      const another = snapshotItem(item);
      item.setField("abstractNote", "Unsaved user edit");
      await expectReason(
        applyPublisherRecord(another, record, new Cancellation()),
        "concurrent-edit",
      );
      assert.equal(item.getField("abstractNote"), "Unsaved user edit");
    });

    it("preserves unsaved user-managed fields before reloading metadata", async function () {
      const before = snapshotItem(item);
      item.setField("extra", "An unsaved user edit");
      await expectReason(
        applyPublisherRecord(before, record, new Cancellation()),
        "concurrent-edit",
      );
      assert.equal(item.getField("extra"), "An unsaved user edit");
      assert.equal(item.getField("title"), "Local title");
    });

    it("rolls back and reloads after a save failure", async function () {
      const before = snapshotItem(item);
      const save = item.save;
      item.save = async () => {
        throw new Error("Injected save failure");
      };
      try {
        await expectReason(
          applyPublisherRecord(before, record, new Cancellation()),
          "write-failed",
        );
      } finally {
        item.save = save;
      }
      assert.deepEqual(snapshotItem(item), before);
    });

    it("rolls back a completed save if cancellation arrives before transaction commit", async function () {
      const before = snapshotItem(item);
      const cancellation = new Cancellation();
      const save = item.save;
      item.save = async function (...args) {
        const result = await save.apply(this, args);
        cancellation.cancel();
        return result;
      };
      try {
        await expectReason(
          applyPublisherRecord(before, record, cancellation),
          "cancelled",
        );
      } finally {
        item.save = save;
      }
      assert.deepEqual(snapshotItem(item), before);
    });

    it("preserves missing fields and excludes fields invalid for the existing type", function () {
      const patch = buildPatch(snapshotItem(item), {
        ...record,
        fields: { title: "", proceedingsTitle: "Conference", abstractNote: "" },
        authors: [],
      });
      assert.isEmpty(patch.changedFields);
    });

    it("runs mixed selections sequentially and cancellation retains completed writes", async function () {
      const note = new Zotero.Item("note");
      note.setNote("note");
      await note.saveTx();
      cleanup.push(note.id);
      const first = snapshotItem(item);
      const cancellation = new Cancellation();
      let resolved = 0;
      const results = await runBatch(
        [...captureSelection([note, note]), first, { ...first, id: 999 }],
        cancellation,
        (result) => {
          if (result.outcome === "updated") cancellation.cancel();
        },
        {
          resolve: async () => {
            resolved++;
            return record;
          },
          apply: applyPublisherRecord,
        },
      );
      assert.deepEqual(
        results.map((r) => r.outcome),
        ["skipped", "updated", "cancelled"],
      );
      assert.equal(resolved, 1);
      assert.equal(item.getField("title"), "Publisher title");
    });

    it("does not send requests on startup, imports or menu re-registration", async function () {
      const instance = (Zotero as unknown as Record<string, typeof addon>)[
        config.addonInstance
      ];
      const win = Zotero.getMainWindow();
      const request = Zotero.HTTP.request;
      let requests = 0;
      Zotero.HTTP.request = async () => {
        requests++;
        throw new Error("Unexpected request");
      };
      try {
        await instance.hooks.onMainWindowUnload(win);
        await instance.hooks.onMainWindowLoad(win);
        await instance.hooks.onMainWindowLoad(win);
        const imported = new Zotero.Item("journalArticle");
        imported.setField("DOI", "10.1234/imported");
        await imported.saveTx();
        cleanup.push(imported.id);
        await Zotero.Promise.delay(100);
        assert.equal(requests, 0);
        assert.lengthOf(
          win.document.querySelectorAll("#publisher-metadata-refresh-command"),
          1,
        );
      } finally {
        Zotero.HTTP.request = request;
      }
    });
  });
});
