const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export async function api(path: string, opts: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  return r.json();
}
