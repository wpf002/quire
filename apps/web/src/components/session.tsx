'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, api, setCsrfToken } from '@/lib/api';
import type { User } from '@/lib/types';

interface SessionValue {
  user: User;
  setUser: (user: User) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <RequireSession>');
  return value;
}

/** Loads the signed-in user, or sends the visitor to /login. */
export function RequireSession({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<{ user: User; csrfToken: string }>('/auth/me')
      .then((me) => {
        if (!active) return;
        setCsrfToken(me.csrfToken);
        setUser(me.user);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        else setFailure(error instanceof Error ? error.message : 'Could not reach the API');
      });
    return () => {
      active = false;
    };
  }, [router, pathname]);

  const signOut = useCallback(async () => {
    await api.post('/auth/logout');
    setCsrfToken(null);
    router.replace('/login');
  }, [router]);

  if (failure) {
    return (
      <div className="page">
        <div className="form-error">API unreachable: {failure}</div>
      </div>
    );
  }
  if (!user) return <div className="page loading">Loading…</div>;
  return <SessionContext.Provider value={{ user, setUser, signOut }}>{children}</SessionContext.Provider>;
}
