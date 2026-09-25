import { ManifestLoadValidationError } from "@6g-path/gaussian-player";

export function describeShowcaseError(error: unknown): string {
  if (error instanceof ManifestLoadValidationError) {
    const details = error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    return `Manifest validation failed: ${details}`;
  }
  if (error instanceof Error) {
    if (error.message.includes("Failed to fetch")) {
      return "The dataset could not be fetched. Check its URL, HTTPS certificate, and CORS headers.";
    }
    return error.message;
  }
  return String(error);
}
