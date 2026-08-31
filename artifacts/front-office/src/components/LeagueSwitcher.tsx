/**
 * League switcher — for a user in more than one league, lets them jump
 * between them from anywhere a Header renders. Persists the choice so the
 * Hub (which has no :id in its URL) opens the same league next time.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useGetMyLeagues } from '@workspace/api-client-react';

export const ACTIVE_LEAGUE_STORAGE_KEY = 'fo_active_league_id';
const ACTIVE_LEAGUE_CHANGE_EVENT = 'fo:active-league-changed';

const CREATE_NEW_VALUE = '__create_new__';

function readStoredLeagueId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_LEAGUE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persists the choice and notifies same-tab listeners (a plain localStorage
 * write only fires the `storage` event in OTHER tabs). Hub has no :id in its
 * URL, so switching leagues while already on Hub can't rely on navigation —
 * a page that reads the active league reactively via useActiveLeagueId()
 * below picks this up immediately instead of needing a refresh. */
export function setActiveLeagueId(id: string): void {
  try {
    window.localStorage.setItem(ACTIVE_LEAGUE_STORAGE_KEY, id);
  } catch {
    // Private browsing / storage disabled — the in-page event below still
    // updates this tab; it just won't stick on the next visit.
  }
  window.dispatchEvent(new CustomEvent(ACTIVE_LEAGUE_CHANGE_EVENT, { detail: id }));
}

/** Reactive read of the stored active league id — updates in place when
 * setActiveLeagueId() is called anywhere (this tab) or storage changes in
 * another tab, so a page doesn't need to be remounted to pick up a switch. */
export function useActiveLeagueId(): string | null {
  const [id, setId] = useState<string | null>(readStoredLeagueId);

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setId(detail ?? readStoredLeagueId());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACTIVE_LEAGUE_STORAGE_KEY) setId(e.newValue);
    };
    window.addEventListener(ACTIVE_LEAGUE_CHANGE_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(ACTIVE_LEAGUE_CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return id;
}

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
        setActiveLeagueId(nextId);
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
