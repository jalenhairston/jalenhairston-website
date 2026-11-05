// Server-only: the shared edit code check (PLACES_EDIT_CODE), constant-time.
import "server-only";
import crypto from "node:crypto";

/** Null when the code is right; otherwise why not. */
export function editCodeProblem(code: unknown): string | null {
  const expected = process.env.PLACES_EDIT_CODE;
  if (!expected) return "Editing isn't set up on this site yet (PLACES_EDIT_CODE is missing).";
  const a = crypto.createHash("sha256").update(String(code ?? "")).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b) ? null : "That edit code isn't right.";
}
