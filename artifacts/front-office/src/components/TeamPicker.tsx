/**
 * Shared "known team" picker — the full club catalog (32 current NHL clubs
 * plus a curated set of well-known SHL, DEL, Liiga and ECHL clubs), grouped
 * by league. Used both by the commissioner's team Add/Remove/Rename UI on
 * the Seats tab and by a GM's Favorite Team profile field, so both surfaces
 * always offer exactly the same set of teams.
 */
import { useListClubs, type Club } from '@workspace/api-client-react';

const LEAGUE_LABELS: Record<string, string> = {
  NHL: 'NHL',
  SHL: 'SHL (Sweden)',
  DEL: 'DEL (Germany)',
  LIIGA: 'Liiga (Finland)',
  ECHL: 'ECHL',
};

const LEAGUE_ORDER = ['NHL', 'SHL', 'DEL', 'LIIGA', 'ECHL'];

export function groupClubsByLeague(clubs: Club[]): Array<{ league: string; label: string; clubs: Club[] }> {
  const byLeague = new Map<string, Club[]>();
  for (const club of clubs) {
    const list = byLeague.get(club.league_source) ?? [];
    list.push(club);
    byLeague.set(club.league_source, list);
  }
  return LEAGUE_ORDER
    .filter(league => byLeague.has(league))
    .map(league => ({
      league,
      label: LEAGUE_LABELS[league] ?? league,
      clubs: byLeague.get(league)!,
    }));
}

interface TeamPickerProps {
  value: string | null;
  onChange: (clubId: string | null) => void;
  /** Renders a leading "— None —" option so the field can be cleared. */
  allowNone?: boolean;
  noneLabel?: string;
  /** Club ids to grey out (e.g. clubs already used elsewhere in this season). */
  disabledClubIds?: string[];
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}

export default function TeamPicker({
  value,
  onChange,
  allowNone = false,
  noneLabel = '— None —',
  disabledClubIds,
  disabled,
  id,
  'aria-label': ariaLabel,
}: TeamPickerProps) {
  const { data, isLoading } = useListClubs();
  const clubs = data?.data ?? [];
  const groups = groupClubsByLeague(clubs);
  const disabledSet = new Set(disabledClubIds ?? []);

  return (
    <select
      id={id}
      aria-label={ariaLabel}
      className="input"
      value={value ?? ''}
      disabled={disabled || isLoading}
      onChange={e => onChange(e.target.value || null)}
      style={{ fontFamily: 'var(--data)', fontSize: '13px' }}
    >
      {(allowNone || !value) && <option value="">{isLoading ? 'Loading…' : noneLabel}</option>}
      {groups.map(group => (
        <optgroup key={group.league} label={group.label}>
          {group.clubs.map(club => (
            <option key={club.id} value={club.id} disabled={disabledSet.has(club.id)}>
              {club.abbrev} — {club.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
