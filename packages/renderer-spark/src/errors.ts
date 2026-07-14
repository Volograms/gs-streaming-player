export class SparkRendererAdapterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SparkRendererAdapterError";
  }
}

export class SparkRendererAbortError extends SparkRendererAdapterError {
  constructor(message = "The renderer operation was aborted.") {
    super(message);
    this.name = "SparkRendererAbortError";
  }
}

export class SparkRendererStateError extends SparkRendererAdapterError {
  constructor(message: string) {
    super(message);
    this.name = "SparkRendererStateError";
  }
}
