const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export async function api(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = { ...((opts.headers as Record<string, string>) || {}) };
  // Only default to JSON for string bodies — FormData sets its own multipart boundary.
  if (typeof opts.body === "string" && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const r = await fetch(`${API}${path}`, { credentials: "include", ...opts, headers });
  return r.json();
}
