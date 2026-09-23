export interface CompressedFrameRequest {
  byteSize?: number;
  frameIndex: number;
  url: string;
}

export interface CompressedFrameCacheSnapshot {
  activeFetchCount: number;
  capacityBytes: number;
  contiguousReadyFrameCount: number;
  queuedFetchCount: number;
  readyFrameCount: number;
  residentBytes: number;
}

export type CompressedFrameCacheTraceEventType =
  "fetch-started" | "fetch-ready" | "cache-hit" | "fetch-failed";

export interface CompressedFrameCacheTraceEvent {
  atMs: number;
  /** True only when browser Resource Timing positively identifies a local cache hit. */
  fromCache?: boolean;
  bodyReadMs?: number;
  connectionReused?: boolean;
  connectionSetupMs?: number;
  durationMs?: number;
  errorMessage?: string;
  frameIndex: number;
  loadedBytes?: number;
  networkProtocol?: string;
  responseLatencyMs?: number;
  totalBytes?: number;
  type: CompressedFrameCacheTraceEventType;
  url: string;
}

interface FetchedBytes {
  fromCache?: boolean;
  bodyReadMs: number;
  bytes: ArrayBuffer;
  connectionReused?: boolean;
  connectionSetupMs?: number;
  networkProtocol?: string;
  responseLatencyMs: number;
}

interface FetchResourceTiming {
  fromCache?: boolean;
  connectionReused: boolean;
  connectionSetupMs: number;
  networkProtocol?: string;
}

export interface CompressedFrameCacheOptions {
  fetch?: typeof fetch;
  maximumBytes: number;
  maximumFetchConcurrency?: number;
  now?: () => number;
  onChange?: (snapshot: Readonly<CompressedFrameCacheSnapshot>) => void;
  onTrace?: (event: Readonly<CompressedFrameCacheTraceEvent>) => void;
}

interface CacheEntry {
  bytes?: ArrayBuffer;
  controller: AbortController | undefined;
  demandCount: number;
  lastUsed: number;
  planPriority: number;
  promise?: Promise<ArrayBuffer>;
  reject?: (reason: unknown) => void;
  resolve?: (bytes: ArrayBuffer) => void;
  request: CompressedFrameRequest;
  state: "queued" | "fetching" | "ready";
}

function abortError(): Error {
  const error = new Error("Compressed frame request was cancelled.");
  error.name = "AbortError";
  return error;
}

/**
 * Byte-budgeted compressed frame store. Fetching is deliberately independent of
 * decoded-frame preparation: a small renderer ring can consume a much larger
 * network buffer without occupying decoder/worker slots while bytes are in flight.
 */
export class CompressedFrameCache {
  private activeFetchCountValue = 0;
  private disposed = false;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly fetchImplementation: typeof fetch;
  private readonly maximumBytes: number;
  private readonly maximumFetchConcurrency: number;
  private readonly now: () => number;
  private readonly onChange: CompressedFrameCacheOptions["onChange"];
  private readonly onTrace: CompressedFrameCacheOptions["onTrace"];
  private sequence = 0;

  constructor(options: CompressedFrameCacheOptions) {
    if (!Number.isFinite(options.maximumBytes) || options.maximumBytes <= 0) {
      throw new RangeError("maximumBytes must be a positive finite number.");
    }
    const maximumFetchConcurrency = options.maximumFetchConcurrency ?? 6;
    if (!Number.isInteger(maximumFetchConcurrency) || maximumFetchConcurrency <= 0) {
      throw new RangeError("maximumFetchConcurrency must be a positive integer.");
    }
    this.maximumBytes = options.maximumBytes;
    this.maximumFetchConcurrency = maximumFetchConcurrency;
    const fetchImplementation = options.fetch ?? globalThis.fetch;
    this.fetchImplementation = fetchImplementation.bind(globalThis);
    this.now = options.now ?? (() => performance.now());
    this.onChange = options.onChange;
    this.onTrace = options.onTrace;
  }

  get snapshot(): CompressedFrameCacheSnapshot {
    let residentBytes = 0;
    let readyFrameCount = 0;
    let queuedFetchCount = 0;
    const readyPlanPriorities = new Set<number>();
    for (const entry of this.entries.values()) {
      if (entry.state === "ready") {
        residentBytes += entry.bytes?.byteLength ?? 0;
        readyFrameCount += 1;
        if (Number.isFinite(entry.planPriority)) {
          readyPlanPriorities.add(entry.planPriority);
        }
      } else if (entry.state === "queued") {
        queuedFetchCount += 1;
      }
    }
    let contiguousReadyFrameCount = 0;
    while (readyPlanPriorities.has(contiguousReadyFrameCount)) {
      contiguousReadyFrameCount += 1;
    }
    return {
      activeFetchCount: this.activeFetchCountValue,
      capacityBytes: this.maximumBytes,
      contiguousReadyFrameCount,
      queuedFetchCount,
      readyFrameCount,
      residentBytes,
    };
  }

  /** Consume a nearest-first plan lazily, stopping when the byte budget is filled. */
  setPlan(requests: Iterable<CompressedFrameRequest>): void {
    this.assertNotDisposed();
    const plannedUrls = new Set<string>();
    let plannedBytes = 0;
    let unknownSizeCount = 0;
    for (const request of requests) {
      const declaredBytes = request.byteSize ?? 0;
      const expectedBytes =
        this.entries.get(request.url)?.bytes?.byteLength ??
        (Number.isFinite(declaredBytes) ? Math.max(0, declaredBytes) : 0);
      if (
        plannedUrls.size > 0 &&
        expectedBytes > 0 &&
        plannedBytes + expectedBytes > this.maximumBytes
      ) {
        break;
      }
      plannedUrls.add(request.url);
      plannedBytes += expectedBytes;
      const entry = this.ensureEntry(request);
      entry.planPriority = plannedUrls.size - 1;
      if (expectedBytes === 0) unknownSizeCount += 1;
      // Missing sizes must not make an arbitrarily long sequence look free. Allow
      // one fetch batch; subsequent plans can use the observed response sizes.
      if (
        plannedBytes >= this.maximumBytes ||
        unknownSizeCount >= this.maximumFetchConcurrency
      ) {
        break;
      }
    }

    for (const [url, entry] of this.entries) {
      if (plannedUrls.has(url) || entry.demandCount > 0) {
        continue;
      }
      entry.planPriority = Number.POSITIVE_INFINITY;
      if (entry.state === "queued") {
        this.entries.delete(url);
      } else if (entry.state === "fetching") {
        entry.controller?.abort();
      }
    }
    this.evictToBudget();
    this.emitChange();
    this.drain();
  }

  async get(
    request: CompressedFrameRequest,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    this.assertNotDisposed();
    if (signal?.aborted === true) {
      throw abortError();
    }
    const entry = this.ensureEntry(request);
    entry.demandCount += 1;
    entry.lastUsed = this.sequence++;
    if (entry.state === "ready" && entry.bytes !== undefined) {
      this.onTrace?.({
        atMs: this.now(),
        frameIndex: request.frameIndex,
        loadedBytes: entry.bytes.byteLength,
        totalBytes: entry.bytes.byteLength,
        type: "cache-hit",
        url: request.url,
      });
    }
    this.drain();
    try {
      return await this.waitForEntry(entry, signal);
    } finally {
      entry.demandCount = Math.max(0, entry.demandCount - 1);
      entry.lastUsed = this.sequence++;
      this.evictToBudget();
      this.emitChange();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.controller?.abort();
      if (entry.state !== "ready") {
        entry.reject?.(abortError());
      }
    }
    this.entries.clear();
    this.emitChange();
  }

  private ensureEntry(request: CompressedFrameRequest): CacheEntry {
    const existing = this.entries.get(request.url);
    if (existing !== undefined) {
      existing.request = request;
      return existing;
    }
    const entry: CacheEntry = {
      controller: undefined,
      demandCount: 0,
      lastUsed: this.sequence++,
      planPriority: Number.POSITIVE_INFINITY,
      request,
      state: "queued",
    };
    entry.promise = new Promise<ArrayBuffer>((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    // Prefetch-only entries may fail without a caller awaiting them. Failures are
    // still surfaced through onTrace; keep the internal deferred from becoming an
    // unhandled rejection.
    void entry.promise.catch(() => undefined);
    this.entries.set(request.url, entry);
    return entry;
  }

  private waitForEntry(entry: CacheEntry, signal?: AbortSignal): Promise<ArrayBuffer> {
    const promise =
      entry.state === "ready" && entry.bytes !== undefined
        ? Promise.resolve(entry.bytes)
        : entry.promise!;
    if (signal === undefined) {
      return promise;
    }
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const cancel = () => reject(abortError());
      signal.addEventListener("abort", cancel, { once: true });
      promise.then(
        (bytes) => {
          signal.removeEventListener("abort", cancel);
          resolve(bytes);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", cancel);
          reject(error);
        },
      );
    });
  }

  private drain(): void {
    if (this.disposed) {
      return;
    }
    while (this.activeFetchCountValue < this.maximumFetchConcurrency) {
      const entry = [...this.entries.values()]
        .filter(({ state }) => state === "queued")
        .sort(
          (left, right) =>
            Number(right.demandCount > 0) - Number(left.demandCount > 0) ||
            left.planPriority - right.planPriority ||
            left.lastUsed - right.lastUsed,
        )[0];
      if (entry === undefined) {
        return;
      }
      this.startFetch(entry);
    }
  }

  private startFetch(entry: CacheEntry): void {
    entry.state = "fetching";
    const controller = new AbortController();
    entry.controller = controller;
    const startedAt = this.now();
    this.activeFetchCountValue += 1;
    this.onTrace?.({
      atMs: startedAt,
      frameIndex: entry.request.frameIndex,
      ...(entry.request.byteSize === undefined
        ? {}
        : { totalBytes: entry.request.byteSize }),
      type: "fetch-started",
      url: entry.request.url,
    });
    const fetchPromise = this.fetchBytes(entry.request, controller.signal, startedAt)
      .then(
        ({
          bodyReadMs,
          bytes,
          fromCache,
          connectionReused,
          connectionSetupMs,
          networkProtocol,
          responseLatencyMs,
        }) => {
          if (controller.signal.aborted) {
            throw abortError();
          }
          entry.bytes = bytes;
          entry.state = "ready";
          entry.lastUsed = this.sequence++;
          this.onTrace?.({
            atMs: this.now(),
            bodyReadMs,
            ...(fromCache === undefined ? {} : { fromCache }),
            ...(connectionReused === undefined ? {} : { connectionReused }),
            ...(connectionSetupMs === undefined ? {} : { connectionSetupMs }),
            durationMs: this.now() - startedAt,
            frameIndex: entry.request.frameIndex,
            loadedBytes: bytes.byteLength,
            ...(networkProtocol === undefined ? {} : { networkProtocol }),
            responseLatencyMs,
            totalBytes: entry.request.byteSize ?? bytes.byteLength,
            type: "fetch-ready",
            url: entry.request.url,
          });
          this.evictToBudget();
          entry.resolve?.(bytes);
          return bytes;
        },
      )
      .catch((error: unknown) => {
        if (this.entries.get(entry.request.url) === entry) {
          this.entries.delete(entry.request.url);
        }
        if (!controller.signal.aborted) {
          this.onTrace?.({
            atMs: this.now(),
            durationMs: this.now() - startedAt,
            errorMessage: error instanceof Error ? error.message : String(error),
            frameIndex: entry.request.frameIndex,
            type: "fetch-failed",
            url: entry.request.url,
          });
        }
        entry.reject?.(error);
        throw error;
      })
      .finally(() => {
        entry.controller = undefined;
        this.activeFetchCountValue -= 1;
        this.emitChange();
        this.drain();
      });
    void fetchPromise.catch(() => undefined);
    this.emitChange();
  }

  private async fetchBytes(
    request: CompressedFrameRequest,
    signal: AbortSignal,
    startedAt: number,
  ): Promise<FetchedBytes> {
    const response = await this.fetchImplementation(request.url, { signal });
    const responseAt = this.now();
    if (!response.ok) {
      throw new Error(
        `Unable to fetch compressed frame ${request.frameIndex}: ${response.status} ${response.statusText}.`,
      );
    }
    const bytes = await response.arrayBuffer();
    const completedAt = this.now();
    const resourceTiming = this.readFetchResourceTiming(
      response.url || request.url,
      startedAt,
    );
    return {
      bodyReadMs: completedAt - responseAt,
      bytes,
      ...resourceTiming,
      responseLatencyMs: responseAt - startedAt,
    };
  }

  private readFetchResourceTiming(
    url: string,
    startedAt: number,
  ): FetchResourceTiming | undefined {
    if (
      typeof performance === "undefined" ||
      typeof performance.getEntriesByName !== "function"
    ) {
      return undefined;
    }
    const absoluteUrl =
      typeof location === "undefined" ? url : new URL(url, location.href).toString();
    const entry = performance.getEntriesByName(absoluteUrl, "resource").at(-1) as
      PerformanceResourceTiming | undefined;
    if (entry === undefined || entry.startTime < startedAt - 1) {
      return undefined;
    }
    const connectionSetupMs = Math.max(0, entry.connectEnd - entry.connectStart);
    const networkProtocol = entry.nextHopProtocol.trim();
    return {
      ...(entry.decodedBodySize > 0 ? { fromCache: entry.transferSize === 0 } : {}),
      connectionReused: connectionSetupMs === 0,
      connectionSetupMs,
      ...(networkProtocol.length === 0 ? {} : { networkProtocol }),
    };
  }

  private evictToBudget(): void {
    let residentBytes = this.snapshot.residentBytes;
    if (residentBytes <= this.maximumBytes) {
      return;
    }
    const candidates = [...this.entries.values()]
      .filter((entry) => entry.state === "ready" && entry.demandCount === 0)
      .sort(
        (left, right) =>
          right.planPriority - left.planPriority || left.lastUsed - right.lastUsed,
      );
    for (const entry of candidates) {
      if (residentBytes <= this.maximumBytes) {
        break;
      }
      this.entries.delete(entry.request.url);
      residentBytes -= entry.bytes?.byteLength ?? 0;
    }
  }

  private emitChange(): void {
    this.onChange?.(this.snapshot);
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("CompressedFrameCache has been disposed.");
    }
  }
}
