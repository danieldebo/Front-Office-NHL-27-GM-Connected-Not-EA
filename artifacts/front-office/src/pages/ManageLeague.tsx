import React, { useState } from 'react';
import { useLocation, useParams, Link } from 'wouter';
import { 
  useGetLeague, 
  useGetCurrentAuthUser,
  useListSeats,
  useAssignGm,
  useRevokeGm,
  useListJoinRequests,
  useApproveJoinRequest,
  useRejectJoinRequest,
  useGetLatestRulebook,
  usePublishRulebook,
  useListRulebookRevisions,
  useListInvites,
  useCreateInvite,
  useListSeasons,
  useListWeeks,
  useGenerateSchedule,
  Seat,
  JoinRequest,
  InviteLink,
  RulebookRevision
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

// Helper components
function SeatsTab({ leagueId }: { leagueId: string }) {
  const { data: seatsResponse, isLoading } = useListSeats(leagueId);
  const seats = seatsResponse?.data || [];
  const assignGm = useAssignGm();
  const revokeGm = useRevokeGm();
  const queryClient = useQueryClient();

  if (isLoading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading seats...</div>;

  if (seats.length === 0) {
    return (
      <div className="empty-state">
        <h2>No Seats Available</h2>
        <p style={{color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px', marginTop: '10px', textTransform: 'uppercase', letterSpacing: '.1em'}}>
          You need an active season to manage franchise seats.
        </p>
        <div style={{ marginTop: '20px' }}>
          <Link href={`/leagues/${leagueId}/season/new`} className="btn">Create Season</Link>
        </div>
      </div>
    );
  }

  const handleRevoke = (seat: Seat) => {
    if (!confirm(`Revoke GM assignment for ${seat.franchise_name}?`)) return;
    revokeGm.mutate({ teamSeasonId: seat.team_season_id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/leagues', leagueId, 'seats'] as any });
      }
    });
  };

  const handleAssign = (seat: Seat) => {
    const userId = prompt(`Enter User ID to assign to ${seat.franchise_name}:`);
    if (!userId) return;
    assignGm.mutate({
      teamSeasonId: seat.team_season_id,
      data: { user_id: userId, role: 'gm' }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/leagues', leagueId, 'seats'] as any });
      }
    });
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
      {seats.map(seat => (
        <div key={seat.team_season_id} className="panel" style={{ marginBottom: 0 }}>
          <div className="panel-head" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="crest" style={{ width: '28px', height: '28px', fontSize: '12px' }}>
              {seat.club_abbrev || seat.franchise_name?.substring(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '14px' }}>{seat.franchise_name}</div>
              <div style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)', textTransform: 'uppercase' }}>
                {seat.division}
              </div>
            </div>
            <div className={`chip ${seat.seat_status === 'open' ? 'ea' : seat.seat_status === 'pending' ? 'ocr' : 'conf'}`}>
              {seat.seat_status}
            </div>
          </div>
          <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {seat.gm ? (
              <>
                <div style={{ fontFamily: 'var(--data)', fontSize: '12px' }}>
                  GM: <strong style={{ color: 'var(--ink)' }}>{seat.gm.display_name || seat.gm.user_id}</strong>
                </div>
                <button onClick={() => handleRevoke(seat)} className="btn ghost" style={{ color: 'var(--goal)', borderColor: 'var(--goal)' }}>Revoke</button>
              </>
            ) : (
              <>
                <div style={{ fontFamily: 'var(--data)', fontSize: '12px', color: 'var(--steel)' }}>
                  No GM assigned
                </div>
                <button onClick={() => handleAssign(seat)} className="btn" style={{ background: 'var(--crease)', borderColor: 'var(--crease)' }}>Assign GM</button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function JoinRequestsTab({ leagueId }: { leagueId: string }) {
  const { data: reqsResponse, isLoading: isLoadingReqs } = useListJoinRequests(leagueId);
  const { data: invResponse, isLoading: isLoadingInv } = useListInvites(leagueId);
  
  const approveReq = useApproveJoinRequest();
  const rejectReq = useRejectJoinRequest();
  const createInvite = useCreateInvite();
  const queryClient = useQueryClient();

  const requests = reqsResponse?.data || [];
  const invites = invResponse?.data || [];
  const pendingRequests = requests.filter(r => r.status === 'pending');

  const handleApprove = (req: JoinRequest) => {
    approveReq.mutate({ leagueId, requestId: req.id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/leagues', leagueId, 'join-requests'] as any })
    });
  };

  const handleReject = (req: JoinRequest) => {
    rejectReq.mutate({ leagueId, requestId: req.id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/leagues', leagueId, 'join-requests'] as any })
    });
  };

  const handleCreateInvite = () => {
    createInvite.mutate({ leagueId, data: { max_uses: null, expires_in_hours: null } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/leagues', leagueId, 'invites'] as any })
    });
  };

  const handleCopy = (token: string) => {
    const url = `${window.location.origin}/join/${token}`;
    navigator.clipboard.writeText(url);
    alert('Invite link copied!');
  };

  if (isLoadingReqs || isLoadingInv) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading requests...</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '26px' }}>
      <div>
        <h3 style={{ fontFamily: 'var(--display)', fontSize: '20px', textTransform: 'uppercase', marginBottom: '16px' }}>Pending Requests</h3>
        {pendingRequests.length === 0 ? (
          <div className="panel" style={{ padding: '20px', textAlign: 'center', color: 'var(--steel)' }}>
            No pending join requests.
          </div>
        ) : (
          <div className="panel">
            <table style={{ textAlign: 'left' }}>
              <thead>
                <tr>
                  <th className="l">User</th>
                  <th className="l">Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingRequests.map(req => (
                  <tr key={req.id}>
                    <td className="l" style={{ fontWeight: 600 }}>{req.display_name || req.user_id}</td>
                    <td className="l">{new Date(req.created_at).toLocaleDateString()}</td>
                    <td style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button onClick={() => handleApprove(req)} className="btn" style={{ background: '#1F7A4C', borderColor: '#1F7A4C' }}>Approve</button>
                      <button onClick={() => handleReject(req)} className="btn ghost" style={{ color: 'var(--goal)' }}>Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 style={{ fontFamily: 'var(--display)', fontSize: '20px', textTransform: 'uppercase', marginBottom: '16px' }}>Invite Links</h3>
        <div className="panel">
          {invites.filter(i => !i.revoked_at).map(inv => (
            <div key={inv.id} style={{ padding: '16px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)' }}>
                Uses: {inv.use_count}{inv.max_uses ? ` / ${inv.max_uses}` : ''}
              </div>
              <button onClick={() => handleCopy(inv.token)} className="btn ghost">Copy Link</button>
            </div>
          ))}
          <div style={{ padding: '16px', textAlign: 'center' }}>
            <button onClick={handleCreateInvite} className="btn" style={{ width: '100%' }}>Generate New Invite</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RulebookTab({ leagueId }: { leagueId: string }) {
  const { data: rulebook } = useGetLatestRulebook(leagueId);
  const { data: revisionsResponse } = useListRulebookRevisions(leagueId);
  const publish = usePublishRulebook();
  const queryClient = useQueryClient();

  const [bodyMd, setBodyMd] = useState(rulebook?.body_md || '');
  const [changeNote, setChangeNote] = useState('');

  // Sync state once data loads
  React.useEffect(() => {
    if (rulebook?.body_md && !bodyMd) {
      setBodyMd(rulebook.body_md);
    }
  }, [rulebook]);

  const handlePublish = (e: React.FormEvent) => {
    e.preventDefault();
    publish.mutate({ leagueId, data: { body_md: bodyMd, change_note: changeNote || null } }, {
      onSuccess: () => {
        setChangeNote('');
        queryClient.invalidateQueries({ queryKey: ['/api/leagues', leagueId, 'rulebook'] as any });
        queryClient.invalidateQueries({ queryKey: ['/api/leagues', leagueId, 'rulebook', 'revisions'] as any });
        alert('Rulebook published!');
      }
    });
  };

  const revisions = revisionsResponse?.data || [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '26px' }}>
      <div>
        <form onSubmit={handlePublish} className="panel">
          <div className="panel-head">
            <h2>Rulebook Editor</h2>
            {rulebook && <div className="note">Current: {rulebook.version}</div>}
          </div>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <textarea
              value={bodyMd}
              onChange={e => setBodyMd(e.target.value)}
              style={{
                width: '100%',
                height: '300px',
                padding: '12px',
                fontFamily: 'var(--data)',
                fontSize: '13px',
                border: '1px solid var(--rule)',
                borderRadius: '3px',
                background: '#FAFCFD',
                resize: 'vertical'
              }}
              placeholder="# League Rules\n\n1. Be cool."
              required
            />
            <input
              type="text"
              value={changeNote}
              onChange={e => setChangeNote(e.target.value)}
              placeholder="Change note (optional, e.g. 'Updated trade rules')"
              style={{
                width: '100%',
                padding: '10px 12px',
                fontFamily: 'var(--body)',
                fontSize: '14px',
                border: '1px solid var(--rule)',
                borderRadius: '3px'
              }}
            />
            <div>
              <button type="submit" className="btn" disabled={publish.isPending}>
                {publish.isPending ? 'Publishing...' : 'Publish Revision'}
              </button>
            </div>
          </div>
        </form>
      </div>
      <div>
        <h3 style={{ fontFamily: 'var(--display)', fontSize: '20px', textTransform: 'uppercase', marginBottom: '16px' }}>Revision History</h3>
        <div className="panel">
          {revisions.map(rev => (
            <div key={rev.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <strong style={{ fontFamily: 'var(--data)', fontSize: '12px' }}>{rev.version}</strong>
                <span style={{ fontSize: '11px', color: 'var(--steel)' }}>{new Date(rev.effective_at).toLocaleDateString()}</span>
              </div>
              {rev.change_note && (
                <div style={{ fontSize: '13px', color: 'var(--steel)' }}>{rev.change_note}</div>
              )}
            </div>
          ))}
          {revisions.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--steel)' }}>No revisions yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScheduleTab({ leagueId }: { leagueId: string }) {
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const { data: seasonsData, isLoading: seasonsLoading } = useListSeasons(leagueId);
  const seasons = seasonsData?.data ?? [];
  const qc = useQueryClient();

  // Pick first season by default
  React.useEffect(() => {
    if (!selectedSeasonId && seasons.length > 0 && seasons[0]) {
      setSelectedSeasonId(seasons[0].id);
    }
  }, [seasons, selectedSeasonId]);

  const activeSeason = seasons.find(s => s.id === selectedSeasonId) ?? seasons[0] ?? null;

  const { data: weeksData, isLoading: weeksLoading } = useListWeeks(
    activeSeason?.id ?? '',
    { query: { enabled: !!activeSeason?.id } }
  );
  const weeks = (weeksData as any)?.data ?? [];

  const generate = useGenerateSchedule();
  const [genError, setGenError] = useState<string | null>(null);

  const handleGenerate = () => {
    if (!activeSeason) return;
    setGenError(null);
    const startDate = activeSeason.starts_on
      ? activeSeason.starts_on.slice(0, 10)
      : new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    if (!confirm(`Generate schedule for this season?\n\nStarts: ${startDate}\nWindow: 7 days each\n\nThis cannot be undone.`)) return;
    generate.mutate(
      { seasonId: activeSeason.id, data: { week_duration_days: 7, start_date: startDate } },
      {
        onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/seasons', activeSeason.id, 'weeks'] as any }),
        onError: (err: unknown) => setGenError(err instanceof Error ? err.message : 'Failed'),
      }
    );
  };

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
      {seasons.length > 1 && (
        <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Season:</span>
          {seasons.map((s: any) => (
            <button key={s.id} className={`btn ${s.id === selectedSeasonId ? '' : 'ghost'}`}
              onClick={() => setSelectedSeasonId(s.id)} style={{ fontSize: '12px', padding: '5px 12px' }}>
              {s.name || s.id.slice(0, 8)}
            </button>
          ))}
        </div>
      )}

      {noSchedule && (
        <div className="panel" style={{ maxWidth: '480px' }}>
          <div className="panel-head"><h2>No Schedule Yet</h2></div>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontFamily: 'var(--data)', fontSize: '12px', color: 'var(--steel)', lineHeight: 1.6 }}>
              Generate a balanced round-robin schedule. Every franchise plays every other franchise, home/away balanced within 1 game.
            </div>
            {genError && (
              <div style={{ background: '#FCF2F0', border: '1px solid #E5B8B1', borderRadius: '3px', padding: '10px 14px', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--goal)' }}>
                {genError}
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button className="btn" onClick={handleGenerate} disabled={generate.isPending}>
                {generate.isPending ? 'Generating…' : 'Generate Schedule'}
              </button>
              <Link href={`/leagues/${leagueId}/schedule`} className="btn ghost">
                Advanced Options
              </Link>
            </div>
          </div>
        </div>
      )}

      {weeks.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>Week Windows</h2>
            <span className="note">{weeks.length} weeks · {weeks.reduce((s: number, w: any) => s + (w.games?.total ?? 0), 0)} games</span>
            <Link href={`/leagues/${leagueId}/schedule`} className="btn ghost" style={{ fontSize: '11px', padding: '4px 10px', marginLeft: 'auto' }}>
              Full View
            </Link>
          </div>
          {weeks.slice(0, 8).map((week: any) => {
            const opens  = new Date(week.window_opens_at);
            const closes = new Date(week.window_closes_at);
            const now    = new Date();
            const active = opens <= now && closes > now;
            return (
              <div key={week.week_number} className="matchup" style={{ alignItems: 'center' }}>
                <span className="mu-teams" style={{ minWidth: '60px', fontFamily: 'var(--display)', fontSize: '18px' }}>
                  Wk {week.week_number}
                </span>
                <span className="mu-when">
                  {opens.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  {' – '}
                  {closes.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
                {active && <span className="chip ea" style={{ fontSize: '10px' }}>Live</span>}
                <span style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', marginLeft: 'auto' }}>
                  {week.games?.confirmed ?? 0}/{week.games?.total ?? 0} done
                </span>
              </div>
            );
          })}
          {weeks.length > 8 && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--rule)', textAlign: 'center' }}>
              <Link href={`/leagues/${leagueId}/schedule`} style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--crease)' }}>
                View all {weeks.length} weeks →
              </Link>
            </div>
          )}
        </div>
      )}

      {weeksLoading && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>
          Loading schedule…
        </div>
      )}
    </div>
  );
}

export default function ManageLeague() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<'seats'|'requests'|'rulebook'|'schedule'>('seats');
  
  const { data: userResponse, isLoading: isLoadingUser } = useGetCurrentAuthUser();
  const { data: league, isLoading: isLoadingLeague } = useGetLeague(id || '');

  if (isLoadingUser || isLoadingLeague) {
    return <div className="loading-screen">Loading...</div>;
  }

  const user = userResponse?.user;
  if (!user || !league || league.owner_user_id !== user.id) {
    return (
      <div className="empty-state">
        <h2>Unauthorized</h2>
        <p style={{color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px', marginTop: '10px', textTransform: 'uppercase', letterSpacing: '.1em'}}>
          You are not the commissioner of this league.
        </p>
        <div style={{ marginTop: '20px' }}>
          <Link href="/" className="btn">Return to Hub</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <Header league={league} />
      <div className="slab">
        <div className="wrap" style={{ padding: '30px 20px', display: 'block' }}>
          <div className="eyebrow">Commissioner Desk</div>
          <h1 style={{ fontSize: '42px', marginTop: '5px' }}>{league.name} Operations</h1>
        </div>
      </div>
      <div className="wrap" style={{ paddingTop: '20px', paddingBottom: '60px' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid var(--rule)', paddingBottom: '12px' }}>
          <button 
            onClick={() => setActiveTab('seats')}
            className={`btn ${activeTab !== 'seats' ? 'ghost' : ''}`}
          >
            Franchise Seats
          </button>
          <button 
            onClick={() => setActiveTab('requests')}
            className={`btn ${activeTab !== 'requests' ? 'ghost' : ''}`}
          >
            Join Requests
          </button>
          <button 
            onClick={() => setActiveTab('rulebook')}
            className={`btn ${activeTab !== 'rulebook' ? 'ghost' : ''}`}
          >
            Rulebook
          </button>
          <button 
            onClick={() => setActiveTab('schedule')}
            className={`btn ${activeTab !== 'schedule' ? 'ghost' : ''}`}
          >
            Schedule
          </button>
          
          <div style={{ marginLeft: 'auto' }}>
            <Link href={`/leagues/${league.id}/season/new`} className="btn ghost" style={{ borderColor: 'var(--steel)' }}>
              + New Season
            </Link>
          </div>
        </div>

        {activeTab === 'seats' && <SeatsTab leagueId={league.id} />}
        {activeTab === 'requests' && <JoinRequestsTab leagueId={league.id} />}
        {activeTab === 'rulebook' && <RulebookTab leagueId={league.id} />}
        {activeTab === 'schedule' && (
          <ScheduleTab leagueId={league.id} />
        )}
      </div>
      <Footer />
    </>
  );
}
