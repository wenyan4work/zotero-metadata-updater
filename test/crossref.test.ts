// Recorded from the Crossref works endpoint on 2026-09-07.
import liveRecord from "./fixtures/crossref-recorded.json";
import { assert } from "chai";
import fixture from "./fixtures/crossref.json";
import { crossrefURL, extractCrossrefRecord } from "../src/modules/crossref";
import { RefreshError } from "../src/modules/refreshTypes";

type CrossrefData = Record<string, unknown>;

function copyFixture(): CrossrefData {
  return JSON.parse(JSON.stringify(fixture)) as CrossrefData;
}

function messageOf(data: CrossrefData): CrossrefData {
  return data.message as CrossrefData;
}

function expectReason(data: unknown, doi: string, reason: string) {
  assert.throws(() => extractCrossrefRecord(data, doi), RefreshError, reason);
}

describe("Crossref metadata extraction", function () {
  it("maps a recorded Crossref response without network access", function () {
    const record = extractCrossrefRecord(
      liveRecord,
      "10.1371/journal.pone.0000308",
    );
    assert.equal(
      record.fields.title,
      "Sharing Detailed Research Data Is Associated with Increased Citation Rate",
    );
    assert.equal(record.fields.date, "2007-03-21");
    assert.equal(record.fields.volume, "2");
    assert.equal(record.fields.issue, "3");
    assert.equal(record.fields.pages, "e308");
    assert.lengthOf(record.authors!, 3);
  });

  it("maps a validated journal work and preserves exact DOI provenance", function () {
    const record = extractCrossrefRecord(fixture, "10.5555/EXAMPLE(1)");
    assert.deepEqual(record.fields, {
      title: "A Crossref journal record",
      publicationTitle: "Journal of Recorded Metadata",
      date: "2022-02-28",
      volume: "12",
      issue: "3",
      pages: "123-130",
      publisher: "Example Press",
      DOI: "10.5555/example(1)",
      ISSN: "2049-3630",
      ISBN: "9780306406157",
      url: "https://doi.org/10.5555/example(1)",
      abstractNote: "Background and findings.",
    });
    assert.deepEqual(record.authors, [
      { firstName: "Ada", lastName: "Lovelace" },
      { lastName: "Example Research Group", fieldMode: 1 },
    ]);
    assert.equal(
      record.sourceURL,
      "https://api.crossref.org/works/10.5555%2Fexample(1)",
    );
    assert.deepEqual(record.evidence, ["Crossref exact DOI"]);
    assert.match(record.retrievedAt, /^\d{4}-\d\d-\d\dT/);
  });

  it("encodes the normalized DOI as one Crossref works path component", function () {
    assert.equal(
      crossrefURL(" DOI: https://doi.org/10.5555/EXAMPLE(1) "),
      "https://api.crossref.org/works/10.5555%2Fexample(1)",
    );
    assert.equal(
      crossrefURL("10.5555/part<290::aid>3.0;2-p"),
      "https://api.crossref.org/works/10.5555%2Fpart%3C290%3A%3Aaid%3E3.0%3B2-p",
    );
  });

  it("prefers print dates, then online and published dates", function () {
    const print = copyFixture();
    const printMessage = messageOf(print);
    printMessage["published-print"] = { "date-parts": [[2020, 2, 30]] };
    printMessage["published-online"] = { "date-parts": [[2021, 4]] };
    printMessage.published = { "date-parts": [[2019, 1, 2]] };
    assert.equal(
      extractCrossrefRecord(print, "10.5555/example(1)").fields.date,
      "2021-04",
    );

    delete printMessage["published-online"];
    assert.equal(
      extractCrossrefRecord(print, "10.5555/example(1)").fields.date,
      "2019-01-02",
    );
  });

  it("uses article number only when the page range is unavailable", function () {
    const data = copyFixture();
    const message = messageOf(data);
    delete message.page;
    message["article-number"] = "<jats:elocation-id>e17</jats:elocation-id>";
    assert.equal(
      extractCrossrefRecord(data, "10.5555/example(1)").fields.pages,
      "e17",
    );
  });

  it("omits invalid optional values and an invalid author list", function () {
    const data = copyFixture();
    const message = messageOf(data);
    message.volume = [];
    message.issue = { value: "3" };
    message.publisher = "<script>discarded</script>";
    message.ISSN = ["invalid", "2049 363"];
    message.ISBN = ["not-an-isbn"];
    message.author = [
      { given: "Ada", family: "Lovelace" },
      { given: "Missing family" },
    ];
    const fields = extractCrossrefRecord(data, "10.5555/example(1)").fields;
    assert.notProperty(fields, "volume");
    assert.notProperty(fields, "issue");
    assert.notProperty(fields, "publisher");
    assert.notProperty(fields, "ISSN");
    assert.notProperty(fields, "ISBN");
    assert.isUndefined(
      extractCrossrefRecord(data, "10.5555/example(1)").authors,
    );
  });

  it("rejects malformed, mismatched, incomplete, and unsupported works", function () {
    expectReason(null, "10.5555/example(1)", "unsupported-page");

    const malformed = copyFixture();
    malformed.status = "failed";
    expectReason(malformed, "10.5555/example(1)", "unsupported-page");

    const wrongType = copyFixture();
    messageOf(wrongType).type = "dataset";
    expectReason(wrongType, "10.5555/example(1)", "unsupported-page");

    const posted = copyFixture();
    messageOf(posted).type = "posted-content";
    delete messageOf(posted).subtype;
    expectReason(posted, "10.5555/example(1)", "unsupported-page");

    const missingTitle = copyFixture();
    messageOf(missingTitle).title = [];
    expectReason(missingTitle, "10.5555/example(1)", "incomplete");

    const mismatch = copyFixture();
    messageOf(mismatch).DOI = "10.5555/other";
    expectReason(mismatch, "10.5555/example(1)", "doi-mismatch");
  });

  it("accepts only a preprint subtype for posted content", function () {
    const data = copyFixture();
    const message = messageOf(data);
    message.type = "posted-content";
    message.subtype = "preprint";
    message["container-title"] = ["Example Preprints"];
    const record = extractCrossrefRecord(data, "10.5555/example(1)");
    assert.equal(record.fields.publicationTitle, "Example Preprints");
    assert.notProperty(record.fields, "proceedingsTitle");
  });
});
