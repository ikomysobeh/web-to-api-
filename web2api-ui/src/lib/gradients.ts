// Deterministic gradient + initials helpers for colorful avatars across the admin UI.

// A single warm ember family (orange → amber → red → yellow) so avatars stay
// vivid yet harmonize with the Little Caesars orange-on-black aurora theme.
const GRADIENTS = [
  "from-orange-500 to-amber-500",
  "from-amber-500 to-orange-600",
  "from-red-500 to-orange-500",
  "from-orange-600 to-yellow-500",
  "from-amber-600 to-red-500",
  "from-orange-500 to-red-500",
  "from-yellow-500 to-orange-500",
  "from-red-600 to-amber-500",
] as const;

/** Pick a stable gradient class pair for a given seed string. */
export function gradientFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return GRADIENTS[hash % GRADIENTS.length];
}

/** First 1–2 meaningful characters from a name or email, uppercased. */
export function initialsOf(text: string): string {
  const base = text.includes("@") ? text.split("@")[0] : text;
  const parts = base.split(/[.\s_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}
