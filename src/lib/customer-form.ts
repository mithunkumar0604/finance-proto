// Checks for the customer form (new and edit), before anything is sent.

const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "");

/**
 * What is wrong with what was typed, in words for the user; null when it can be saved.
 * `was` is the customer as saved now: one brought in from the old book without a phone
 * may stay without one, but nobody loses a number they had.
 */
export function customerProblem(f: { name: string; phone: string; altPhone?: string }, was: { phone: string }): string | null {
  if (!f.name.trim()) return "Enter the customer's name.";
  const phone = digits(f.phone);
  if (phone.length !== 10 && !(phone.length === 0 && !f.phone.trim() && !was.phone)) return "Enter a 10-digit mobile number.";
  const alt = digits(f.altPhone);
  if (alt.length !== 0 && alt.length !== 10) return "The alternate number must be 10 digits, or empty.";
  return null;
}
