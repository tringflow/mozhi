/** Extracts a displayable message from an unknown thrown value. */
export function getErrorMessage(err: unknown, fallback = "An unexpected error occurred."): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}
