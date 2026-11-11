'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, errorMessage, setCsrfToken } from '@/lib/api';
import type { User } from '@/lib/types';
import { Wordmark } from './wordmark';

const MIN_PASSWORD = 10;
const STAGES = ['Upload', 'Edit', 'Comply', 'Metadata', 'Export', 'Publish', 'Track'];

type Mode = 'login' | 'signup';

/** Only follow same-site relative paths after sign-in. */
function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/shelf';
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ user: User; csrfToken: string }>(`/auth/${mode}`, body);
      setCsrfToken(result.csrfToken);
      router.replace(safeNext(params.get('next')));
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <aside className="auth-side">
        <Wordmark />
        <ol className="auth-stages">
          {STAGES.map((stage, index) => (
            <li key={stage}>
              <span className="num">{String(index + 1).padStart(2, '0')}</span>
              {stage}
            </li>
          ))}
        </ol>
      </aside>
      <section className="auth-main">
        <form className="auth-form form-grid" onSubmit={submit}>
          <h1>{mode === 'login' ? 'Sign In' : 'Create Account'}</h1>
          {mode === 'signup' && (
            <label className="field">
              <span className="field-label">Name</span>
              <input className="input" name="name" autoComplete="name" required maxLength={120} />
            </label>
          )}
          <label className="field">
            <span className="field-label">Email</span>
            <input className="input" name="email" type="email" autoComplete="email" required />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input
              className="input"
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'signup' ? MIN_PASSWORD : undefined}
              required
            />
            {mode === 'signup' && <span className="field-hint">{MIN_PASSWORD}+ characters</span>}
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn-primary btn-large" disabled={busy}>
            {busy ? <span className="spinner" /> : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
          <p className="muted auth-switch">
            {mode === 'login' ? (
              <>
                New here? <Link href="/signup">Create Account</Link>
              </>
            ) : (
              <>
                Have an account? <Link href="/login">Sign In</Link>
              </>
            )}
          </p>
        </form>
      </section>
    </div>
  );
}
