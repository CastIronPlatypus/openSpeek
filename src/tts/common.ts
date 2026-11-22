export function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error || error instanceof DOMException
    ? error.name === 'AbortError'
    : false;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

/** Resolves like `promise`, or rejects with an AbortError as soon as `signal` aborts. */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** True when `text` has nothing a TTS engine could pronounce. */
export function isUnspeakable(text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(text);
}

/** Every engine produces mono PCM at this rate (Phonon's native rate; server audio is resampled to it). */
export const SAMPLE_RATE = 24000;

/** What unspeakable text synthesises to. */
export function shortSilence(sampleRate: number): Float32Array {
  return new Float32Array(Math.round(sampleRate * 0.2));
}
