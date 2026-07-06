// Shared helpers for turning any failure into a readable message.

const DEFAULT_MESSAGE = "Something went wrong. Please try again.";

/**
 * Turn any thrown value (a fetch Response, an Error, a string) into a
 * human-readable message. Reads `detail` or `error` from a JSON error body.
 */
export async function getErrorMessage(
  err: unknown,
  fallback: string = DEFAULT_MESSAGE,
): Promise<string> {
  if (err instanceof Response) {
    try {
      const body = (await err.json()) as { detail?: string; error?: string };
      return body.detail ?? body.error ?? fallback;
    } catch {
      return fallback;
    }
  }
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

/**
 * True when an error message looks like a Gemini connection / expiry problem,
 * so the UI can prompt the user to reconnect Gemini.
 */
export function isGeminiAuthError(text: string): boolean {
  const t = (text || "").toLowerCase();
  return /gemini|1psid|cookie|expired|unauthenticated|not connected|connect your gemini|session/.test(
    t,
  );
}
