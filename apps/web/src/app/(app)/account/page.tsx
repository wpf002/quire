'use client';

import { type FormEvent, useState } from 'react';
import { useSession } from '@/components/session';
import { api } from '@/lib/api';
import { dollars } from '@/lib/format';
import type { PlanId, UsageView, User } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { useResource } from '@/lib/use-resource';

const CENTS_PER_DOLLAR = 100;

function ProfileForm() {
  const { user, setUser } = useSession();
  const [name, setName] = useState(user.name);
  const [cap, setCap] = useState((user.spendCapCentsDaily / CENTS_PER_DOLLAR).toFixed(2));
  const [saved, setSaved] = useState(false);
  const action = useAction();

  async function save(event: FormEvent) {
    event.preventDefault();
    const ok = await action.run(async () => {
      const result = await api.patch<{ user: User }>('/account', { name: name.trim(), spendCapCentsDaily: Math.round(Number(cap) * CENTS_PER_DOLLAR) });
      setUser(result.user);
    });
    setSaved(ok);
  }

  return (
    <form className="panel" onSubmit={(event) => void save(event)}>
      <div className="panel-head">
        <h2>Profile</h2>
      </div>
      <div className="panel-body stack">
        <label className="field">
          <span className="field-label">Email</span>
          <input className="input" value={user.email} disabled />
        </label>
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" required maxLength={120} value={name} onChange={(event) => { setSaved(false); setName(event.target.value); }} />
        </label>
        <label className="field">
          <span className="field-label">Daily AI Cap (USD)</span>
          <input className="input num" type="number" min={0} step={0.01} value={cap} onChange={(event) => { setSaved(false); setCap(event.target.value); }} />
        </label>
        {action.error && <div className="form-error">{action.error}</div>}
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            {action.busy ? <span className="spinner" /> : saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  );
}

function PlanPicker({ plans }: { plans: UsageView['plans'] }) {
  const { user, setUser } = useSession();
  const action = useAction();

  async function choose(plan: PlanId) {
    await action.run(async () => {
      const result = await api.post<{ user: User }>('/account/plan', { plan });
      setUser(result.user);
    });
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Plan</h2>
      </div>
      {action.error && (
        <div className="panel-body">
          <div className="notice notice-gilt">{action.error}</div>
        </div>
      )}
      <ul className="plan-list">
        {plans.map((plan) => (
          <li key={plan.id} aria-current={plan.id === user.plan ? 'true' : undefined}>
            <div>
              <strong>{plan.name}</strong>
              <div className="muted small num">
                {plan.activeBooks} {plan.activeBooks === 1 ? 'book' : 'books'} · {dollars(plan.spendCapCentsDaily)}/day · {plan.trackedKeywordsPerBook} keywords
              </div>
            </div>
            <span className="num">{dollars(plan.monthlyCents)}/mo</span>
            {plan.id === user.plan ? (
              <span className="tag tag-ok">Current</span>
            ) : (
              <button type="button" className="btn btn-small" disabled={action.busy} onClick={() => void choose(plan.id)}>
                Switch
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AccountPage() {
  const { signOut } = useSession();
  const usage = useResource<UsageView>('/usage');
  return (
    <div className="page">
      <div className="page-head">
        <h1>Account</h1>
        <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
          Sign Out
        </button>
      </div>
      <div className="split">
        <ProfileForm />
        {usage.data && <PlanPicker plans={usage.data.plans} />}
      </div>
    </div>
  );
}
