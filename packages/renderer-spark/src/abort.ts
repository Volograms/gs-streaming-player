import { SparkRendererAbortError } from "./errors.js";

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new SparkRendererAbortError();
  }
}

export function waitWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  onAbortedResult: (result: T) => void,
): Promise<T> {
  if (signal === undefined) {
    return operation;
  }

  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    let aborted = false;

    const handleAbort = () => {
      aborted = true;
      reject(new SparkRendererAbortError());
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    operation.then(
      (result) => {
        signal.removeEventListener("abort", handleAbort);
        if (aborted) {
          onAbortedResult(result);
          return;
        }

        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort);
        if (!aborted) {
          reject(error);
        }
      },
    );
  });
}
