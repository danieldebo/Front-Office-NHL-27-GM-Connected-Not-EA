/**
 * League switcher — for a user in more than one league, lets them jump
 * between them from anywhere a Header renders. Persists the choice so the
 * Hub (which has no :id in its URL) opens the same league next time.
 */
import { useLocation } from 'wouter';
import { useGetMyLeagues } from '@workspace/api-client-react';

export const ACTIVE_LEAGUE_STORAGE_KEY = 'fo_active_league_id';

const CREATE_NEW_VALUE = '__create_new__';

export default function LeagueSwitcher({ currentLeagueId }: { currentLeagueId: string }) {
  const { data } = useGetMyLeagues();
  const leagues = data?.data ?? [];
  const [location, setLocation] = useLocation();

  // Always rendered (even for a single league) so "+ Create League" stays
  // reachable — previously this returned null below 2 leagues, leaving no
  // way to start a second one once you already had exactly one.
  return (
    <select
      value={currentLeagueId}
      aria-label="Switch league"
      onChange={(e) => {
        const nextId = e.target.value;
        if (nextId === CREATE_NEW_VALUE) {
          setLocation('/leagues/new');
          return;
        }
        if (nextId === currentLeagueId) return;
        try {
          window.localStorage.setItem(ACTIVE_LEAGUE_STORAGE_KEY, nextId);
        } catch {
          // Private browsing / storage disabled — switching still works for
          // this page load, it just won't stick on the next visit to Hub.
        }
        const nextPath = location.includes(currentLeagueId)
          ? location.replace(currentLeagueId, nextId)
          : '/';
        setLocation(nextPath);
      }}
      style={{
        fontFamily: 'var(--data)',
        fontSize: '11px',
        letterSpacing: '.04em',
        background: 'transparent',
        color: 'inherit',
        border: '1px solid rgba(255,255,255,.25)',
        borderRadius: '3px',
        padding: '4px 8px',
        cursor: 'pointer',
        maxWidth: '160px',
      }}
    >
      {leagues.map((l) => (
        <option key={l.id} value={l.id} style={{ color: '#000' }}>
          {l.name}
        </option>
      ))}
      <option value={CREATE_NEW_VALUE} style={{ color: '#000', fontWeight: 600 }}>
        + Create League
      </option>
    </select>
  );
}
