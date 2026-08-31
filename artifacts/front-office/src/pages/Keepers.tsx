import React, { useState } from 'react';
import { useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetLeague,
  useGetLeagueHub,
  useGetLeagueSettings,
  useGetMyProfile,
  useListSeats,
  useListKeepers,
  useCreateKeeper,
  useReleaseKeeper,
  useSetKeeperSettings,
  useSearchPlayers,
  useGetPlayerStatCards,
  useRunRegistrySyncNow,
  getListKeepersQueryKey,
} from '@workspace/api-client-react';
import Header from '@/components/Header';

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  border: '1px solid var(--rule)',
  borderRadius: '3px',
  fontFamily: 'var(--data)',
  fontSize: '12px',
  background: '#fff',
};

function StatCards({ playerId }: { playerId: string }) {
  const { data } = useGetPlayerStatCards(playerId, { query: { refetchInterval: 15_000 } as any });
  if (!data || !data.registry_matched) return null;
  if (data.data.length === 0) {
    return <small style={{ color: 'var(--steel)' }}>{data.refreshing ? 'Fetching NHL stats…' : 'No NHL stats found.'}</small>;
  }
  return (
    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '6px' }}>
      {data.data.map(card => (
        <div key={card.window_years} style={{ border: '1px solid var(--rule)', borderRadius: '3px', padding: '8px 10px', fontFamily: 'var(--data)', fontSize: '11px', minWidth: '160px' }}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>Last {card.window_years} season{card.window_years === 1 ? '' : 's'} {card.season_span ? `(${card.season_span})` : ''}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', color: 'var(--steel)' }}>
            {Object.entries(card.stat_line).map(([k, v]) => <span key={k}>{k}: {String(v)}</span>)}
          </div>
          <div style={{ color: 'var(--steel)', marginTop: '4px' }}>NHL stats as of {new Date(card.fetched_at).toLocaleDateString()}</div>
        </div>
      ))}
    </div>
  );
}

export default function Keepers() {
  const { id: leagueId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: league } = useGetLeague(leagueId || '');
  const { data: hub } = useGetLeagueHub(leagueId || '');
  const { data: settingsResponse } = useGetLeagueSettings(leagueId || '');
  const canManage = Boolean((settingsResponse as { can_manage?: boolean } | undefined)?.can_manage);
  const { data: profile } = useGetMyProfile();
  const { data: seatsResponse } = useListSeats(leagueId || '', { query: { enabled: Boolean(leagueId) } as any });
  const seats = seatsResponse?.data ?? [];
  const myTeam = seats.find(s => s.gm?.user_id === profile?.id);

  const seasonId = hub?.active_season_id ?? undefined;
  const [selectedFranchiseId, setSelectedFranchiseId] = useState<string | undefined>(undefined);
  const franchiseId = selectedFranchiseId ?? myTeam?.franchise_id ?? seats[0]?.franchise_id;
  const isOwnTeam = franchiseId === myTeam?.franchise_id;

  const { data: keepersResponse } = useListKeepers(franchiseId || '', seasonId || '', { query: { enabled: Boolean(franchiseId && seasonId) } as any });
  const keepers = keepersResponse?.data ?? [];
  const slots = keepersResponse?.slots;

  const createKeeper = useCreateKeeper();
  const releaseKeeper = useReleaseKeeper();
  const setKeeperSettings = useSetKeeperSettings();
  const runSync = useRunRegistrySyncNow();

  const [message, setMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [overrideNote, setOverrideNote] = useState('');
  const { data: searchResults } = useSearchPlayers({ q: searchQuery }, { query: { enabled: searchQuery.trim().length >= 2 } as any });
  const [manualName, setManualName] = useState('');
  const [manualPosition, setManualPosition] = useState('C');

  const [keepersPerTeamInput, setKeepersPerTeamInput] = useState('');
  const [deadlineInput, setDeadlineInput] = useState('');

  const invalidateKeepers = async () => {
    if (!franchiseId || !seasonId) return;
    await queryClient.invalidateQueries({ queryKey: getListKeepersQueryKey(franchiseId, seasonId) });
  };

  const addKeeper = (playerId: string) => {
    if (!franchiseId || !seasonId) return;
    createKeeper.mutate({
      franchiseId, seasonId,
      data: { player_id: playerId, note: isOwnTeam ? undefined : (overrideNote.trim() || undefined) },
    }, {
      onSuccess: async () => {
        setSearchQuery('');
        setOverrideNote('');
        setMessage('Keeper designated.');
        await invalidateKeepers();
      },
      onError: err => setMessage(err instanceof Error ? err.message : 'Unable to designate that keeper.'),
    });
  };

  if (!leagueId) return null;

  return (
    <>
      <Header league={league} />
      <div className="wrap" style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '30px 20px' }}>
        <h1 style={{ fontSize: '22px', margin: 0 }}>Keepers</h1>
        {message && <div role="status" style={{ fontFamily: 'var(--data)', fontSize: '12px', color: '#1F7A4C' }}>{message}</div>}
        {!seasonId && <div className="panel" style={{ padding: '20px', color: 'var(--steel)' }}>No active season.</div>}

        {seasonId && (
          <>
            {seats.length > 1 && (
              <div>
                <label style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>Viewing team</label>
                <select style={{ ...inputStyle, maxWidth: '260px' }} value={franchiseId ?? ''} onChange={e => setSelectedFranchiseId(e.target.value)}>
                  {seats.map(s => <option key={s.franchise_id} value={s.franchise_id}>{s.club_abbrev || s.franchise_name}</option>)}
                </select>
              </div>
            )}

            {canManage && (
              <section className="panel">
                <div className="panel-head"><h2>Keeper rules</h2></div>
                <form
                  style={{ padding: '14px 16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}
                  onSubmit={e => {
                    e.preventDefault();
                    setKeeperSettings.mutate({
                      leagueId, seasonId,
                      data: {
                        keepers_per_team: keepersPerTeamInput ? Number(keepersPerTeamInput) : undefined,
                        keeper_deadline_at: deadlineInput ? new Date(deadlineInput).toISOString() : (deadlineInput === '' ? undefined : null),
                      },
                    }, {
                      onSuccess: async () => { setMessage('Keeper settings updated.'); await invalidateKeepers(); },
                    });
                  }}
                >
                  <div>
                    <label style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>Keepers per team (0 = off)</label>
                    <input style={inputStyle} type="number" min={0} max={50} placeholder={String(slots?.allowed ?? 0)} value={keepersPerTeamInput} onChange={e => setKeepersPerTeamInput(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>Deadline</label>
                    <input style={inputStyle} type="datetime-local" value={deadlineInput} onChange={e => setDeadlineInput(e.target.value)} />
                  </div>
                  <button className="btn" type="submit" disabled={setKeeperSettings.isPending}>Save</button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => runSync.mutate(undefined, {
                      onSuccess: () => setMessage('Player registry sync queued.'),
                      onError: err => setMessage(err instanceof Error ? err.message : 'A sync is already pending.'),
                    })}
                  >
                    Sync player registry
                  </button>
                </form>
              </section>
            )}

            <section className="panel">
              <div className="panel-head">
                <h2>Current keepers</h2>
                <span className="note">{slots ? `${slots.used} / ${slots.allowed}` : '—'}</span>
              </div>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {keepers.length === 0 && <small style={{ color: 'var(--steel)' }}>No keepers designated yet.</small>}
                {keepers.map(k => (
                  <div key={k.player_id} style={{ borderBottom: '1px solid var(--rule)', paddingBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'var(--data)', fontSize: '12px' }}>
                      <span>
                        <strong>{k.full_name}</strong> ({k.position}) · kept {k.seasons_kept} season{k.seasons_kept === 1 ? '' : 's'}
                        {k.is_commissioner_override && ' · commissioner override'}
                        {k.is_manual && !k.registry_matched && ' · manual entry'}
                      </span>
                      {(isOwnTeam || canManage) && (
                        <button
                          className="btn ghost"
                          onClick={() => {
                            const reason = isOwnTeam ? '' : prompt('Reason for releasing this keeper (required for a commissioner override):') ?? '';
                            if (!isOwnTeam && !reason.trim()) return;
                            releaseKeeper.mutate({ keeperId: k.id, params: reason ? { reason } : undefined }, {
                              onSuccess: async () => { setMessage(`${k.full_name} released.`); await invalidateKeepers(); },
                              onError: err => setMessage(err instanceof Error ? err.message : 'Unable to release that keeper.'),
                            });
                          }}
                        >
                          Release
                        </button>
                      )}
                    </div>
                    {k.registry_matched && <StatCards playerId={k.player_id} />}
                  </div>
                ))}
              </div>
            </section>

            {(isOwnTeam || canManage) && (
              <section className="panel">
                <div className="panel-head"><h2>Add a keeper</h2></div>
                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>Search the player registry</label>
                    <input style={inputStyle} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Start typing a name…" />
                    {searchResults && searchResults.data.length > 0 && (
                      <div style={{ border: '1px solid var(--rule)', borderRadius: '3px', marginTop: '6px', background: '#fff' }}>
                        {searchResults.data.map(p => (
                          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--rule)', fontFamily: 'var(--data)', fontSize: '12px' }}>
                            <span>{p.full_name} ({p.position}){p.current_team_abbrev ? ` — ${p.current_team_abbrev}` : ''}{!p.registry_matched && ' · manual'}</span>
                            <button className="btn ghost" onClick={() => addKeeper(p.id)}>Add</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {searchQuery.trim().length >= 2 && searchResults && searchResults.data.length === 0 && (
                      <small style={{ color: 'var(--steel)' }}>No matches — enter manually below.</small>
                    )}
                  </div>
                  {!isOwnTeam && (
                    <div>
                      <label style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>Override note (required)</label>
                      <input style={inputStyle} value={overrideNote} onChange={e => setOverrideNote(e.target.value)} placeholder="Why is the commissioner making this change?" />
                    </div>
                  )}
                  <details>
                    <summary style={{ cursor: 'pointer', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)' }}>None of these — add manually</summary>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '8px', alignItems: 'flex-end' }}>
                      <div style={{ flex: '1 1 200px' }}>
                        <label style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>Full name</label>
                        <input style={inputStyle} value={manualName} onChange={e => setManualName(e.target.value)} placeholder="First Last" />
                      </div>
                      <div>
                        <label style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>Position</label>
                        <select style={inputStyle} value={manualPosition} onChange={e => setManualPosition(e.target.value)}>
                          {['C', 'LW', 'RW', 'D', 'G'].map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <button
                        className="btn"
                        type="button"
                        disabled={!manualName.trim()}
                        onClick={async () => {
                          const res = await fetch(`/api/leagues/${leagueId}/players`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ full_name: manualName.trim(), position: manualPosition }),
                          });
                          if (!res.ok) { setMessage('Only the commissioner can add a manual player.'); return; }
                          const player = await res.json();
                          setManualName('');
                          addKeeper(player.id);
                        }}
                      >
                        Add manually
                      </button>
                    </div>
                  </details>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
