/** Zotero 10 removed Zotero.setTimeout despite the bundled legacy type entry. */
export function scheduleTimeout(
  callback: () => void,
  milliseconds: number,
): () => void {
  const win = Zotero.getMainWindow();
  const timer = win.setTimeout(callback, milliseconds);
  return () => win.clearTimeout(timer);
}
