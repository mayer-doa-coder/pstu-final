/** "nabila@example.com" -> "n***@example.com". Never return the full address (PRD.md §4.3). */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) {
    return email;
  }

  const firstChar = email.slice(0, 1);
  const domain = email.slice(atIndex);
  return `${firstChar}***${domain}`;
}
