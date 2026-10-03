// Buckets: each name gets a stable preset tint (lib/colors.ts tokens), so chips/badges re-theme in dark mode.
import { PRESETS } from "./colors";

export const OTHER = "Other";
export const bucketOf = (b?: string) => b || OTHER; // "" = not enriched yet

export function bucketTint(name: string): { background: string; borderColor: string } {
  if (name === OTHER) return { background: "var(--surface)", borderColor: "var(--line-strong)" };
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const k = PRESETS[h % PRESETS.length].key;
  return { background: `var(--c-${k}-bg)`, borderColor: `var(--c-${k}-line)` };
}
