'use client';

/**
 * Holds the signed-in user and their wallet for the app shell.
 *
 * The session itself lives in httpOnly cookies owned by the API — this context
 * only mirrors "who is signed in" for rendering, and is rebuilt from
 * GET /users/me on every mount. Wallet balance is always the value the server
 * last returned; it is never adjusted locally after a transfer, only refetched.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ApiError } from './api-client';
import { getMe, getWallet, logout as logoutRequest } from './api';
import type { UserProfile, Wallet } from './api-types';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

interface SessionContextValue {
  status: SessionStatus;
  user: UserProfile | null;
  wallet: Wallet | null;
  walletError: string | null;
  isWalletRefreshing: boolean;
  refreshWallet: () => Promise<void>;
  refreshSession: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): ReactElement {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [isWalletRefreshing, setIsWalletRefreshing] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshWallet = useCallback(async () => {
    setIsWalletRefreshing(true);
    try {
      const next = await getWallet();
      if (mounted.current) {
        setWallet(next);
        setWalletError(null);
      }
    } catch (error) {
      if (mounted.current) {
        setWalletError(error instanceof ApiError ? error.message : 'Could not load your balance.');
      }
    } finally {
      if (mounted.current) {
        setIsWalletRefreshing(false);
      }
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const profile = await getMe();
      if (!mounted.current) {
        return;
      }
      setUser(profile);
      setStatus('authenticated');
      await refreshWallet();
    } catch (error) {
      if (!mounted.current) {
        return;
      }
      // 401 is the normal "not signed in" answer, not an error worth showing.
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setWallet(null);
        setStatus('anonymous');
        return;
      }
      setStatus('anonymous');
      setWalletError(error instanceof ApiError ? error.message : 'Could not reach the server.');
    }
  }, [refreshWallet]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      if (mounted.current) {
        setUser(null);
        setWallet(null);
        setWalletError(null);
        setStatus('anonymous');
      }
    }
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      wallet,
      walletError,
      isWalletRefreshing,
      refreshWallet,
      refreshSession,
      signOut,
    }),
    [status, user, wallet, walletError, isWalletRefreshing, refreshWallet, refreshSession, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error('useSession must be used inside a SessionProvider.');
  }

  return context;
}
