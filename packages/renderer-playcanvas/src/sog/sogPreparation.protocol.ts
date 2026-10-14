import type { PreparedSogImages } from "./sogPreparation.js";

export type SogPreparationRequest =
  { type: "prepare"; id: number; bytes: ArrayBuffer } | { type: "cancel"; id: number };

export type SogPreparationResponse =
  | { id: number; ok: true; result: PreparedSogImages; workerDurationMs: number }
  | {
      id: number;
      ok: false;
      error: string;
      unsupported: boolean;
      unavailable: boolean;
    };
