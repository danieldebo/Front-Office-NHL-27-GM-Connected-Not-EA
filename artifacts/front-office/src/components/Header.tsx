import { Link } from 'wouter';
import { League, useGetCurrentAuthUser } from '@workspace/api-client-react';

export default function Header({ league }: { league?: League }) {
  const { data: userResponse } = useGetCurrentAuthUser();
  const user = userResponse?.user;
  const isOwner = user && league && user.id === league.owner_user_id;

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
        <nav>
          <Link href="/" className="nav-link" aria-current="page">Hub</Link>
          {league && <a href="#standings">Standings</a>}
          {league && <a href="#">Schedule</a>}
          {league && <a href="#wire">Wire</a>}
          {league && <a href="#">Front Office</a>}
          {league && <a href="#">Rulebook</a>}
          {isOwner && (
            <Link href={`/leagues/${league.id}/manage`} className="nav-link" style={{ color: 'var(--goal)' }}>
              Manage
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
