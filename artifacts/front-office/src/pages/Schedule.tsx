/**
 * Schedule page — /leagues/:id/schedule
 *
 * Commissioner view: generate a balanced schedule, inspect week windows,
 * and take game-level actions (shift window, postpone, force-resolve).
 *
 * Non-commissioner GMs see their own week windows read-only.
 */
import React, { useState } from 'react';
import { useParams, Link } from 'wouter';
import {
  useGetLeague,
  useListSeasons,
  useListWeeks,
  useListGames,
  useGenerateSchedule,
  useUpdateSeason,
  useGetLeagueSettings,
  useListLeagueSettingsHistory,
  type Game,
  type LeagueSettingsVersion,
  type Season,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import Header from '@/components/Header';
import { gmIdentityLabel } from '@/components/gmIdentity';
import LeagueSettings, { hasSettings } from '@/components/LeagueSettings';
import { toast, confirmToast } from '@/hooks/use-toast';

// ─────────────────────────────────────── status chip colour map
const STATUS_CHIP: Record<string, string> = {
  scheduled: 'man',
  in_window: 'ea',
  reported:  'ocr',
  confirmed: 'conf',
  disputed:  'dispute',
  forfeited: 'ocr',
  postponed: 'man',
  voided:    'man',
};

type ExtendedGameSide = Game['home'] & {
  gm_primary_identity?: string | null;
  gm_platform?: string | null;
  gm_gamertag?: string | null;
};

function GameSideLabel({ side, fallback }: { side: ExtendedGameSide; fallback: string }) {
  const club = side.club_abbrev ?? side.franchise_name ?? fallback;
  const identity = gmIdentityLabel(side);
  return (
    <span className="schedule-game-side">
      <strong>{club}</strong>
      {(side.gm_display_name || identity) && (
        <small>
          {side.gm_display_name ?? 'GM'}{identity ? ` · ${identity}` : ''}
        </small>
      )}
    </span>
  );
}

export function SeasonGamesList({ games, isLoading }: { games: Game[]; isLoading: boolean }) {
  if (isLoading) {
    return <div className="schedule-games-status" role="status">Loading games…</div>;
  }
  if (games.length === 0) return null;

  return (
    <section className="panel schedule-games" aria-labelledby="season-games-heading">
      <div className="panel-head">
        <h2 id="season-games-heading">Season Games</h2>
        <span className="note">{games.length} matchup{games.length === 1 ? '' : 's'}</span>
      </div>
      <div className="schedule-games-list">
        {games.map((game) => (
          <div key={game.id} className="schedule-game" data-testid={`schedule-game-${game.id}`}>
            <GameSideLabel side={game.away as ExtendedGameSide} fallback="Away" />
            <span className="schedule-game-at" aria-label="at">@</span>
            <GameSideLabel side={game.home as ExtendedGameSide} fallback="Home" />
            <span className={`chip ${STATUS_CHIP[game.status] ?? 'man'}`}>{game.status.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────── Week row
function WeekRow({ week, isCommissioner, leagueId }: {
  week: {
    week_number: number;
    window_opens_at: string;
    window_closes_at: string;
    games: {
      total: number; scheduled: number; in_window: number; reported: number;
      confirmed: number; disputed: number; forfeited: number; postponed: number; voided: number;
    };
  };
  isCommissioner: boolean;
  leagueId: string;
}) {
  const opens  = new Date(week.window_opens_at);
  const closes = new Date(week.window_closes_at);
  const now    = new Date();
  const past   = closes < now;
  const active = opens <= now && closes > now;

  const counts = week.games;
  const unresolved = counts.scheduled + counts.in_window + counts.reported + counts.disputed;

  return (
    <div className="matchup" style={{ flexWrap: 'wrap', gap: '8px', alignItems: 'flex-start', padding: '14px 16px' }}>
      <div style={{ minWidth: '72px' }}>
        <div style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
          Week
        </div>
        <div style={{ fontFamily: 'var(--display)', fontSize: '22px', lineHeight: 1 }}>
          {week.week_number}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: '160px' }}>
        <div style={{ fontSize: '12px', fontFamily: 'var(--data)' }}>
          {opens.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          {' – '}
          {closes.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
          {counts.confirmed > 0 && <span className="chip conf" style={{ fontSize: '10px' }}>{counts.confirmed} confirmed</span>}
          {counts.reported  > 0 && <span className="chip ocr"  style={{ fontSize: '10px' }}>{counts.reported} reported</span>}
          {counts.disputed  > 0 && <span className="chip dispute" style={{ fontSize: '10px' }}>{counts.disputed} disputed</span>}
          {counts.scheduled > 0 && <span className="chip man"  style={{ fontSize: '10px' }}>{counts.scheduled} scheduled</span>}
          {counts.in_window > 0 && <span className="chip ea"   style={{ fontSize: '10px' }}>{counts.in_window} in window</span>}
          {counts.postponed > 0 && <span className="chip man"  style={{ fontSize: '10px' }}>{counts.postponed} postponed</span>}
          {counts.forfeited > 0 && <span className="chip ocr"  style={{ fontSize: '10px' }}>{counts.forfeited} forfeited</span>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {active && (
          <span className="chip ea" style={{ fontSize: '10px' }}>Live</span>
        )}
        {past && unresolved > 0 && (
          <span className="chip dispute" style={{ fontSize: '10px' }}>{unresolved} unresolved</span>
        )}
        <div style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)' }}>
          {counts.total} games
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────── Generate schedule form
function GenerateScheduleForm({
  seasonId,
  seasonStartsOn,
  settings,
  onSuccess,
}: { seasonId: string; seasonStartsOn?: string | null; settings: LeagueSettingsVersion; onSuccess: () => void }) {
  const [startDate, setStartDate] = useState(
    seasonStartsOn
      ? seasonStartsOn.slice(0, 10)
      : new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  );
  const [weekDurationDays, setWeekDurationDays] = useState(
    Number(settings.schedule_settings.week_duration_days ?? 7)
  );
  const [error, setError] = useState<string | null>(null);
  const generate = useGenerateSchedule();

  const handleGenerate = async () => {
    setError(null);
    const ok = await confirmToast(
      `• Season starts: ${startDate}\n` +
      `• Format: ${settings.schedule_format.replaceAll('_', ' ')}\n` +
      `• Window duration: ${weekDurationDays} days\n\n` +
      `This cannot be undone.`,
      { title: "Generate this season's schedule from active league settings?", confirmLabel: 'Generate' },
    );
    if (!ok) return;

    generate.mutate(
      {
        seasonId,
        data: { start_date: startDate, week_duration_days: weekDurationDays },
      },
      {
        onSuccess: () => onSuccess(),
        onError: (err: unknown) => {
          setError(err instanceof Error ? err.message : 'Failed to generate schedule');
        },
      }
    );
  };

  return (
    <div className="panel" style={{ maxWidth: '560px', margin: '0 auto' }}>
      <div className="panel-head">
        <h2>Generate Schedule</h2>
      </div>
      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={{ fontFamily: 'var(--data)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--steel)', display: 'block', marginBottom: '6px' }}>
            Season Start Date
          </label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            style={{ fontFamily: 'var(--data)', fontSize: '13px', padding: '8px 10px', border: '1px solid var(--rule)', borderRadius: '3px', width: '100%', boxSizing: 'border-box' }}
          />
        </div>
        <div>
          <label style={{ fontFamily: 'var(--data)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--steel)', display: 'block', marginBottom: '6px' }}>
            Week Length Override (days)
          </label>
          <input
            type="number"
            min={1}
            max={31}
            value={weekDurationDays}
            onChange={e => setWeekDurationDays(Number(e.target.value))}
            style={{ fontFamily: 'var(--data)', fontSize: '13px', padding: '8px 10px', border: '1px solid var(--rule)', borderRadius: '3px', width: '100%', boxSizing: 'border-box' }}
          />
          <small style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '10.5px' }}>
            Defaults to the active settings value ({String(settings.schedule_settings.week_duration_days ?? 7)} days) — change it for this generation only.
          </small>
        </div>
        <div style={{ padding: '12px', border: '1px solid var(--rule)', borderRadius: '3px', background: '#FAFCFD', fontFamily: 'var(--data)', fontSize: '11px', lineHeight: 1.7 }}>
          <strong>Active settings · version {settings.version}</strong><br />
          {settings.schedule_format.replaceAll('_', ' ')} · {String(settings.schedule_settings.games_per_matchup ?? 1)} game(s) per matchup · {weekDurationDays} day weeks
          <div style={{ color: 'var(--steel)' }}>Authoritative schedule values are managed in League Settings.</div>
        </div>
        {error && (
          <div style={{ background: '#FCF2F0', border: '1px solid #E5B8B1', borderRadius: '3px', padding: '10px 14px', fontFamily: 'var(--data)', fontSize: '12px', color: 'var(--goal)' }}>
            {error}
          </div>
        )}
        <button
          className="btn"
          onClick={handleGenerate}
          disabled={generate.isPending}
          style={{ alignSelf: 'flex-start' }}
        >
          {generate.isPending ? 'Generating…' : 'Generate Schedule'}
        </button>
        <div style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)', lineHeight: 1.6 }}>
          Schedule structure is generated from the league's active immutable settings version.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────── Season start date pill
function SeasonStartDatePill({ leagueId, season, isCommissioner }: {
  leagueId: string;
  season: Season;
  isCommissioner: boolean;
}) {
  const queryClient = useQueryClient();
  const updateSeason = useUpdateSeason();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const locked = Boolean(season.starts_on_locked);
  const canEdit = isCommissioner && !locked;

  const handleEdit = () => {
    if (!canEdit) return;
    setValue(season.starts_on ? season.starts_on.slice(0, 10) : '');
    setEditing(true);
  };

  const handleSave = () => {
    updateSeason.mutate(
      { leagueId, seasonId: season.id, data: { starts_on: value || null } },
      {
        onSuccess: () => {
          setEditing(false);
          queryClient.invalidateQueries({ queryKey: [`/api/leagues/${leagueId}/seasons`] as any });
          // The backend shifts every already-generated game window by the
          // same delta when both the old and new dates are set — bust the
          // schedule caches too so that shows up without a refresh.
          queryClient.invalidateQueries({ queryKey: [`/api/seasons/${season.id}/weeks`] as any });
          queryClient.invalidateQueries({ queryKey: [`/api/seasons/${season.id}/games`] as any });
        },
        onError: (err: unknown) => toast({ variant: 'destructive', title: 'Failed to update start date', description: err instanceof Error ? err.message : undefined }),
      }
    );
  };

  if (editing) {
    return (
      <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
        <input
          type="date"
          value={value}
          onChange={e => setValue(e.target.value)}
          style={{ fontFamily: 'var(--data)', fontSize: '11px', padding: '4px 8px', border: '1px solid var(--rule)', borderRadius: '3px' }}
        />
        <button className="btn" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={handleSave} disabled={updateSeason.isPending}>
          {updateSeason.isPending ? 'Saving…' : 'Save'}
        </button>
        <button className="btn ghost" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={() => setEditing(false)} disabled={updateSeason.isPending}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <span
      className="chip man"
      style={{ fontSize: '10.5px', display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: canEdit ? 'pointer' : 'default' }}
      onClick={handleEdit}
      title={locked ? 'Locked — this season already has played games' : canEdit ? 'Click to edit' : undefined}
      data-testid="pill-season-start-date"
    >
      {season.starts_on
        ? `Starts ${new Date(season.starts_on).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
        : 'No start date set'}
      {canEdit && <span aria-hidden="true" style={{ opacity: .6 }}>✎</span>}
      {locked && <span aria-hidden="true" title="Locked" style={{ opacity: .6 }}>🔒</span>}
    </span>
  );
}

// ─────────────────────────────────────── Schedule tab content
function ScheduleContent({
  leagueId,
  isCommissioner,
}: { leagueId: string; isCommissioner: boolean }) {
  const { data: seasonsData, isLoading: seasonsLoading } = useListSeasons(leagueId);
  const { data: settingsResponse } = useGetLeagueSettings(leagueId);
  const settings = hasSettings(settingsResponse) ? settingsResponse : undefined;
  const { data: settingsHistory } = useListLeagueSettingsHistory(leagueId);
  const seasons = seasonsData?.data ?? [];
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const qc = useQueryClient();

  // Pick the first season by default once loaded
  React.useEffect(() => {
    if (!selectedSeasonId && seasons.length > 0 && seasons[0]) {
      setSelectedSeasonId(seasons[0].id);
    }
  }, [seasons, selectedSeasonId]);

  const activeSeason = seasons.find(s => s.id === selectedSeasonId) ?? seasons[0] ?? null;
  const seasonSettings = settingsHistory?.data.find(
    version => version.id === activeSeason?.settings_version_id,
  ) ?? settings;

  const { data: weeksData, isLoading: weeksLoading } = useListWeeks(
    activeSeason?.id ?? '',
    { query: { enabled: !!activeSeason?.id } as any }
  );
  const weeks = (weeksData as any)?.data ?? [];
  const { data: gamesData, isLoading: gamesLoading } = useListGames(
    activeSeason?.id ?? '',
    { limit: 200 },
    { query: { enabled: !!activeSeason?.id } as any },
  );
  const games = gamesData?.data ?? [];

  if (seasonsLoading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>Loading seasons…</div>;
  }

  if (seasons.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: 0 }}>
        <h2>No Season Yet</h2>
        <p style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px', marginTop: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
          Create a season before generating a schedule.
        </p>
        <div style={{ marginTop: '20px' }}>
          <Link href={`/leagues/${leagueId}/season/new`} className="btn">New Season</Link>
        </div>
      </div>
    );
  }

  const noSchedule = !weeksLoading && weeks.length === 0;

  return (
    <div>
      {/* Season selector + start date */}
      {(seasons.length > 1 || activeSeason) && (
        <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {seasons.length > 1 && (
            <>
              <span style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Season:</span>
              {seasons.map(s => (
                <button
                  key={s.id}
                  className={`btn ${s.id === selectedSeasonId ? '' : 'ghost'}`}
                  onClick={() => setSelectedSeasonId(s.id)}
                  style={{ fontSize: '12px', padding: '5px 12px' }}
                >
                  {s.label || s.id.slice(0, 8)}
                </button>
              ))}
            </>
          )}
          {activeSeason && (
            <SeasonStartDatePill leagueId={leagueId} season={activeSeason} isCommissioner={isCommissioner} />
          )}
        </div>
      )}

      {/* Generate schedule if empty */}
      {noSchedule && isCommissioner && activeSeason && seasonSettings && (
        <GenerateScheduleForm
          seasonId={activeSeason.id}
          seasonStartsOn={activeSeason.starts_on}
          settings={seasonSettings}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: [`/api/seasons/${activeSeason.id}/weeks`] as any });
            qc.invalidateQueries({ queryKey: [`/api/seasons/${activeSeason.id}/games`] });
          }}
        />
      )}

      {noSchedule && !isCommissioner && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>
          No schedule generated yet. The commissioner will publish it soon.
        </div>
      )}
      {noSchedule && isCommissioner && activeSeason && !settings && (
        <div className="panel" style={{ padding: '20px', color: 'var(--goal)' }}>
          Active league settings are required before generating a schedule.
        </div>
      )}

      {/* Week window list */}
      {weeks.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>Week Windows</h2>
            <span className="note">{weeks.length} weeks · {weeks.reduce((s: number, w: any) => s + w.games.total, 0)} games</span>
          </div>
          {weeks.map((week: any) => (
            <WeekRow
              key={week.week_number}
              week={week}
              isCommissioner={isCommissioner}
              leagueId={leagueId}
            />
          ))}
        </div>
      )}

      <SeasonGamesList games={games} isLoading={gamesLoading} />

      {weeksLoading && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>
          Loading schedule…
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────── Page
export default function Schedule() {
  const { id: leagueId } = useParams<{ id: string }>();
  const { data: league, isLoading } = useGetLeague(leagueId ?? '');
  const { data: settingsResponse } = useGetLeagueSettings(leagueId ?? '');
  const settings = hasSettings(settingsResponse) ? settingsResponse : undefined;

  if (isLoading) return <div className="loading-screen">Loading…</div>;
  if (!league)   return <div className="loading-screen">League not found.</div>;

  const isCommissioner = Boolean(settings?.can_manage);

  return (
    <>
      <Header league={league} />
      <div className="slab">
        <div className="wrap" style={{ padding: '30px 20px', display: 'block' }}>
          <div className="eyebrow">
            <Link href={`/leagues/${leagueId}/manage`} style={{ color: 'var(--bulb)', textDecoration: 'none' }}>
              ← Back to Operations
            </Link>
          </div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: '42px', marginTop: '8px', textTransform: 'uppercase', letterSpacing: '.02em' }}>
            Schedule
          </h1>
        </div>
      </div>
      <div className="wrap" style={{ paddingTop: '24px', paddingBottom: '60px' }}>
        <ScheduleContent leagueId={leagueId ?? ''} isCommissioner={isCommissioner} />
        <div style={{ marginTop: '24px' }}>
          <LeagueSettings leagueId={leagueId ?? ''} />
        </div>
      </div>
    </>
  );
}
