import { crossrefURL, extractCrossrefRecord } from "./crossref";
import { extractPublisherPage, normalizeDOI } from "./publisherExtraction";
import {
  Cancellation,
  LIMITS,
  createBudget,
  fetchPublisherPage,
  publicURL,
  type PageFetcher,
  type JSONFetcher,
  type RequestBudget,
  fetchJSON,
} from "./publisherTransport";
import {
  RefreshError,
  DEFAULT_REFRESH_OPTIONS,
  type RefreshOptions,
  type PublisherRecord,
  type ItemSnapshot,
  type Reason,
} from "./refreshTypes";
import { scheduleTimeout } from "../utils/timer";

export async function resolvePublisher(
  snapshot: ItemSnapshot,
  cancellation: Cancellation,
  fetchPage: PageFetcher = fetchPublisherPage,
  options: Readonly<RefreshOptions> = DEFAULT_REFRESH_OPTIONS,
  fetchCrossref: JSONFetcher = fetchJSON,
): Promise<PublisherRecord> {
  cancellation.check();
  const itemCancellation = new Cancellation();
  const remove = cancellation.subscribe(() => itemCancellation.cancel());
  const clearTimer = scheduleTimeout(
    () => itemCancellation.cancel(),
    LIMITS.itemMs,
  );
  try {
    const budget = createBudget();
    const doi =
      normalizeDOI(snapshot.fields.DOI || "") ||
      doiFromItemURL(snapshot.fields.url);
    if (!options.crossrefFallback || !doi)
      return await resolveWithBudget(
        snapshot,
        itemCancellation,
        fetchPage,
        budget,
      );
    const publisherCancellation = new Cancellation();
    const unlink = itemCancellation.subscribe(() =>
      publisherCancellation.cancel(),
    );
    const publisherBudget = {
      remaining: LIMITS.requests - 1,
      deadline: budget.deadline - LIMITS.requestMs,
    };
    const stopPublisher = scheduleTimeout(
      () => publisherCancellation.cancel(),
      Math.max(0, publisherBudget.deadline - Date.now()),
    );
    try {
      return await resolveWithBudget(
        snapshot,
        publisherCancellation,
        fetchPage,
        publisherBudget,
      );
    } catch {
      itemCancellation.check();
    } finally {
      stopPublisher();
      unlink();
    }
    const data = await fetchCrossref(
      crossrefURL(doi),
      { remaining: 1, deadline: budget.deadline },
      itemCancellation,
    );
    itemCancellation.check();
    const record = extractCrossrefRecord(data, doi);
    if (Date.now() >= budget.deadline) throw new RefreshError("timeout");
    return record;
  } catch (error) {
    cancellation.check();
    if (itemCancellation.cancelled) throw new RefreshError("timeout");
    throw error;
  } finally {
    clearTimer();
    remove();
  }
}

async function resolveWithBudget(
  snapshot: ItemSnapshot,
  cancellation: Cancellation,
  fetchPage: PageFetcher,
  budget: RequestBudget,
): Promise<PublisherRecord> {
  const doi = normalizeDOI(snapshot.fields.DOI || "");
  const starts: { url: string; expectedDOI?: string; viaDOI: boolean }[] = [];
  if (doi)
    starts.push({
      url: `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`,
      expectedDOI: doi,
      viaDOI: true,
    });
  if (snapshot.fields.url)
    starts.push({ url: snapshot.fields.url, viaDOI: false });
  if (!starts.length) throw new RefreshError("missing-link");
  let reason: Reason = "unavailable";
  for (const start of starts) {
    const queue = [start];
    const visited = new Set<string>();
    while (queue.length) {
      cancellation.check();
      const next = queue.shift()!;
      try {
        const url = publicURL(next.url);
        if (visited.has(url.href)) continue;
        visited.add(url.href);
        // A fallback URL can itself be a DOI link.
        const linkedDOI = /^(?:dx\.)?doi\.org$/.test(url.hostname)
          ? normalizeDOI(decodeURIComponent(url.pathname.slice(1)))
          : undefined;
        if (linkedDOI && next.expectedDOI && linkedDOI !== next.expectedDOI) {
          throw new RefreshError("doi-mismatch");
        }
        const context =
          linkedDOI && !next.expectedDOI
            ? { expectedDOI: linkedDOI, viaDOI: true }
            : next;
        const page = await fetchPage(url.href, budget, cancellation);
        cancellation.check();
        const result = extractPublisherPage(page, context);
        if (Date.now() >= budget.deadline) throw new RefreshError("timeout");
        if (result.record) return result.record;
        reason = result.reason || "unsupported-page";
        // Ambiguous publication links must not choose a publication by ordering.
        const links = [...new Set(result.publicationLinks)];
        if (links.length > 1) {
          reason = "ambiguous";
          continue;
        }
        if (links.length)
          queue.push({
            url: publicURL(links[0], page.url).href,
            expectedDOI: context.expectedDOI,
            viaDOI: context.viaDOI,
          });
      } catch (error) {
        cancellation.check();
        reason = error instanceof RefreshError ? error.reason : "unavailable";
        if (reason === "budget" || Date.now() >= budget.deadline)
          throw new RefreshError(reason);
      }
    }
  }
  throw new RefreshError(reason);
}

function doiFromItemURL(value?: string): string | undefined {
  if (!value) return;
  try {
    const url = publicURL(value);
    if (!/^(?:dx\.)?doi\.org$/.test(url.hostname)) return;
    return normalizeDOI(decodeURIComponent(url.pathname.slice(1)));
  } catch {
    return;
  }
}
