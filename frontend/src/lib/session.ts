"use client";

import { useEffect, useState } from "react";
import { api, type Session } from "@/lib/api";

export interface UseSession {
  session: Session | null;
  loading: boolean;
}

/** Reads the current session (decoded JWT claims) from the BFF. */
export function useSession(): UseSession {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.auth
      .session()
      .then((s) => active && setSession(s))
      .catch(() => active && setSession(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return { session, loading };
}
