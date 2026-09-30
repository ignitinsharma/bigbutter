// Short timestamp: time today ("4:22 PM"), else date ("22 Apr").
export function when(ts: string | number): string {
  const d = new Date(ts);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

// "Apr 22, 2026 · 4:22 PM"
export function stamp(ts: string | number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
