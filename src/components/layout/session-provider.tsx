"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/**
 * Client-side view of the session, for UI only (enabling admin controls).
 * It is NOT a security boundary: every Server Action re-checks requireAdmin().
 */
export interface SessionInfo {
  isAdmin: boolean;
  email: string | null;
}

const SessionContext = createContext<SessionInfo>({ isAdmin: false, email: null });

export function SessionProvider({ value, children }: { value: SessionInfo; children: ReactNode }) {
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionInfo {
  return useContext(SessionContext);
}
