import { applyPublisherRecord, snapshotItem } from "./metadataWriter";
import { resolvePublisher } from "./publisherResolver";
import { Cancellation } from "./publisherTransport";
import {
  RefreshError,
  type ItemResult,
  type ItemSnapshot,
  type PublisherRecord,
} from "./refreshTypes";

export interface BatchDependencies {
  resolve: (
    snapshot: ItemSnapshot,
    cancellation: Cancellation,
  ) => Promise<PublisherRecord>;
  apply: typeof applyPublisherRecord;
}
const defaultDependencies: BatchDependencies = {
  resolve: resolvePublisher,
  apply: applyPublisherRecord,
};

/** IDs and initial snapshots are captured when the user invokes the command. */
export function captureSelection(
  items: Zotero.Item[],
): (ItemSnapshot | ItemResult)[] {
  return [...new Map(items.map((item) => [item.id, item])).values()].map(
    (item) => {
      try {
        return snapshotItem(item);
      } catch (error) {
        return {
          id: item.id,
          title: String(item.getField("title") || ""),
          outcome: "skipped" as const,
          reason:
            error instanceof RefreshError
              ? error.reason
              : ("unsupported" as const),
          changedFields: [],
        };
      }
    },
  );
}

export async function runBatch(
  selection: (ItemSnapshot | ItemResult)[],
  cancellation: Cancellation,
  report: (result: ItemResult, completed: number) => void,
  dependencies: BatchDependencies = defaultDependencies,
): Promise<ItemResult[]> {
  const results: ItemResult[] = [];
  for (const entry of selection) {
    let result: ItemResult;
    if ("outcome" in entry) result = entry;
    else {
      result = {
        id: entry.id,
        title: entry.fields.title || "",
        outcome: "cancelled",
        changedFields: [],
      };
      try {
        cancellation.check();
        const record = await dependencies.resolve(entry, cancellation);
        cancellation.check();
        result.sourceURL = record.sourceURL;
        result.retrievedAt = record.retrievedAt;
        const patch = await dependencies.apply(entry, record, cancellation);
        result.changedFields = patch.changedFields;
        result.outcome = patch.changedFields.length ? "updated" : "unchanged";
      } catch (error) {
        result.reason =
          error instanceof RefreshError ? error.reason : "unavailable";
        result.outcome =
          result.reason === "cancelled"
            ? "cancelled"
            : [
                  "write-failed",
                  "unavailable",
                  "timeout",
                  "too-large",
                  "budget",
                ].includes(result.reason)
              ? "failed"
              : "skipped";
      }
    }
    results.push(result);
    report(result, results.length);
  }
  return results;
}
