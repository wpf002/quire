'use client';

import { useCallback, useState } from 'react';
import { errorMessage } from './api';

export interface Action {
  busy: boolean;
  error: string | null;
  run: (task: () => Promise<void>) => Promise<boolean>;
  clear: () => void;
}

/** Tracks one async action's busy and error state. run() resolves true on success. */
export function useAction(): Action {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clear: () => setError(null) };
}
