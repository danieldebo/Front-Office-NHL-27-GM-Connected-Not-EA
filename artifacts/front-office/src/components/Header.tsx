import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth, useClerk } from '@clerk/react';
import { useListNotifications, getListNotificationsQueryKey } from '@workspace/api-client-react';
import type { League } from '@workspace/api-client-react';

export default function Header({ league }: { league?: League }) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();

  const { data: notifData } = useListNotifications(
    { unread_only: true, limit: 1 },
    {
      query: {
        enabled: !!isSignedIn,
        queryKey: getListNotificationsQueryKey({ unread_only: true, limit: 1 }),
        refetchInterval: 30_000,
      },
    },
  );
  const unreadCount = notifData?.unread_count || 0;

  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  return (
    <header className="masthead">
      <div className="wrap">
        <Link href="/" className="crest-link" aria-label="Front Office home">
          <img src="/logo.svg" alt="" className="crest" />
        </Link>
        <div>
          <div className="league-name">{league ? league.name : 'Front Office'}</div>
          <div className="league-meta">
            {league ? `Visibility: ${league.visibility} · Franchise 27` : 'Connected Franchise 27 Hub'}
          </div>
        </div>
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={menuOpen}
          aria-controls="global-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">{menuOpen ? '×' : '☰'}</span>
          <span>Menu</span>
        </button>
        <nav id="global-navigation" className={`mast-nav${menuOpen ? ' is-open' : ''}`} aria-label="Global">
          <Link
            href="/leagues/open"
            className="nav-link"
            aria-current={location === '/leagues/open' ? 'page' : undefined}
          >
            Open Leagues
          </Link>
          <Link href="/" className="nav-link" aria-current={location === '/' ? 'page' : undefined}>
            Hub
          </Link>
          {league && (
            <Link
              href={`/leagues/${league.id}/schedule`}
              className="nav-link"
              aria-current={location === `/leagues/${league.id}/schedule` ? 'page' : undefined}
            >
              Schedule
            </Link>
          )}
          {league && (
            <Link
              href={`/leagues/${league.id}/availability`}
              className="nav-link"
              aria-current={location === `/leagues/${league.id}/availability` ? 'page' : undefined}
            >
              Availability
            </Link>
          )}
          {league && (
            <Link
              href={`/leagues/${league.id}/manage`}
              className="nav-link"
              aria-current={location === `/leagues/${league.id}/manage` ? 'page' : undefined}
            >
              Manage
            </Link>
          )}
          {isLoaded && isSignedIn ? (
            <>
              <Link
                href="/notifications"
                className="nav-link"
                aria-current={location === '/notifications' ? 'page' : undefined}
                data-testid="link-notifications"
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                Inbox
                {unreadCount > 0 && (
                  <span
                    data-testid="status-notification-unread-count"
                    aria-label={`${unreadCount} unread notifications`}
                    style={{ background: 'var(--goal)', color: '#fff', fontSize: '9px', padding: '2px 5px', borderRadius: '10px', lineHeight: 1, fontWeight: 700 }}
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Link>
              <Link
                href="/profile"
                className="nav-link"
                aria-current={location === '/profile' ? 'page' : undefined}
                data-testid="link-profile"
              >
                Profile
              </Link>
              <button className="nav-link" onClick={() => signOut({ redirectUrl: '/' })} data-testid="button-sign-out">Sign out</button>
            </>
          ) : (
            <Link
              href={`/sign-in?redirect_url=${encodeURIComponent(location)}`}
              className="nav-link"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
