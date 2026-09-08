import { RefreshError } from "../src/modules/refreshTypes";
import { assert } from "chai";
import { resolvePublisher } from "../src/modules/publisherResolver";
import { Cancellation } from "../src/modules/publisherTransport";

describe("live publisher smoke (opt in)", function () {
  this.timeout(130_000);

  before(function () {
    if (!Zotero.Prefs.get("extensions.zotero.addontemplate.liveSmoke", true))
      this.skip();
  });

  it("resolves a PLOS journal DOI in Zotero 10", async function () {
    const record = await resolvePublisher(
      {
        id: 0,
        libraryID: 1,
        key: "SMOKETST",
        itemType: "journalArticle",
        fields: { DOI: "10.1371/journal.pone.0000308" },
        creators: [],
      },
      new Cancellation(),
    );
    assert.equal(record.fields.DOI, "10.1371/journal.pone.0000308");
    assert.include(record.fields.title!, "Sharing Detailed Research Data");
  });

  it("extracts a PMLR conference URL without a DOI in Zotero 10", async function () {
    const record = await resolvePublisher(
      {
        id: 0,
        libraryID: 1,
        key: "SMOKETST",
        itemType: "conferencePaper",
        fields: { url: "https://proceedings.mlr.press/v139/radford21a.html" },
        creators: [],
      },
      new Cancellation(),
    );
    assert.include(record.fields.title!, "Learning Transferable Visual Models");
    assert.lengthOf(record.authors!, 12);
  });

  it("retrieves exact DOI metadata from Crossref after publisher failure", async function () {
    const record = await resolvePublisher(
      {
        id: 0,
        libraryID: 1,
        key: "SMOKETST",
        itemType: "journalArticle",
        fields: { DOI: "10.1371/journal.pone.0000308" },
        creators: [],
      },
      new Cancellation(),
      async () => {
        throw new RefreshError("unavailable");
      },
    );
    assert.equal(record.fields.DOI, "10.1371/journal.pone.0000308");
    assert.include(record.evidence, "Crossref exact DOI");
    assert.include(record.fields.title!, "Sharing Detailed Research Data");
  });
});
