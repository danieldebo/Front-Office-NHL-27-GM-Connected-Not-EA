import { League } from '@workspace/api-client-react';

export default function Header({ league }: { league?: League }) {
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
          <a href="#" aria-current="page">Hub</a>
          <a href="#standings">Standings</a>
          <a href="#">Schedule</a>
          <a href="#wire">Wire</a>
          <a href="#">Front Office</a>
          <a href="#">Rulebook v1.2</a>
        </nav>
      </div>
    </header>
  );
}
