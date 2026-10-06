// useAccount: who is signed in, logout, and the shared 401 → /login bounce.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import type { HttpError } from "../helpers";

// Used by: useNotesPage. Returns { email, authFail, logout }.
export function useAccount() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    api("/auth/me").then(r => setEmail(r?.email || null), () => {});
  }, []);

  // Stale/forged cookie sailed past the edge check — bounce to login, preserving the return path.
  const authFail = (e: HttpError) => {
    if (e?.status === 401) { router.push("/login?next=/notes"); return true; }
    return false;
  };

  // End the session server-side, then go to login regardless of the outcome.
  const logout = async (beforeLeave: () => void) => {
    beforeLeave();
    try { await api("/auth/logout", { method: "POST", body: "{}" }); }
    finally { router.push("/login"); }
  };

  return { email, authFail, logout };
}
