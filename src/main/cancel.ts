/** Tracks AbortControllers for in-flight processing (import transcode +
 *  transcription) so the UI can stop a session midway. Aborting the signal
 *  kills the spawned ffmpeg child (via spawn's `signal` option) and aborts the
 *  in-flight OpenAI requests. */
const controllers = new Map<string, AbortController>();

export function beginCancellable(id: string): AbortController {
  const c = new AbortController();
  controllers.set(id, c);
  return c;
}

/** Remove the entry, but only if it's still the controller we started with —
 *  avoids a finishing phase clobbering a newer phase's controller. */
export function finishCancellable(id: string, c?: AbortController): void {
  if (!c || controllers.get(id) === c) controllers.delete(id);
}

export function cancel(id: string): boolean {
  const c = controllers.get(id);
  if (!c) return false;
  c.abort();
  return true;
}
