import { Link, useLocation } from 'wouter';
import { useClerk } from '@clerk/react';
import { League } from '@workspace/api-client-react';

export default function Header({ league }: { league?: League }) {
  const [location] = useLocation();
  const { signOut } = useClerk();

  return (
    <header className="masthead">
      <div className="wrap">
        <div className="crest">{league ? league.name.substring(0, 2).toUpperCase() : 'FO'}</div>
        <div>
          <div className="league-name">{league ? league.name : 'Front Office'}</div>
          <div className="league-meta">
            {league ? `Visibility: ${league.visibility} · NHL 27` : 'NHL 27 Connected Franchise Hub'}
          </div>
        </div>
        <nav className="mast-nav">
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
          {league && <a href="#standings">Standings</a>}
          {league && <a href="#">Schedule</a>}
          {league && <a href="#wire">Wire</a>}
          {league && <a href="#">Front Office</a>}
          {league && <a href="#">Rulebook</a>}
          <button className="nav-link" onClick={() => signOut({ redirectUrl: '/' })}>Sign out</button>
        </nav>
      </div>
    </header>
  );
}
