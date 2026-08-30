import React, { useState } from 'react';
import { useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetLeague,
  useGetMyProfile,
  useListSeats,
  useListPlayers,
  useListWireTransactions,
  useListWaivers,
  useGetCapPosition,
  useProposeTrade,
  useAcceptTrade,
  useApproveTrade,
  useRejectTrade,
  useCreateSigning,
  useCreateRelease,
  useCreateWaiverClaim,
  useResolveWaiverNow,
  useCreatePlayer,
  getListWireTransactionsQueryKey,
  getListWaiversQueryKey,
  getListPlayersQueryKey,
  getGetCapPositionQueryKey,
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

function money(cents: number | null | undefined): string {
  if (cents == null) return 'None';
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

export default function Transactions() {
  const { id: leagueId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: league } = useGetLeague(leagueId || '');
  const { data: profile } = useGetMyProfile();
  const { data: seatsResponse } = useListSeats(leagueId || '', { query: { enabled: Boolean(leagueId) } as any });
  const seats = seatsResponse?.data ?? [];
  const myTeam = seats.find(s => s.gm?.user_id === profile?.id);
  const isCommissioner = league != null && profile != null; // server enforces the real check; this only toggles which forms render

  const { data: playersResponse } = useListPlayers(leagueId || '', undefined, { query: { enabled: Boolean(leagueId) } as any });
  const players = playersResponse?.data ?? [];
  const freeAgents = players.filter(p => !p.contract);

  const { data: wireResponse } = useListWireTransactions(leagueId || '', undefined, { query: { enabled: Boolean(leagueId) } as any });
  const wire = wireResponse?.data ?? [];

  const { data: waiversResponse } = useListWaivers(leagueId || '', { query: { enabled: Boolean(leagueId), refetchInterval: 30_000 } as any });
  const waivers = waiversResponse?.data ?? [];

  const { data: myCap } = useGetCapPosition(myTeam?.team_season_id || '', { query: { enabled: Boolean(myTeam) } as any });

  const invalidateAll = async () => {
    if (!leagueId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListWireTransactionsQueryKey(leagueId) }),
      queryClient.invalidateQueries({ queryKey: getListWaiversQueryKey(leagueId) }),
      queryClient.invalidateQueries({ queryKey: getListPlayersQueryKey(leagueId) }),
      ...(myTeam ? [queryClient.invalidateQueries({ queryKey: getGetCapPositionQueryKey(myTeam.team_season_id) })] : []),
    ]);
  };

  const [message, setMessage] = useState<string | null>(null);
  const announce = (text: string) => setMessage(text);

  // ── Add player (commissioner) ──────────────────────────────────────────
  const createPlayer = useCreatePlayer();
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerPosition, setNewPlayerPosition] = useState('C');

  // ── Sign ────────────────────────────────────────────────────────────────
  const createSigning = useCreateSigning();
  const [signPlayerId, setSignPlayerId] = useState('');
  const [signCapDollars, setSignCapDollars] = useState('');
  const [signYears, setSignYears] = useState('2');

  // ── Release ─────────────────────────────────────────────────────────────
  const createRelease = useCreateRelease();

  // ── Trade ───────────────────────────────────────────────────────────────
  const proposeTrade = useProposeTrade();
  const acceptTrade = useAcceptTrade();
  const approveTrade = useApproveTrade();
  const rejectTrade = useRejectTrade();
  const [counterpartyTeam, setCounterpartyTeam] = useState('');
  const [myPlayerIds, setMyPlayerIds] = useState<string[]>([]);
  const [theirPlayerIds, setTheirPlayerIds] = useState<string[]>([]);
  const [tradeResult, setTradeResult] = useState<Record<string, unknown> | null>(null);

  // ── Waiver claim / resolve ─────────────────────────────────────────────
  const createClaim = useCreateWaiverClaim();
  const resolveWaiver = useResolveWaiverNow();

  const myRosteredPlayers = players.filter(p => p.contract?.team_season_id === myTeam?.team_season_id);
  const theirTeam = seats.find(s => s.team_season_id === counterpartyTeam);
  const theirRosteredPlayers = players.filter(p => p.contract?.team_season_id === counterpartyTeam);

  if (!leagueId) return null;

  return (
    <>
      <Header league={league} />
      <div className="wrap" style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '30px 20px' }}>
        <h1 style={{ fontSize: '22px', margin: 0 }}>Transactions</h1>
        {message && <div role="status" style={{ fontFamily: 'var(--data)', fontSize: '12px', color: '#1F7A4C' }}>{message}</div>}

        {myTeam && myCap && (
          <section className="panel">
            <div className="panel-head"><h2>Your cap — {myTeam.club_abbrev || myTeam.franchise_name}</h2></div>
            <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', fontFamily: 'var(--data)', fontSize: '12px' }}>
              <div><strong>Cap hit</strong><br />{money(myCap.cap_used_cents)}</div>
              <div><strong>Space</strong><br />{money(myCap.cap_space_cents)}</div>
              <div><strong>Roster</strong><br />{myCap.roster_count}</div>
              <div><strong>Legal</strong><br />{myCap.is_illegal ? 'No — over limits' : 'Yes'}</div>
            </div>
          </section>
        )}

        {isCommissioner && (
          <section className="panel">
            <div className="panel-head"><h2>Add a free agent to the pool</h2><span className="note">Manual roster source</span></div>
            <form
              style={{ padding: '14px 16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}
              onSubmit={e => {
                e.preventDefault();
                createPlayer.mutate({ leagueId, data: { full_name: newPlayerName, position: newPlayerPosition as any } }, {
                  onSuccess: async () => {
                    setNewPlayerName('');
                    announce('Player added to the pool.');
                    await queryClient.invalidateQueries({ queryKey: getListPlayersQueryKey(leagueId) });
                  },
                });
              }}
            >
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>Full name</label>
                <input style={inputStyle} required value={newPlayerName} onChange={e => setNewPlayerName(e.target.value)} placeholder="First Last" />
              </div>
              <div>
                <label style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>Position</label>
                <select style={inputStyle} value={newPlayerPosition} onChange={e => setNewPlayerPosition(e.target.value)}>
                  {['C', 'LW', 'RW', 'D', 'G'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <button className="btn" type="submit" disabled={createPlayer.isPending}>Add player</button>
            </form>
          </section>
        )}

        {myTeam && (
          <section className="panel">
            <div className="panel-head"><h2>Sign a free agent</h2></div>
            <form
              style={{ padding: '14px 16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}
              onSubmit={e => {
                e.preventDefault();
                if (!signPlayerId) return;
                createSigning.mutate({
                  leagueId,
                  data: {
                    team_season_id: myTeam.team_season_id,
                    player_id: signPlayerId,
                    cap_hit_cents: Math.round(Number(signCapDollars || '0') * 100),
                    term_years: signYears ? Number(signYears) : undefined,
                  },
                }, {
                  onSuccess: async (res) => {
                    setSignPlayerId('');
                    setSignCapDollars('');
                    announce(res.over_cap_warning ? 'Signed — this puts the team over the salary cap.' : 'Player signed.');
                    await invalidateAll();
                  },
                  onError: err => announce(err instanceof Error ? err.message : 'Unable to sign that player.'),
                });
              }}
            >
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>Free agent</label>
                <select style={inputStyle} required value={signPlayerId} onChange={e => setSignPlayerId(e.target.value)}>
                  <option value="">Select a player…</option>
                  {freeAgents.map(p => <option key={p.id} value={p.id}>{p.full_name} ({p.position})</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>Cap hit ($/yr)</label>
                <input style={inputStyle} required type="number" min={0} step="0.01" value={signCapDollars} onChange={e => setSignCapDollars(e.target.value)} placeholder="1,500,000" />
              </div>
              <div>
                <label style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>Term (years)</label>
                <input style={inputStyle} type="number" min={1} max={8} value={signYears} onChange={e => setSignYears(e.target.value)} />
              </div>
              <button className="btn" type="submit" disabled={createSigning.isPending || freeAgents.length === 0}>Sign</button>
            </form>
          </section>
        )}

        {myTeam && (
          <section className="panel">
            <div className="panel-head"><h2>Propose a trade</h2></div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>Trade with</label>
                <select style={inputStyle} value={counterpartyTeam} onChange={e => { setCounterpartyTeam(e.target.value); setTheirPlayerIds([]); }}>
                  <option value="">Select a team…</option>
                  {seats.filter(s => s.team_season_id !== myTeam.team_season_id).map(s => (
                    <option key={s.team_season_id} value={s.team_season_id}>{s.club_abbrev || s.franchise_name}</option>
                  ))}
                </select>
              </div>
              {counterpartyTeam && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>Your players to send (up to 5)</label>
                    {myRosteredPlayers.map(p => (
                      <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '3px 0' }}>
                        <input
                          type="checkbox"
                          checked={myPlayerIds.includes(p.id)}
                          onChange={e => setMyPlayerIds(prev => e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id))}
                        />
                        {p.full_name} ({p.position})
                      </label>
                    ))}
                    {myRosteredPlayers.length === 0 && <small style={{ color: 'var(--steel)' }}>You have no rostered players.</small>}
                  </div>
                  <div>
                    <label style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>
                      {theirTeam?.club_abbrev || theirTeam?.franchise_name}'s players to receive (up to 5)
                    </label>
                    {theirRosteredPlayers.map(p => (
                      <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '3px 0' }}>
                        <input
                          type="checkbox"
                          checked={theirPlayerIds.includes(p.id)}
                          onChange={e => setTheirPlayerIds(prev => e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id))}
                        />
                        {p.full_name} ({p.position})
                      </label>
                    ))}
                    {theirRosteredPlayers.length === 0 && <small style={{ color: 'var(--steel)' }}>That team has no rostered players.</small>}
                  </div>
                </div>
              )}
              <button
                className="btn"
                style={{ alignSelf: 'flex-start' }}
                disabled={!counterpartyTeam || (myPlayerIds.length === 0 && theirPlayerIds.length === 0) || proposeTrade.isPending}
                onClick={() => {
                  proposeTrade.mutate({
                    leagueId,
                    data: {
                      side_a: { team_season_id: myTeam.team_season_id, player_ids: myPlayerIds },
                      side_b: { team_season_id: counterpartyTeam, player_ids: theirPlayerIds },
                    },
                  }, {
                    onSuccess: async (res) => {
                      setTradeResult(res as unknown as Record<string, unknown>);
                      setMyPlayerIds([]);
                      setTheirPlayerIds([]);
                      announce('Trade proposed. Waiting on the other GM to accept.');
                      await invalidateAll();
                    },
                    onError: err => announce(err instanceof Error ? err.message : 'Unable to propose that trade.'),
                  });
                }}
              >
                Propose trade
              </button>
              {tradeResult && (
                <pre style={{ fontFamily: 'var(--data)', fontSize: '11px', background: '#FAFCFD', padding: '10px', borderRadius: '3px', overflowX: 'auto' }}>
                  {JSON.stringify(tradeResult, null, 2)}
                </pre>
              )}
            </div>
          </section>
        )}

        <section className="panel">
          <div className="panel-head"><h2>Pending trades</h2></div>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {wire.filter(w => w.type === 'trade' && ['proposed', 'accepted'].includes(w.status)).length === 0 && (
              <small style={{ color: 'var(--steel)' }}>No pending trades.</small>
            )}
            {wire.filter(w => w.type === 'trade' && ['proposed', 'accepted'].includes(w.status)).map(w => (
              <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--rule)', paddingBottom: '8px', fontSize: '12px', fontFamily: 'var(--data)' }}>
                <span>{w.summary} — <em>{w.status}</em></span>
                <span style={{ display: 'flex', gap: '6px' }}>
                  {w.status === 'proposed' && (
                    <button className="btn ghost" onClick={() => acceptTrade.mutate({ leagueId, transactionId: w.id }, {
                      onSuccess: async () => { announce('Trade accepted.'); await invalidateAll(); },
                      onError: err => announce(err instanceof Error ? err.message : 'Unable to accept.'),
                    })}>Accept</button>
                  )}
                  {w.status === 'accepted' && isCommissioner && (
                    <button className="btn" onClick={() => approveTrade.mutate({ leagueId, transactionId: w.id }, {
                      onSuccess: async () => { announce('Trade approved and executed.'); await invalidateAll(); },
                      onError: err => announce(err instanceof Error ? err.message : 'Unable to approve.'),
                    })}>Approve</button>
                  )}
                  <button className="btn ghost" onClick={() => rejectTrade.mutate({ leagueId, transactionId: w.id, data: {} }, {
                    onSuccess: async () => { announce('Trade rejected.'); await invalidateAll(); },
                  })}>Reject</button>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Waivers</h2><span className="note">{waivers.length} open</span></div>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {waivers.length === 0 && <small style={{ color: 'var(--steel)' }}>No players on waivers.</small>}
            {waivers.map(w => (
              <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--rule)', paddingBottom: '8px', fontSize: '12px', fontFamily: 'var(--data)' }}>
                <span>{w.full_name} — clears {new Date(w.expires_at).toLocaleString()} · {w.claim_count} claim{w.claim_count === 1 ? '' : 's'}</span>
                <span style={{ display: 'flex', gap: '6px' }}>
                  {myTeam && w.waived_by_team_season_id !== myTeam.team_season_id && (
                    <button className="btn ghost" onClick={() => createClaim.mutate({ leagueId, waiverId: w.id, data: { team_season_id: myTeam.team_season_id } }, {
                      onSuccess: async () => { announce('Claim submitted.'); await invalidateAll(); },
                      onError: err => announce(err instanceof Error ? err.message : 'Unable to submit that claim.'),
                    })}>Claim</button>
                  )}
                  {isCommissioner && (
                    <button className="btn ghost" onClick={() => resolveWaiver.mutate({ leagueId, waiverId: w.id }, {
                      onSuccess: async () => { announce('Waiver resolved.'); await invalidateAll(); },
                    })}>Resolve now</button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>

        {myRosteredPlayers.length > 0 && (
          <section className="panel">
            <div className="panel-head"><h2>Release a player</h2><span className="note">Opens a waiver claim window</span></div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {myRosteredPlayers.map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', fontFamily: 'var(--data)' }}>
                  <span>{p.full_name} ({p.position}) — {money(p.contract?.cap_hit_cents)}</span>
                  <button className="btn ghost" onClick={() => createRelease.mutate({ leagueId, data: { player_id: p.id } }, {
                    onSuccess: async () => { announce(`${p.full_name} released to waivers.`); await invalidateAll(); },
                    onError: err => announce(err instanceof Error ? err.message : 'Unable to release that player.'),
                  })}>Release</button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="panel" id="wire">
          <div className="panel-head"><h2>Wire</h2><span className="note">Append-only</span></div>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {wire.length === 0 && <small style={{ color: 'var(--steel)' }}>No transactions yet.</small>}
            {wire.map(entry => (
              <div key={entry.id} style={{ borderBottom: '1px solid var(--rule)', paddingBottom: '8px', fontSize: '12px', fontFamily: 'var(--data)' }}>
                <div><strong>{entry.type.replace('_', ' ')}</strong> — {entry.summary}</div>
                <div style={{ color: 'var(--steel)' }}>
                  {entry.status}{entry.decided_by ? ` · ${entry.decided_by}` : ''}{entry.note ? ` · ${entry.note}` : ''}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
