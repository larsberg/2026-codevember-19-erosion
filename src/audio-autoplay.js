// Reuse the unlocked context on return. If the browser blocks resume, retry
// synchronously on touch down/release with a cancellable statechange wait.
export function resumeAudioContext(context, { target = document, onWaiting = () => {} } = {}) {
  const gestures = ["pointerdown", "pointerup", "touchend", "click", "keydown"];
  let settled = false, resolve, reject;
  const ready = new Promise((yes, no) => { resolve = yes; reject = no; });
  function finish(running, error) {
    if (settled) return;
    settled = true;
    for (const gesture of gestures) target.removeEventListener(gesture, attempt);
    context.removeEventListener("statechange", changed);
    if (error) reject(error); else resolve(running);
  }
  function changed() {
    if (context.state === "running") finish(true);
    else if (context.state === "closed") finish(false);
  }
  function failed(error) {
    if (error.name !== "NotAllowedError") finish(false, error);
  }
  function attempt(event) {
    if (settled || target.hidden) return;
    if (event?.type === "keydown" && (event.key === "Escape" || event.ctrlKey || event.altKey || event.metaKey)) return;
    try { context.resume().then(changed, failed); }
    catch (error) { failed(error); }
    changed();
  }
  for (const gesture of gestures) target.addEventListener(gesture, attempt);
  context.addEventListener("statechange", changed);
  changed();
  if (!settled) attempt();
  if (!settled) onWaiting();
  return { ready, cancel: () => finish(false) };
}
