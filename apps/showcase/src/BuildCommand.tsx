import { useEffect, useState } from "react";

const command = "pnpm gs-content build dataset.json --output-dir public/content";

export function BuildCommand() {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => {
    if (status !== "copied") return;
    const timer = setTimeout(() => setStatus("idle"), 2500);
    return () => clearTimeout(timer);
  }, [status]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="landing-command">
      <div className="landing-command-label">
        Build your dataset<span>From the repository root</span>
      </div>
      <div className="landing-command-line">
        <pre>
          <code>{command}</code>
        </pre>
        <button type="button" onClick={() => void copy()}>
          {status === "copied" ? "Copied" : "Copy command"}
        </button>
      </div>
      <span
        className={status === "error" ? "landing-copy-error" : "landing-sr-only"}
        role="status"
      >
        {status === "copied"
          ? "Command copied to clipboard."
          : status === "error"
            ? "Clipboard unavailable. Select the command above to copy it."
            : ""}
      </span>
    </div>
  );
}
