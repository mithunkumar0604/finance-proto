// Checks for the Change Password form, before anything is sent.

export const MIN_PASSWORD = 8;

/** What is wrong with what was typed, in words for the user; null when it can be sent. */
export function passwordProblem(current: string, next: string, confirm: string): string | null {
  if (!current) return "Enter your current password.";
  if (!next) return "Enter a new password.";
  if (next.length < MIN_PASSWORD) return `The new password needs at least ${MIN_PASSWORD} characters.`;
  if (next !== confirm) return "The two new passwords do not match.";
  if (next === current) return "The new password must be different from the current one.";
  return null;
}
