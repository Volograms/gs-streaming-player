export const CONTENT_TOOL_COMMANDS = [
  "build-manifest",
  "extract-rad-cuts",
  "inspect-rad",
  "measure-quality-levels",
  "validate-sequence",
] as const;

export type ContentToolCommand = (typeof CONTENT_TOOL_COMMANDS)[number];

export function isContentToolCommand(value: string): value is ContentToolCommand {
  return CONTENT_TOOL_COMMANDS.some((command) => command === value);
}
