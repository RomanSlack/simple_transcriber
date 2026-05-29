/** Maps raw OpenAI SDK / network errors to short, human-friendly messages.
 *  Every message reassures that the recording is saved and points at the fix,
 *  since the user can always press Retry once the cause is resolved. */
export function friendlyTranscribeError(err: unknown): string {
  const e = err as any;
  const status: number | undefined = e?.status ?? e?.response?.status;
  const code: string | undefined = e?.code ?? e?.error?.code;
  const raw: string = (e?.message ?? String(e)) ?? '';
  const lower = raw.toLowerCase();

  // Our own "no key" error — already friendly.
  if (lower.includes('api key') && lower.includes('not set')) return raw;

  // Connectivity problems surface with no HTTP status.
  if (
    status === undefined &&
    (code === 'ENOTFOUND' ||
      code === 'ECONNREFUSED' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === 'EAI_AGAIN' ||
      lower.includes('connection error') ||
      lower.includes('fetch failed') ||
      lower.includes('network') ||
      lower.includes('getaddrinfo') ||
      lower.includes('timed out'))
  ) {
    return "Couldn't reach OpenAI — check your internet connection. Your recording is saved; press Retry when you're back online.";
  }

  if (status === 401) return 'Your OpenAI API key was rejected. Open Settings to update it, then press Retry.';
  if (status === 403) return "Your OpenAI account doesn't have access to this model. Check Settings, then press Retry.";
  if (status === 429) {
    if (lower.includes('quota') || code === 'insufficient_quota') {
      return 'Your OpenAI account is out of credit. Add billing at platform.openai.com, then press Retry.';
    }
    return 'OpenAI is rate-limiting requests. Wait a minute, then press Retry. (Lowering "workers" in Settings can help.)';
  }
  if (status === 413) return 'An audio chunk was too large for OpenAI. Lower the chunk length in Settings, then press Retry.';
  if (status !== undefined && status >= 500) {
    return 'OpenAI had a server error. Your recording is saved — press Retry in a moment.';
  }

  return raw || 'Transcription failed. Your recording is saved — press Retry.';
}
