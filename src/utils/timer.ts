/** Native timers survive unrelated main-window closure; owners explicitly cancel them. */
export function scheduleTimeout(
  callback: () => void,
  milliseconds: number,
): () => void {
  const { classes, interfaces } = Zotero.getMainWindow().Components;
  const timer = (classes as unknown as Record<string, nsIFactory>)[
    "@mozilla.org/timer;1"
  ].createInstance(interfaces.nsITimer);
  timer.initWithCallback(
    { notify: callback },
    milliseconds,
    interfaces.nsITimer.TYPE_ONE_SHOT!,
  );
  return () => timer.cancel();
}
