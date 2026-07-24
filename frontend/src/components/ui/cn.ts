// Tiny className joiner — filters falsy and joins with spaces. Enough for our variant maps; no
// dependency, no tailwind-merge (our component APIs don't append conflicting utilities).
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
