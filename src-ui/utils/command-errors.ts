export function isUnknownCommandError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown|not found|unsupported|invoke|command/i.test(message);
}
