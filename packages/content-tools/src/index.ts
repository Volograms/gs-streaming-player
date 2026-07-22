export const CONTENT_TOOL_COMMANDS = [
  "build-manifest",
  "convert-sog",
  "extract-rad-cuts",
  "inspect-rad",
  "measure-quality-levels",
  "repack-spz-v4",
  "validate-sequence",
] as const;

export type ContentToolCommand = (typeof CONTENT_TOOL_COMMANDS)[number];

export function isContentToolCommand(value: string): value is ContentToolCommand {
  return CONTENT_TOOL_COMMANDS.some((command) => command === value);
}
