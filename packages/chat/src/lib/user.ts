/** Two-letter monogram for an avatar fallback, e.g. "Jane Doe" -> "JD". */
export function initialsFrom(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .filter((letter): letter is string => letter !== undefined);
  return (letters.length > 1 ? `${letters[0]}${letters.at(-1)}` : (letters[0] ?? "")).toUpperCase();
}
