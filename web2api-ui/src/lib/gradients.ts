// Deterministic gradient + initials helpers for colorful avatars across the admin UI.

// A single cool jewel-tone family (violet → fuchsia → indigo → sky) so avatars
// stay vivid yet harmonize with the aurora glass theme — no clashing warm hues.
const GRADIENTS = [
  "from-violet-500 to-fuchsia-500",
  "from-indigo-500 to-violet-500",
  "from-blue-500 to-indigo-500",
  "from-sky-500 to-blue-500",
  "from-fuchsia-500 to-purple-500",
  "from-purple-500 to-indigo-500",
  "from-cyan-500 to-blue-500",
  "from-violet-600 to-sky-500",
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
