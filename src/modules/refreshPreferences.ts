import { config } from "../../package.json";
import { getPref } from "../utils/prefs";
import type { RefreshOptions } from "./refreshTypes";

let pane: string | undefined;
let pending: Promise<void> | undefined;
let generation = 0;
export function readRefreshOptions(): RefreshOptions {
  return {
    updateAbstract: getPref("updateAbstract") !== false,
    crossrefFallback: getPref("crossrefFallback") !== false,
  };
}
export async function registerRefreshPreferences(): Promise<void> {
  if (pane) return;
  if (pending) return pending;
  const current = generation;
  const registration = (async () => {
    const id = await Zotero.PreferencePanes.register({
      pluginID: config.addonID,
      id: `${config.addonRef}-preferences`,
      src: `chrome://${config.addonRef}/content/preferences.xhtml`,
      label: config.addonName,
    });
    if (current !== generation) Zotero.PreferencePanes.unregister(id);
    else pane = id;
  })();
  pending = registration;
  try {
    await registration;
  } finally {
    if (pending === registration) pending = undefined;
  }
}
export function unregisterRefreshPreferences(): void {
  generation++;
  if (pane) Zotero.PreferencePanes.unregister(pane);
  pane = undefined;
}
