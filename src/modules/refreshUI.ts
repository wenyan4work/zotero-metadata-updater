import { getString } from "../utils/locale";
import type { FluentMessageId } from "../../typings/i10n";
import {
  captureSelection,
  runBatch,
  type BatchDependencies,
} from "./refreshBatch";
import { Cancellation } from "./publisherTransport";
import { SUPPORTED_TYPES } from "./metadataWriter";
import type { ItemResult } from "./refreshTypes";

const HTML = "http://www.w3.org/1999/xhtml";
const MENU_ID = "publisher-metadata-refresh-command";
const windows = new Map<_ZoteroTypes.MainWindow, () => void>();
let active:
  | {
      cancellation: Cancellation;
      win: _ZoteroTypes.MainWindow;
      panel: HTMLElement;
    }
  | undefined;

function message(key: string, args?: Record<string, unknown>): string {
  return getString(`refresh-${key}` as FluentMessageId, { args });
}

export function registerRefreshWindow(win: _ZoteroTypes.MainWindow): void {
  if (windows.has(win)) return;
  const doc = win.document;
  const popup = doc.getElementById("zotero-itemmenu");
  if (!popup) return;
  const menu = doc.createXULElement("menuitem");
  menu.id = MENU_ID;
  menu.setAttribute("label", message("command"));
  const command = () => {
    void startRefresh(win);
  };
  const showing = () => {
    const items = win.ZoteroPane.getSelectedItems();
    const eligible = items.some(
      (item) =>
        !item.deleted &&
        SUPPORTED_TYPES.has(Zotero.ItemTypes.getName(item.itemTypeID)) &&
        item.isEditable(),
    );
    menu.setAttribute("disabled", String(Boolean(active) || !eligible));
  };
  menu.addEventListener("command", command);
  popup.addEventListener("popupshowing", showing);
  popup.append(menu);
  const style = doc.createElementNS(HTML, "link") as HTMLLinkElement;
  style.rel = "stylesheet";
  style.href = `chrome://${addon.data.config.addonRef}/content/refresh.css`;
  doc.documentElement?.append(style);
  windows.set(win, () => {
    popup.removeEventListener("popupshowing", showing);
    menu.removeEventListener("command", command);
    menu.remove();
    style.remove();
    doc.getElementById("publisher-refresh-panel")?.remove();
  });
}

export function unregisterRefreshWindow(win: _ZoteroTypes.MainWindow): void {
  if (active?.win === win) active.cancellation.cancel();
  windows.get(win)?.();
  windows.delete(win);
}

export function shutdownRefresh(): void {
  active?.cancellation.cancel();
  for (const win of [...windows.keys()]) unregisterRefreshWindow(win);
}

export async function startRefresh(
  win: _ZoteroTypes.MainWindow,
  dependencies?: BatchDependencies,
): Promise<void> {
  if (active || !addon.data.alive) return;
  const selection = captureSelection(win.ZoteroPane.getSelectedItems());
  if (!selection.length) return;
  const doc = win.document;
  doc.getElementById("publisher-refresh-panel")?.remove();
  const element = <T extends keyof HTMLElementTagNameMap>(
    tag: T,
    text = "",
  ) => {
    const el = doc.createElementNS(HTML, tag) as HTMLElementTagNameMap[T];
    el.textContent = text;
    return el;
  };
  const panel = element("section");
  panel.id = "publisher-refresh-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-labelledby", "publisher-refresh-heading");
  const heading = element("h2", message("command"));
  heading.id = "publisher-refresh-heading";
  const status = element(
    "p",
    message("progress", { completed: 0, total: selection.length }),
  );
  status.setAttribute("role", "status");
  const explanation = element("p", message("immediate"));
  const table = element("table");
  const head = element("thead");
  const header = element("tr");
  for (const key of ["item", "result", "details", "source"])
    header.append(element("th", message(key)));
  head.append(header);
  const body = element("tbody");
  table.append(head, body);
  const scroller = element("div");
  scroller.className = "refresh-results";
  scroller.append(table);
  const button = element("button", message("cancel"));
  button.type = "button";
  const cancellation = new Cancellation();
  const batch = { cancellation, win, panel };
  active = batch;
  const cancel = () => {
    cancellation.cancel();
    button.disabled = true;
  };
  button.addEventListener("click", cancel);
  panel.append(heading, explanation, status, scroller, button);
  doc.documentElement?.append(panel);
  button.focus();
  try {
    const results = await runBatch(
      selection,
      cancellation,
      (result: ItemResult, completed: number) => {
        if (!panel.isConnected) return;
        status.textContent = message("progress", {
          completed,
          total: selection.length,
        });
        const row = element("tr");
        const details = result.reason
          ? message(`reason-${result.reason}`)
          : result.changedFields
              .map((field) =>
                field === "creators"
                  ? message("authors")
                  : Zotero.ItemFields.getLocalizedString(field),
              )
              .join(", ");
        row.append(
          element("td", result.title),
          element("td", message(result.outcome)),
          element("td", details),
        );
        const source = element("td");
        if (result.sourceURL) {
          const link = element("a", message("publisher-page"));
          link.href = result.sourceURL;
          link.addEventListener("click", (event) => {
            event.preventDefault();
            Zotero.launchURL(result.sourceURL!);
          });
          source.append(link);
        }
        row.append(source);
        body.append(row);
      },
      dependencies,
    );
    if (panel.isConnected) {
      status.textContent = message(
        "summary",
        Object.fromEntries(
          ["updated", "unchanged", "skipped", "failed", "cancelled"].map(
            (outcome) => [
              outcome,
              results.filter((r) => r.outcome === outcome).length,
            ],
          ),
        ),
      );
    }
  } finally {
    if (active === batch) active = undefined;
    button.removeEventListener("click", cancel);
    button.disabled = false;
    button.textContent = message("close");
    button.addEventListener(
      "click",
      () => {
        panel.remove();
      },
      { once: true },
    );
  }
}
