export interface FoundationStatusItem {
  label: string;
  status: "ready" | "planned";
}

export function getFoundationStatus(): FoundationStatusItem[] {
  return [
    { label: "Strict TypeScript package boundaries", status: "ready" },
    { label: "Framework-independent player core", status: "ready" },
    { label: "Spark renderer implementation", status: "ready" },
    { label: "Temporal streaming engine", status: "ready" },
    { label: "Network-adaptive quality policy", status: "planned" },
  ];
}
