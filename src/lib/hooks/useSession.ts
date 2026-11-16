'use client';

import { useSession as useNextAuthSession } from 'next-auth/react';

export interface SessionUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role: string;
}

export function useSession() {
  const { data: session, status, update } = useNextAuthSession();

  return {
    session,
    user: session?.user as SessionUser | undefined,
    status,
    isAuthenticated: status === 'authenticated',
    isLoading: status === 'loading',
    update,
  };
}
