'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { RequireSession, useSession } from './session';
import { Wordmark } from './wordmark';

const NAV = [
  { href: '/shelf', label: 'Shelf' },
  { href: '/usage', label: 'Usage' },
  { href: '/account', label: 'Account' },
];

function TopBar() {
  const pathname = usePathname();
  const { user, signOut } = useSession();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Wordmark href="/shelf" />
        <nav className="nav" aria-label="Main">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} aria-current={pathname.startsWith(item.href) || (item.href === '/shelf' && pathname.startsWith('/books')) ? 'page' : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="topbar-end">
          <span className="tag tag-gilt">{user.plan[0]?.toUpperCase() + user.plan.slice(1)}</span>
          <span className="hide-narrow muted">{user.name}</span>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void signOut()}>
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <RequireSession>
      <div className="shell">
        <TopBar />
        <main>{children}</main>
      </div>
    </RequireSession>
  );
}
