import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth, useClerk } from '@clerk/react';
import type { League } from '@workspace/api-client-react';

export default function Header({ league }: { league?: League }) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();

  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  return (
    <header className="masthead">
      <div className="wrap">
        <Link href="/" className="crest-link" aria-label="Front Office home">
          <img src="/logo.svg" alt="" className="crest" />
        </Link>
        <div className="masthead-identity">
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
              href={`/leagues/${league.id}/transactions`}
              className="nav-link"
              aria-current={location === `/leagues/${league.id}/transactions` ? 'page' : undefined}
            >
              Transactions
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
