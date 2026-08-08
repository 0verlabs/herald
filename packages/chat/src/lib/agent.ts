/** Two-letter uppercase initials for avatar fallbacks. */
export function agentInitials(name: string) {
  return name
    .split(" ")
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Green above 80, amber above 40, red below — same scale everywhere. */
export function agentScoreClassName(score: number) {
  if (score > 80) return "text-green-600 dark:text-green-400";
  if (score > 40) return "text-amber-500 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}
