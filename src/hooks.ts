import {
  registerRefreshPreferences,
  unregisterRefreshPreferences,
} from "./modules/refreshPreferences";
import { initLocale } from "./utils/locale";
import {
  registerRefreshWindow,
  unregisterRefreshWindow,
  shutdownRefresh,
} from "./modules/refreshUI";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  if (!addon.data.alive) return;
  initLocale();
  await registerRefreshPreferences();
  for (const win of Zotero.getMainWindows()) await onMainWindowLoad(win);
  addon.data.initialized = true;
}
async function onMainWindowLoad(win: _ZoteroTypes.MainWindow) {
  if (!addon.data.alive) return;
  registerRefreshWindow(win);
}
async function onMainWindowUnload(win: _ZoteroTypes.MainWindow) {
  unregisterRefreshWindow(win);
}
function onShutdown() {
  addon.data.alive = false;
  shutdownRefresh();
  unregisterRefreshPreferences();
  ztoolkit.unregisterAll();
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}
export default { onStartup, onMainWindowLoad, onMainWindowUnload, onShutdown };
