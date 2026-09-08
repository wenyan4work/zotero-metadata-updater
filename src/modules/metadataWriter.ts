import { Cancellation } from "./publisherTransport";
import {
  REFRESH_FIELDS,
  DEFAULT_REFRESH_OPTIONS,
  type RefreshOptions,
  RefreshError,
  type ItemSnapshot,
  type PublisherRecord,
  type FieldPatch,
  type Creator,
} from "./refreshTypes";

export const SUPPORTED_TYPES = new Set([
  "journalArticle",
  "conferencePaper",
  "preprint",
]);

export function snapshotItem(item: Zotero.Item): ItemSnapshot {
  const itemType = Zotero.ItemTypes.getName(item.itemTypeID);
  if (!SUPPORTED_TYPES.has(itemType) || item.deleted)
    throw new RefreshError("unsupported");
  if (!item.isEditable()) throw new RefreshError("not-editable");
  const fields: ItemSnapshot["fields"] = {};
  for (const field of REFRESH_FIELDS) {
    if (
      Zotero.ItemFields.isValidForType(
        Zotero.ItemFields.getID(field),
        item.itemTypeID,
      )
    )
      fields[field] = String(item.getField(field) || "");
  }
  return {
    id: item.id,
    key: item.key,
    libraryID: item.libraryID,
    itemType,
    fields,
    creators: item.getCreatorsJSON().map((creator) => ({
      creatorType: creator.creatorType,
      lastName: creator.lastName || creator.name || "",
      ...(creator.name
        ? { fieldMode: 1 }
        : { firstName: creator.firstName || "" }),
    })) as Creator[],
  };
}

export function buildPatch(
  snapshot: ItemSnapshot,
  record: PublisherRecord,
  options: Readonly<RefreshOptions> = DEFAULT_REFRESH_OPTIONS,
): FieldPatch {
  const fields: FieldPatch["fields"] = {};
  // Only fields valid on the existing type are present in the snapshot.
  for (const field of REFRESH_FIELDS) {
    if (field === "abstractNote" && !options.updateAbstract) continue;
    const value = record.fields[field];
    if (
      typeof value === "string" &&
      value.trim() &&
      Object.hasOwn(snapshot.fields, field) &&
      value !== snapshot.fields[field]
    )
      fields[field] = value;
  }
  const patch: FieldPatch = { fields, changedFields: Object.keys(fields) };
  if (
    record.authors?.length &&
    record.authors.every(
      (author) => typeof author.lastName === "string" && author.lastName.trim(),
    )
  ) {
    const authors: Creator[] = record.authors.map((author) => ({
      creatorType: "author",
      lastName: author.lastName,
      ...(author.fieldMode === 1
        ? { fieldMode: 1 }
        : { firstName: author.firstName || "" }),
    }));
    // Retain non-author creators and their relative order; put the complete
    // publisher author list at the first previous author position.
    const creators: Creator[] = [];
    let inserted = false;
    for (const creator of snapshot.creators) {
      if (creator.creatorType !== "author") creators.push(creator);
      else if (!inserted) {
        creators.push(...authors);
        inserted = true;
      }
    }
    if (!inserted) creators.push(...authors);
    if (JSON.stringify(creators) !== JSON.stringify(snapshot.creators)) {
      patch.creators = creators;
      patch.changedFields.push("creators");
    }
  }
  return patch;
}

export function sameSnapshot(
  before: ItemSnapshot,
  current: ItemSnapshot,
): boolean {
  return JSON.stringify(before) === JSON.stringify(current);
}

export async function applyPublisherRecord(
  snapshot: ItemSnapshot,
  record: PublisherRecord,
  cancellation: Cancellation,
  options: Readonly<RefreshOptions> = DEFAULT_REFRESH_OPTIONS,
): Promise<FieldPatch> {
  const patch = buildPatch(snapshot, record, options);
  let item: Zotero.Item | undefined;
  let mutated = false;
  try {
    await Zotero.DB.executeTransaction(async () => {
      cancellation.check();
      item = await Zotero.Items.getAsync(snapshot.id);
      if (!item) throw new RefreshError("concurrent-edit");
      // Catch unsaved UI edits before reload, then compare persisted data too.
      if (item.hasChanged() || !sameSnapshot(snapshot, snapshotItem(item)))
        throw new RefreshError("concurrent-edit");
      await item.reload(["primaryData", "itemData", "creators"], true);
      cancellation.check();
      if (!sameSnapshot(snapshot, snapshotItem(item)))
        throw new RefreshError("concurrent-edit");
      if (!patch.changedFields.length) return;
      for (const [field, value] of Object.entries(patch.fields)) {
        mutated = true;
        item.setField(field, value);
      }
      if (patch.creators) {
        mutated = true;
        item.setCreators(
          patch.creators.map((creator) =>
            creator.fieldMode === 1
              ? {
                  creatorType:
                    creator.creatorType as _ZoteroTypes.Item.CreatorJSON["creatorType"],
                  name: creator.lastName,
                }
              : {
                  creatorType:
                    creator.creatorType as _ZoteroTypes.Item.CreatorJSON["creatorType"],
                  firstName: creator.firstName || "",
                  lastName: creator.lastName,
                },
          ),
        );
      }
      await item.save();
      cancellation.check();
    });
    return patch;
  } catch (error) {
    if (mutated && item)
      await item.reload(["primaryData", "itemData", "creators"], true);
    if (error instanceof RefreshError) throw error;
    throw new RefreshError("write-failed");
  }
}
