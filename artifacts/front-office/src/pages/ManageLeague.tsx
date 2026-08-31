import React, { useState } from 'react';
import { useLocation, useParams, Link } from 'wouter';
import { 
  useGetLeague,
  useCreateAnnouncement,
  useListDiscordWebhooks,
  getListDiscordWebhooksQueryKey,
  useCreateDiscordWebhook,
  useUpdateDiscordWebhook,
  useDeleteDiscordWebhook,
  useTestDiscordWebhook,
  DiscordWebhook,
  DiscordEventFilter,
  useListSeats,
  getListSeatsQueryKey,
  useAssignGm,
  useRevokeGm,
  useListJoinRequests,
  getListJoinRequestsQueryKey,
  useApproveJoinRequest,
  useRejectJoinRequest,
  useGetLatestRulebook,
  getGetLatestRulebookQueryKey,
  usePublishRulebook,
  useListRulebookRevisions,
  getListRulebookRevisionsQueryKey,
  useListSeasons,
  useListWeeks,
  getListWeeksQueryKey,
  useGenerateSchedule,
  useGetLeagueSettings,
  useListLeagueSettingsHistory,
  useGetCommissionerInvite,
  getGetCommissionerInviteQueryKey,
  useCreateCommissionerInvite,
  useRotateCommissionerInvite,
  useUpdateCommissionerInvite,
  useRevokeCommissionerInvite,
  useSetPublicCode,
  useGetLeagueListing,
  getGetLeagueListingQueryKey,
  useUpdateLeagueListing,
  useListLeagueSignups,
  getListLeagueSignupsQueryKey,
  useListLeagueWaitlist,
  getListLeagueWaitlistQueryKey,
  useAcceptApplicant,
  useDeclineApplicant,
  useReorderWaitlistEntry,
  Seat,
  JoinRequest,
  LeagueApplicant,
  WaitlistApplicant,
    AssignedGm,
    CommissionerInviteInput,
    UpdateLeagueListingInput,
    WeekWindow,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';
import Header from '@/components/Header';
import { gmIdentityLabel } from '@/components/gmIdentity';
import LeagueSettings from '@/components/LeagueSettings';
import { activeSettingsFromResponse } from '@/components/LeagueSettings';

// Helper components
export function SeatGmLabel({ gm, seatId }: { gm: AssignedGm; seatId: string }) {
  const identity = gmIdentityLabel(gm);
  return (
    <div style={{ fontFamily: 'var(--data)', fontSize: '12px' }} data-testid={`text-seat-gm-${seatId}`}>
      GM: <strong style={{ color: 'var(--ink)' }}>{gm.display_name || gm.user_id}</strong>
      {identity && <span style={{ color: 'var(--steel)' }}> · {identity}</span>}
    </div>
  );
}

export function commissionerInviteUpdatePayload(
  maxUsesInput: string,
  expiresAtInput: string,
): CommissionerInviteInput {
  return {
    max_uses: maxUsesInput ? parseInt(maxUsesInput, 10) : null,
    // An empty expiry clears an existing expiry rather than leaving it unchanged.
    expires_at: expiresAtInput || null,
  };
}

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
        queryClient.invalidateQueries({ queryKey: getListSeatsQueryKey(leagueId) });
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
        queryClient.invalidateQueries({ queryKey: getListSeatsQueryKey(leagueId) });
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
                <SeatGmLabel gm={seat.gm} seatId={seat.team_season_id} />
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
        queryClient.invalidateQueries({ queryKey: getGetLatestRulebookQueryKey(leagueId) });
        queryClient.invalidateQueries({ queryKey: getListRulebookRevisionsQueryKey(leagueId) });
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
              placeholder={`# League Rules

1. Be cool.`}
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

function LinksTab({ leagueId, leagueSlug }: { leagueId: string; leagueSlug: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetCommissionerInvite(leagueId);

  const createInvite = useCreateCommissionerInvite();
  const rotateInvite = useRotateCommissionerInvite();
  const updateInvite = useUpdateCommissionerInvite();
  const revokeInvite = useRevokeCommissionerInvite();
  const setPublicCode = useSetPublicCode();

  const [publicCodeInput, setPublicCodeInput] = useState('');
  const [publicCodeEditing, setPublicCodeEditing] = useState(false);
  const [publicCodeError, setPublicCodeError] = useState<string | null>(null);

  const [maxUsesInput, setMaxUsesInput] = useState('');
  const [expiresAtInput, setExpiresAtInput] = useState('');
  const [capEditing, setCapEditing] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetCommissionerInviteQueryKey(leagueId) });

  React.useEffect(() => {
    if (data?.public_code && !publicCodeEditing) {
      setPublicCodeInput(data.public_code ?? '');
    }
  }, [data?.public_code]);

  if (isLoading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading links…</div>;

  const invite = data?.invite ?? null;
  const publicCode = data?.public_code ?? '';

  const inviteUrl = invite ? `${window.location.origin}/join/${invite.token}` : null;
  const publicUrl = `${window.location.origin}/l/${leagueSlug}`;
  const publicCodeUrl = publicCode ? `${window.location.origin}/j/${publicCode}` : null;

  const handleCopyInvite = () => {
    if (inviteUrl) { navigator.clipboard.writeText(inviteUrl); alert('Invite link copied!'); }
  };
  const handleCopyCode = () => {
    navigator.clipboard.writeText(publicCode); alert('Public code copied!');
  };
  const handleCopyPublicUrl = () => {
    if (publicCodeUrl) { navigator.clipboard.writeText(publicCodeUrl); alert('Public URL copied!'); }
  };

  const handleSavePublicCode = () => {
    const code = publicCodeInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{5,12}$/.test(code)) {
      setPublicCodeError('Must be 5–12 uppercase letters/digits (e.g. RUSTBELT)');
      return;
    }
    setPublicCodeError(null);
    setPublicCode.mutate({ leagueId, data: { public_code: code } }, {
      onSuccess: () => { setPublicCodeEditing(false); invalidate(); },
      onError: (err: unknown) => setPublicCodeError(err instanceof Error ? err.message : 'Error saving code'),
    });
  };

  const handleCreateInvite = () => {
    createInvite.mutate({ leagueId }, {
      onSuccess: () => invalidate(),
    });
  };

  const handleRotate = () => {
    if (!confirm('Rotate the invite link? The old URL will stop working immediately.')) return;
    rotateInvite.mutate({ leagueId }, {
      onSuccess: () => invalidate(),
    });
  };

  const handleRevoke = () => {
    if (!confirm('Revoke the invite link? Anyone with the old URL will no longer be able to join.')) return;
    revokeInvite.mutate({ leagueId }, {
      onSuccess: () => invalidate(),
    });
  };

  const handleSaveCap = () => {
    updateInvite.mutate({
      leagueId,
        data: commissionerInviteUpdatePayload(maxUsesInput, expiresAtInput),
    }, {
      onSuccess: () => { setCapEditing(false); invalidate(); },
    });
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '26px' }}>
      {/* ── Public Code */}
      <div className="panel">
        <div className="panel-head">
          <h2>League Public Code</h2>
          {publicCode && (
            <button onClick={handleCopyCode} className="btn ghost" style={{ fontSize: '11px', padding: '4px 10px' }}>Copy Code</button>
          )}
        </div>
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', lineHeight: 1.5 }}>
            A short, stable code fans can type to find your league publicly (e.g.&nbsp;<code>RUSTBELT</code>). It won't break if you rename the league slug later.
          </div>

          {publicCode && !publicCodeEditing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <code style={{ fontFamily: 'var(--data)', fontSize: '18px', fontWeight: 700, letterSpacing: '.1em', color: 'var(--crease)' }}>{publicCode}</code>
              <button onClick={() => setPublicCodeEditing(true)} className="btn ghost" style={{ fontSize: '11px', padding: '4px 10px' }}>Edit</button>
            </div>
          )}

          {(!publicCode || publicCodeEditing) && (
            <>
              <input
                type="text"
                value={publicCodeInput}
                onChange={e => setPublicCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="RUSTBELT"
                maxLength={12}
                style={{
                  width: '100%', padding: '10px 12px',
                  fontFamily: 'var(--data)', fontSize: '16px', letterSpacing: '.1em',
                  border: '1px solid var(--rule)', borderRadius: '3px',
                  textTransform: 'uppercase',
                }}
              />
              {publicCodeError && (
                <div style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--goal)' }}>{publicCodeError}</div>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleSavePublicCode} className="btn" disabled={setPublicCode.isPending}>
                  {setPublicCode.isPending ? 'Saving…' : 'Save Code'}
                </button>
                {publicCodeEditing && (
                  <button onClick={() => { setPublicCodeEditing(false); setPublicCodeInput(publicCode); setPublicCodeError(null); }} className="btn ghost">Cancel</button>
                )}
              </div>
            </>
          )}

          {publicCode && (
            <div style={{ borderTop: '1px solid var(--rule)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Shareable URL</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <code style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--crease)', wordBreak: 'break-all', flex: 1 }}>{publicCodeUrl}</code>
                <button onClick={handleCopyPublicUrl} className="btn ghost" style={{ fontSize: '11px', padding: '4px 10px', whiteSpace: 'nowrap' }}>Copy URL</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Commissioner Invite Link */}
      <div className="panel">
        <div className="panel-head">
          <h2>Reusable Invite Link</h2>
          {invite && (
            <span className="chip conf" style={{ fontSize: '10px' }}>Active</span>
          )}
        </div>
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', lineHeight: 1.5 }}>
            Share one link to let anyone claim a seat. Rotate it to revoke the old URL and get a fresh one.
          </div>

          {!invite && (
            <button onClick={handleCreateInvite} className="btn" disabled={createInvite.isPending}>
              {createInvite.isPending ? 'Creating…' : 'Generate Invite Link'}
            </button>
          )}

          {invite && (
            <>
              {/* URL row */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  readOnly
                  value={inviteUrl ?? ''}
                  style={{
                    flex: 1, padding: '8px 10px', fontFamily: 'var(--data)', fontSize: '11px',
                    border: '1px solid var(--rule)', borderRadius: '3px', background: '#F6F8FA',
                    color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                />
                <button onClick={handleCopyInvite} className="btn ghost" style={{ whiteSpace: 'nowrap', fontSize: '11px', padding: '6px 12px' }}>Copy</button>
              </div>

              {/* Use counter + expiry */}
              <div style={{ display: 'flex', gap: '16px', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)' }}>
                <span>
                  Uses: <strong style={{ color: 'var(--ink)' }}>{invite.uses}{invite.max_uses ? ` / ${invite.max_uses}` : ''}</strong>
                </span>
                {invite.expires_at && (
                  <span>
                    Expires: <strong style={{ color: 'var(--ink)' }}>{new Date(invite.expires_at).toLocaleDateString()}</strong>
                  </span>
                )}
                {!invite.expires_at && !invite.max_uses && (
                  <span style={{ color: 'var(--bulb)' }}>No cap or expiry set</span>
                )}
              </div>

              {/* Cap / Expiry edit */}
              {capEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid var(--rule)', borderRadius: '3px', padding: '12px', background: '#FAFCFD' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <label style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', minWidth: '70px' }}>Max uses</label>
                    <input type="number" min={1} value={maxUsesInput} onChange={e => setMaxUsesInput(e.target.value)}
                      placeholder="unlimited" style={{ flex: 1, padding: '6px 8px', fontFamily: 'var(--data)', fontSize: '12px', border: '1px solid var(--rule)', borderRadius: '3px' }} />
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <label style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', minWidth: '70px' }}>Expires at</label>
                    <input type="datetime-local" value={expiresAtInput} onChange={e => setExpiresAtInput(e.target.value)}
                      style={{ flex: 1, padding: '6px 8px', fontFamily: 'var(--data)', fontSize: '12px', border: '1px solid var(--rule)', borderRadius: '3px' }} />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={handleSaveCap} className="btn" style={{ fontSize: '12px', padding: '5px 12px' }} disabled={updateInvite.isPending}>
                      {updateInvite.isPending ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setCapEditing(false)} className="btn ghost" style={{ fontSize: '12px', padding: '5px 12px' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => {
                  setMaxUsesInput(invite.max_uses ? String(invite.max_uses) : '');
                  setExpiresAtInput(invite.expires_at ? new Date(invite.expires_at).toISOString().slice(0, 16) : '');
                  setCapEditing(true);
                }} className="btn ghost" style={{ fontSize: '12px', padding: '5px 12px', alignSelf: 'flex-start' }}>
                  Set Cap / Expiry
                </button>
              )}

              {/* Danger actions */}
              <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--rule)', paddingTop: '10px' }}>
                <button onClick={handleRotate} className="btn ghost" style={{ fontSize: '12px', padding: '5px 12px' }} disabled={rotateInvite.isPending}>
                  {rotateInvite.isPending ? 'Rotating…' : '↻ Rotate'}
                </button>
                <button onClick={handleRevoke} className="btn ghost" style={{ fontSize: '12px', padding: '5px 12px', color: 'var(--goal)', borderColor: 'var(--goal)' }} disabled={revokeInvite.isPending}>
                  {revokeInvite.isPending ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Division badge colours ────────────────────────────────────────────────────
const DIVISION_COLOURS: Record<string, { bg: string; color: string }> = {
  bronze:   { bg: '#CD7F32', color: '#fff' },
  silver:   { bg: '#A8A9AD', color: '#fff' },
  gold:     { bg: '#CFB53B', color: '#fff' },
  platinum: { bg: '#00827F', color: '#fff' },
  diamond:  { bg: '#4FC3F7', color: '#000' },
  elite:    { bg: '#7C4DFF', color: '#fff' },
  ultimate: { bg: '#E91E63', color: '#fff' },
};

function DivisionBadge({ division }: { division?: string | null }) {
  if (!division) return null;
  const style = DIVISION_COLOURS[division] ?? { bg: 'var(--steel)', color: '#fff' };
  return (
    <span style={{
      fontFamily: 'var(--data)',
      fontSize: '10px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '.06em',
      padding: '2px 8px',
      borderRadius: '3px',
      background: style.bg,
      color: style.color,
      whiteSpace: 'nowrap',
    }}>
      {division}
    </span>
  );
}

export function ApplicantIdentityStatus({
  platform,
  gamertag,
  verified,
}: {
  platform?: string | null;
  gamertag?: string | null;
  verified?: boolean;
}) {
  if (!platform && !gamertag) return null;
  const label = platform === 'playstation' || platform === 'psn'
    ? 'PSN'
    : platform === 'xbox'
      ? 'Xbox'
      : platform;
  return (
    <span className={`chip ${verified ? 'conf' : 'man'}`} data-testid="applicant-identity-status">
      {[label, gamertag, verified ? 'Verified' : 'Self-reported'].filter(Boolean).join(' · ')}
    </span>
  );
}

function ApplicantsTab({ leagueId }: { leagueId: string }) {
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const selectedSeatId = new URLSearchParams(location.split('?')[1] ?? '').get('seat');
  const applicantQuery = selectedSeatId ? { seat: selectedSeatId } : undefined;
  const { data: signupsData, isLoading: signupsLoading } = useListLeagueSignups(leagueId, applicantQuery);
  const { data: waitlistData, isLoading: waitlistLoading } = useListLeagueWaitlist(leagueId, applicantQuery);
  const { data: requestsData, isLoading: requestsLoading } = useListJoinRequests(leagueId);
  const { data: seatsData } = useListSeats(leagueId);
  const acceptApplicant = useAcceptApplicant();
  const declineApplicant = useDeclineApplicant();
  const approveJoinRequest = useApproveJoinRequest();
  const rejectJoinRequest = useRejectJoinRequest();
  const reorderWaitlist = useReorderWaitlistEntry();
  const [decliningSignupId, setDecliningSignupId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState('');

  const signups = signupsData?.data ?? [];
  const waitlist = waitlistData?.data ?? [];
  const representedUserIds = new Set([
    ...signups.map(entry => entry.user_id),
    ...waitlist.map(entry => entry.user_id),
  ]);
  const selectedSeat = (seatsData?.data ?? []).find(seat => seat.team_season_id === selectedSeatId);
  const joinRequests = (selectedSeatId ? [] : requestsData?.data ?? []).filter(
    request => request.status === 'pending'
      && Boolean(request.user_id)
      && !representedUserIds.has(request.user_id!),
  );
  const waitlistOnly = waitlist.filter(entry => !entry.signup_id);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListLeagueSignupsQueryKey(leagueId, applicantQuery) });
    queryClient.invalidateQueries({ queryKey: getListLeagueWaitlistQueryKey(leagueId, applicantQuery) });
    queryClient.invalidateQueries({ queryKey: getListJoinRequestsQueryKey(leagueId) });
  };

  const handleMove = (entry: WaitlistApplicant, direction: 'up' | 'down') => {
    // Position must be in the waiting-only sub-queue — same domain the backend uses.
    const waitingOnly = waitlist.filter(e => e.status === 'waiting');
    const waitingIdx = waitingOnly.findIndex(e => e.user_id === entry.user_id);
    if (waitingIdx === -1) return; // entry is invited or already resolved — no-op
    // 1-indexed target within waiting sub-queue
    const targetPos = direction === 'up' ? waitingIdx : waitingIdx + 2;
    const clamped = Math.max(1, Math.min(targetPos, waitingOnly.length));
    reorderWaitlist.mutate(
      { leagueId, userId: entry.user_id, data: { position: clamped } },
      { onSuccess: () => invalidate(), onError: (err: unknown) => alert(err instanceof Error ? err.message : 'Failed to reorder') }
    );
  };

  const handleAccept = (signup: LeagueApplicant) => {
    if (!confirm(`Accept ${signup.display_name ?? 'this applicant'}?\n\nThey will be added as a league member. You can assign them to a franchise seat from the Seats tab.`)) return;
    acceptApplicant.mutate({ leagueId, signupId: signup.signup_id }, {
      onSuccess: () => invalidate(),
      onError: (err: unknown) => alert(err instanceof Error ? err.message : 'Failed to accept applicant'),
    });
  };

  const handleDecline = (event: React.FormEvent, signup: LeagueApplicant) => {
    event.preventDefault();
    declineApplicant.mutate({
      leagueId,
      signupId: signup.signup_id,
      data: declineNote.trim() ? { note: declineNote.trim() } : undefined,
    }, {
      onSuccess: () => {
        setDecliningSignupId(null);
        setDeclineNote('');
        invalidate();
      },
      onError: (err: unknown) => alert(err instanceof Error ? err.message : 'Failed to decline applicant'),
    });
  };

  const getWaitlistReviewId = (entry: WaitlistApplicant) =>
    entry.signup_id ?? entry.waitlist_entry_id;

  const handleWaitlistAccept = (entry: WaitlistApplicant) => {
    if (!confirm(`Accept ${entry.display_name ?? 'this applicant'}?\n\nThey will be added as a league member. You can assign them to a franchise seat from the Seats tab.`)) return;
    acceptApplicant.mutate(
      { leagueId, signupId: getWaitlistReviewId(entry) },
      {
        onSuccess: () => invalidate(),
        onError: (err: unknown) => alert(err instanceof Error ? err.message : 'Failed to accept applicant'),
      },
    );
  };

  const handleWaitlistDecline = (event: React.FormEvent, entry: WaitlistApplicant) => {
    event.preventDefault();
    declineApplicant.mutate({
      leagueId,
      signupId: getWaitlistReviewId(entry),
      data: declineNote.trim() ? { note: declineNote.trim() } : undefined,
    }, {
      onSuccess: () => {
        setDecliningSignupId(null);
        setDeclineNote('');
        invalidate();
      },
      onError: (err: unknown) => alert(err instanceof Error ? err.message : 'Failed to decline applicant'),
    });
  };

  const handleJoinRequestApprove = (request: JoinRequest) => {
    approveJoinRequest.mutate(
      { leagueId, requestId: request.id },
      { onSuccess: invalidate, onError: (err: unknown) => alert(err instanceof Error ? err.message : 'Failed to approve request') },
    );
  };

  const handleJoinRequestReject = (request: JoinRequest) => {
    rejectJoinRequest.mutate(
      { leagueId, requestId: request.id },
      { onSuccess: invalidate, onError: (err: unknown) => alert(err instanceof Error ? err.message : 'Failed to reject request') },
    );
  };

  if (signupsLoading || waitlistLoading || requestsLoading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>Loading applicants…</div>;
  }

  const cardStyle: React.CSSProperties = {
    border: '1px solid var(--rule)',
    borderRadius: '6px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    background: '#fff',
  };

  return (
    <>
      {selectedSeatId && (
        <div className="panel" style={{ marginBottom: 18, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <strong>Showing applicants for {selectedSeat?.franchise_name ?? 'the selected seat'}</strong>
            <div style={{ color: 'var(--steel)', fontSize: 12, marginTop: 3 }}>
              Only applicants who selected this franchise are included.
            </div>
          </div>
          <Link href={`/leagues/${leagueId}/manage?tab=applicants`} className="btn ghost">
            View all applicants
          </Link>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '26px', alignItems: 'start' }}>

      {/* ── Sign-up applicants ──────────────────────────── */}
      <div>
        <h3 style={{ fontFamily: 'var(--display)', fontSize: '20px', textTransform: 'uppercase', marginBottom: '16px' }}>
           Applicants
           {signups.length + joinRequests.length > 0 && (
            <span style={{ fontFamily: 'var(--data)', fontSize: '12px', color: 'var(--steel)', fontWeight: 400, marginLeft: '10px', textTransform: 'none' }}>
               {signups.length + joinRequests.length} applicant{signups.length + joinRequests.length !== 1 ? 's' : ''}
            </span>
          )}
        </h3>

         {signups.length + joinRequests.length === 0 ? (
          <div className="panel" style={{ padding: '28px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>
             No pending applicants yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {signups.map((signup: LeagueApplicant) => (
              <div key={signup.signup_id} style={cardStyle}>
                {/* ── Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 700, fontSize: '15px', flex: 1, minWidth: 0 }}>
                    {signup.display_name ?? <span style={{ color: 'var(--steel)' }}>Unknown user</span>}
                  </div>
                  <DivisionBadge division={signup.skill_division} />
                  <ApplicantIdentityStatus
                    platform={signup.platform}
                    gamertag={signup.platform_gamertag}
                    verified={signup.identity_verified}
                  />
                  {signup.waitlist_status && (
                    <span className={`chip ${signup.waitlist_status === 'waiting' ? 'ocr' : 'conf'}`} style={{ fontSize: '10px' }}>
                      waitlist #{signup.waitlist_position}
                    </span>
                  )}
                </div>

                {/* ── Meta row */}
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)' }}>
                  {signup.country_code && (
                    <span title={signup.location ?? undefined}>
                      Loc: {signup.location ? `${signup.location} (${signup.country_code})` : signup.country_code}
                    </span>
                  )}
                  {signup.timezone && <span>TZ: {signup.timezone}</span>}
                  {signup.preferred_club && <span>Club: {signup.preferred_club}</span>}
                  <span style={{ marginLeft: 'auto' }}>Applied {new Date(signup.created_at).toLocaleDateString()}</span>
                </div>

                {/* ── Message */}
                {signup.message && (
                  <div style={{
                    background: '#F6F8FA',
                    border: '1px solid var(--rule)',
                    borderRadius: '4px',
                    padding: '10px 12px',
                    fontFamily: 'var(--body)',
                    fontSize: '13px',
                    color: 'var(--ink)',
                    lineHeight: 1.5,
                    fontStyle: 'italic',
                  }}>
                    "{signup.message}"
                  </div>
                )}
                {(signup.preferred_seats?.length ?? 0) > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {signup.preferred_seats?.map(seat => (
                      <span className="chip ea" key={seat.team_season_id}>
                        {seat.franchise_name}{seat.club_abbrev ? ` · ${seat.club_abbrev}` : ''}
                      </span>
                    ))}
                  </div>
                )}

                {/* ── Actions */}
                <div style={{ display: 'flex', gap: '8px', paddingTop: '4px' }}>
                  <button
                    onClick={() => handleAccept(signup)}
                    className="btn"
                    disabled={acceptApplicant.isPending}
                    style={{ background: '#1F7A4C', borderColor: '#1F7A4C' }}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDecliningSignupId(signup.signup_id); setDeclineNote(''); }}
                    className="btn ghost"
                    disabled={declineApplicant.isPending || decliningSignupId !== null}
                    style={{ color: 'var(--goal)', borderColor: 'var(--goal)' }}
                  >
                    Decline
                  </button>
                </div>

                {decliningSignupId === signup.signup_id && (
                  <form
                    onSubmit={event => handleDecline(event, signup)}
                    style={{
                      borderTop: '1px solid var(--rule)',
                      paddingTop: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <label
                      htmlFor={`decline-note-${signup.signup_id}`}
                      style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.06em' }}
                    >
                      Decline note <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                    </label>
                    <textarea
                      id={`decline-note-${signup.signup_id}`}
                      value={declineNote}
                      onChange={event => setDeclineNote(event.target.value)}
                      maxLength={500}
                      rows={3}
                      autoFocus
                      placeholder="Add a brief note for your records"
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        fontFamily: 'var(--body)',
                        fontSize: '13px',
                        border: '1px solid var(--rule)',
                        borderRadius: '4px',
                        resize: 'vertical',
                      }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button type="submit" className="btn ghost" disabled={declineApplicant.isPending} style={{ color: 'var(--goal)', borderColor: 'var(--goal)' }}>
                        {declineApplicant.isPending ? 'Declining…' : 'Confirm decline'}
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={declineApplicant.isPending}
                        onClick={() => { setDecliningSignupId(null); setDeclineNote(''); }}
                      >
                        Cancel
                      </button>
                      <span style={{ marginLeft: 'auto', fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>
                        {declineNote.length}/500
                      </span>
                    </div>
                  </form>
                )}
              </div>
            ))}
             {joinRequests.map((request: JoinRequest) => (
               <div key={`request-${request.id}`} style={cardStyle}>
                 <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                   <div style={{ fontWeight: 700, fontSize: '15px', flex: 1, minWidth: 0 }}>
                     {request.display_name || request.user_id}
                   </div>
                   <span className="chip ea" style={{ fontSize: '10px' }}>Invite request</span>
                 </div>
                 <div style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)' }}>
                   Requested {new Date(request.created_at).toLocaleDateString()}
                 </div>
                 <div style={{ display: 'flex', gap: '8px', paddingTop: '4px' }}>
                   <button
                     onClick={() => handleJoinRequestApprove(request)}
                     className="btn"
                     disabled={approveJoinRequest.isPending}
                     style={{ background: '#1F7A4C', borderColor: '#1F7A4C' }}
                   >
                     Approve
                   </button>
                   <button
                     onClick={() => handleJoinRequestReject(request)}
                     className="btn ghost"
                     disabled={rejectJoinRequest.isPending}
                     style={{ color: 'var(--goal)', borderColor: 'var(--goal)' }}
                   >
                     Reject
                   </button>
                 </div>
               </div>
             ))}
          </div>
        )}
      </div>

      {/* ── Waitlist queue ─────────────────────────────── */}
      <div>
        <h3 style={{ fontFamily: 'var(--display)', fontSize: '20px', textTransform: 'uppercase', marginBottom: '16px' }}>
          Waitlist
           {waitlistOnly.length > 0 && (
            <span style={{ fontFamily: 'var(--data)', fontSize: '12px', color: 'var(--steel)', fontWeight: 400, marginLeft: '10px', textTransform: 'none' }}>
               {waitlistOnly.length} queued
            </span>
          )}
        </h3>

         {waitlistOnly.length === 0 ? (
          <div className="panel" style={{ padding: '20px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>
            No one on the waitlist.
          </div>
        ) : (
          <div className="panel">
             {waitlistOnly.map((entry: WaitlistApplicant, idx: number) => {
              const reviewId = getWaitlistReviewId(entry);
              return (
              <div key={entry.waitlist_entry_id} style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                padding: '12px 16px',
                 borderBottom: idx < waitlistOnly.length - 1 ? '1px solid var(--rule)' : 'none',
              }}>
              <div style={{
                display: 'flex',
                gap: '12px',
                alignItems: 'center',
              }}>
                {/* Position number */}
                <div style={{
                  fontFamily: 'var(--display)',
                  fontSize: '22px',
                  fontWeight: 700,
                  color: 'var(--steel)',
                  lineHeight: 1,
                  minWidth: '28px',
                }}>
                  {idx + 1}
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>
                      {entry.display_name ?? entry.user_id.slice(0, 8)}
                    </span>
                    <DivisionBadge division={entry.skill_division} />
                    <ApplicantIdentityStatus
                      platform={entry.platform}
                      gamertag={entry.platform_gamertag}
                      verified={entry.identity_verified}
                    />
                    {entry.status === 'invited' && (
                      <span className="chip ea" style={{ fontSize: '10px' }}>Invited</span>
                    )}
                  </div>
                  <div style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {entry.country_code && (
                      <span>{entry.location ? `${entry.location} · ${entry.country_code}` : entry.country_code}</span>
                    )}
                    {entry.platform && <span>{entry.platform.toUpperCase()}</span>}
                    <span style={{ marginLeft: 'auto' }}>
                      Joined {new Date(entry.joined_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Up / down reorder buttons — only for 'waiting' entries */}
                {entry.status === 'waiting' && (() => {
                  const waitingOnly = waitlistOnly.filter(e => e.status === 'waiting');
                  const waitingIdx = waitingOnly.findIndex(e => e.user_id === entry.user_id);
                  const atTop = waitingIdx === 0;
                  const atBottom = waitingIdx === waitingOnly.length - 1;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <button
                        onClick={() => handleMove(entry, 'up')}
                        disabled={atTop || reorderWaitlist.isPending}
                        title="Move up"
                        style={{
                          width: '26px', height: '26px', border: '1px solid var(--rule)',
                          borderRadius: '4px', background: '#fff', cursor: atTop ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '11px', color: atTop ? 'var(--rule)' : 'var(--steel)',
                          padding: 0, lineHeight: 1,
                        }}
                      >▲</button>
                      <button
                        onClick={() => handleMove(entry, 'down')}
                        disabled={atBottom || reorderWaitlist.isPending}
                        title="Move down"
                        style={{
                          width: '26px', height: '26px', border: '1px solid var(--rule)',
                          borderRadius: '4px', background: '#fff', cursor: atBottom ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '11px', color: atBottom ? 'var(--rule)' : 'var(--steel)',
                          padding: 0, lineHeight: 1,
                        }}
                      >▼</button>
                    </div>
                  );
                })()}
              </div>
              <div style={{ display: 'flex', gap: '8px', paddingLeft: '40px' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => handleWaitlistAccept(entry)}
                  disabled={acceptApplicant.isPending}
                  style={{ background: '#1F7A4C', borderColor: '#1F7A4C', padding: '6px 10px', fontSize: '11px' }}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => { setDecliningSignupId(reviewId); setDeclineNote(''); }}
                  disabled={declineApplicant.isPending || decliningSignupId !== null}
                  style={{ color: 'var(--goal)', borderColor: 'var(--goal)', padding: '6px 10px', fontSize: '11px' }}
                >
                  Decline
                </button>
              </div>
              {(entry.preferred_seats?.length ?? 0) > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: '40px' }}>
                  {entry.preferred_seats?.map(seat => (
                    <span className="chip ea" key={seat.team_season_id}>
                      {seat.franchise_name}{seat.club_abbrev ? ` · ${seat.club_abbrev}` : ''}
                    </span>
                  ))}
                </div>
              )}
              {decliningSignupId === reviewId && (
                <form onSubmit={event => handleWaitlistDecline(event, entry)} style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '40px' }}>
                  <label htmlFor={`decline-note-${reviewId}`} style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)', textTransform: 'uppercase' }}>
                    Decline note (optional)
                  </label>
                  <textarea
                    id={`decline-note-${reviewId}`}
                    value={declineNote}
                    onChange={event => setDeclineNote(event.target.value)}
                    maxLength={500}
                    rows={2}
                    autoFocus
                    placeholder="Add a brief note for your records"
                    style={{ width: '100%', padding: '8px', fontFamily: 'var(--body)', fontSize: '12px', border: '1px solid var(--rule)', borderRadius: '4px', resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="submit" className="btn ghost" disabled={declineApplicant.isPending} style={{ color: 'var(--goal)', borderColor: 'var(--goal)', padding: '6px 10px', fontSize: '11px' }}>
                      {declineApplicant.isPending ? 'Declining…' : 'Confirm decline'}
                    </button>
                    <button type="button" className="btn ghost" disabled={declineApplicant.isPending} onClick={() => { setDecliningSignupId(null); setDeclineNote(''); }} style={{ padding: '6px 10px', fontSize: '11px' }}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              </div>
            );})}
          </div>
        )}
      </div>
    </div>
    </>
  );
}

function DiscoveryTab({ leagueId }: { leagueId: string }) {
  const queryClient = useQueryClient();
  const { data: listing, isLoading } = useGetLeagueListing(leagueId);
  const { data: seasonsData } = useListSeasons(leagueId);
  const updateListing = useUpdateLeagueListing();

  // True only when there is at least one is_active season
  const hasActiveSeason = (seasonsData?.data ?? []).some(
    (s: { is_active?: boolean }) => s.is_active
  );

  const [isListed, setIsListed] = React.useState(false);
  const [acceptingSignups, setAcceptingSignups] = React.useState(false);
  const [acceptingWaitlist, setAcceptingWaitlist] = React.useState(true);
  const [blurb, setBlurb] = React.useState('');
  const [platform, setPlatform] = React.useState('');
  const [competitiveness, setCompetitiveness] = React.useState('');
  const [suggestedDivision, setSuggestedDivision] = React.useState('');
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = React.useState(false);
  const [initialised, setInitialised] = React.useState(false);

  // Sync state once data loads
  React.useEffect(() => {
    if (listing && !initialised) {
      setIsListed(listing.is_listed ?? false);
      setAcceptingSignups(listing.accepting_signups ?? false);
      setAcceptingWaitlist(listing.accepting_waitlist ?? true);
      setBlurb(listing.blurb ?? '');
      setPlatform(listing.platform ?? '');
      setCompetitiveness(listing.competitiveness ?? '');
      setSuggestedDivision(listing.suggested_division ?? '');
      setInitialised(true);
    }
  }, [listing, initialised]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);
    const data: UpdateLeagueListingInput = {
      is_listed: isListed,
      accepting_signups: acceptingSignups,
      accepting_waitlist: acceptingWaitlist,
      blurb: blurb.trim() || null,
      platform: platform === 'playstation' || platform === 'xbox' || platform === 'crossplay'
        ? platform
        : null,
      competitiveness: competitiveness === 'casual' || competitiveness === 'competitive' || competitiveness === 'hardcore'
        ? competitiveness
        : null,
      suggested_division: suggestedDivision || null,
    };
    updateListing.mutate(
      {
        leagueId,
        data,
      },
      {
        onSuccess: () => {
          setSaveSuccess(true);
          queryClient.invalidateQueries({ queryKey: getGetLeagueListingQueryKey(leagueId) });
          setTimeout(() => setSaveSuccess(false), 3000);
        },
        onError: (err: unknown) => {
          setSaveError(err instanceof Error ? err.message : 'Failed to save');
        },
      }
    );
  };

  if (isLoading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>Loading…</div>;
  }

  const fieldStyle = {
    width: '100%',
    padding: '10px 12px',
    fontFamily: 'var(--body)',
    fontSize: '14px',
    border: '1px solid var(--rule)',
    borderRadius: '3px',
    background: '#FAFCFD',
  };

  const selectStyle = { ...fieldStyle, cursor: 'pointer' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '26px', alignItems: 'start' }}>
      <form onSubmit={handleSave} className="panel">
        <div className="panel-head">
          <h2>Open Leagues Directory</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {isListed && <span className="chip conf" style={{ fontSize: '10px' }}>Listed</span>}
            {!isListed && <span className="chip" style={{ fontSize: '10px', background: 'var(--steel)', color: '#fff' }}>Unlisted</span>}
          </div>
        </div>
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* ── No-active-season warning */}
          {isListed && !hasActiveSeason && (
            <div style={{
              padding: '12px 16px',
              background: '#FEF3C7',
              border: '1px solid #F59E0B',
              borderRadius: '6px',
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: '16px', flexShrink: 0, fontWeight: 700, color: '#92400E' }}>!</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#92400E' }}>
                  No active season
                </div>
                <div style={{ fontFamily: 'var(--data)', fontSize: '11px', color: '#92400E', marginTop: '3px', lineHeight: 1.5 }}>
                  Applicants won't be able to see seat availability until you create and activate a season.
                  Saving with listing turned on will be blocked until a season is active.
                </div>
              </div>
            </div>
          )}

          {/* ── List toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: isListed ? '#F0FAF5' : '#F6F8FA', borderRadius: '6px', border: `1px solid ${isListed ? '#A3D9BC' : 'var(--rule)'}` }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '15px' }}>List on Open Leagues page</div>
              <div style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', marginTop: '3px' }}>
                When enabled, fans can discover and apply to your league.
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                role="switch"
                aria-label="List on Open Leagues page"
                checked={isListed}
                onChange={event => setIsListed(event.target.checked)}
                style={{
                  width: '44px', height: '24px', borderRadius: '12px', position: 'relative', cursor: 'pointer',
                  background: isListed ? 'var(--crease)' : 'var(--steel)',
                  transition: 'background .2s',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontFamily: 'var(--data)', fontSize: '12px', color: isListed ? 'var(--crease)' : 'var(--steel)', fontWeight: 600 }}>
                {isListed ? 'ON' : 'OFF'}
              </span>
            </label>
          </div>

          {/* ── Recruiting pitch */}
          <div>
            <label style={{ display: 'block', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '6px' }}>
              Recruiting Pitch
            </label>
            <textarea
              value={blurb}
              onChange={e => setBlurb(e.target.value)}
              placeholder="Describe what makes your league great. What kind of players are you looking for?"
              maxLength={500}
              rows={3}
              style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.5 }}
            />
            <div style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)', marginTop: '4px', textAlign: 'right' }}>
              {blurb.length}/500
            </div>
          </div>

          {/* ── Platform + Competitiveness */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '6px' }}>
                Platform
              </label>
              <select value={platform} onChange={e => setPlatform(e.target.value)} style={selectStyle}>
                <option value="">Any / Not specified</option>
                <option value="playstation">PlayStation (PSN)</option>
                <option value="xbox">Xbox</option>
                <option value="crossplay">Cross-play (Both)</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '6px' }}>
                Competitiveness
              </label>
              <select value={competitiveness} onChange={e => setCompetitiveness(e.target.value)} style={selectStyle}>
                <option value="">Not specified</option>
                <option value="casual">Casual</option>
                <option value="competitive">Competitive</option>
                <option value="hardcore">Hardcore</option>
              </select>
            </div>
          </div>

          {/* ── Suggested division */}
          <div>
            <label style={{ display: 'block', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '6px' }}>
              Suggested Skill Division
            </label>
            <select value={suggestedDivision} onChange={e => setSuggestedDivision(e.target.value)} style={selectStyle}>
              <option value="">Not specified</option>
              <option value="bronze">Bronze</option>
              <option value="silver">Silver</option>
              <option value="gold">Gold</option>
              <option value="platinum">Platinum</option>
              <option value="diamond">Diamond</option>
              <option value="elite">Elite</option>
              <option value="ultimate">Ultimate</option>
            </select>
            <div style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)', marginTop: '4px' }}>
              Optional guidance for applicants — not an enforced gate.
            </div>
          </div>

          {/* ── Sign-up & waitlist toggles */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '12px', border: '1px solid var(--rule)', borderRadius: '4px' }}>
              <input
                type="checkbox"
                checked={acceptingSignups}
                onChange={e => setAcceptingSignups(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: 'var(--crease)', cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600 }}>Accepting Sign-ups</div>
                <div style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>Direct applications for open seats</div>
              </div>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '12px', border: '1px solid var(--rule)', borderRadius: '4px' }}>
              <input
                type="checkbox"
                checked={acceptingWaitlist}
                onChange={e => setAcceptingWaitlist(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: 'var(--crease)', cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600 }}>Accepting Waitlist</div>
                <div style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>Queue for future openings</div>
              </div>
            </label>
          </div>

          {/* ── Save */}
          {saveError && (
            <div style={{ background: '#FCF2F0', border: '1px solid #E5B8B1', borderRadius: '3px', padding: '10px 14px', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--goal)' }}>
              {saveError}
            </div>
          )}
          {saveSuccess && (
            <div style={{ background: '#F0FAF5', border: '1px solid #A3D9BC', borderRadius: '3px', padding: '10px 14px', fontFamily: 'var(--data)', fontSize: '11px', color: '#1F7A4C' }}>
              Listing settings saved!
            </div>
          )}
          <div>
            <button type="submit" className="btn" disabled={updateListing.isPending}>
              {updateListing.isPending ? 'Saving…' : 'Save Discovery Settings'}
            </button>
          </div>
        </div>
      </form>

      {/* ── Info panel */}
      <div className="panel">
        <div className="panel-head"><h2>How it works</h2></div>
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', fontFamily: 'var(--data)', fontSize: '12px', color: 'var(--steel)', lineHeight: 1.6 }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>Discovery</div>
            When listed, your league appears on the public <strong>Open Leagues</strong> page at <code>/leagues/open</code> so fans can find you.
          </div>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>Sign-ups</div>
            Enable <em>Accepting Sign-ups</em> so fans can submit an application. You review and approve them in the <strong>Join Requests</strong> tab.
          </div>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>Waitlist</div>
            If seats are full, enable the waitlist so fans can queue for future openings.
          </div>
          <div style={{ borderTop: '1px solid var(--rule)', paddingTop: '12px' }}>
            You can unlist your league at any time. Existing members are unaffected.
          </div>
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
  const { data: settingsResponse } = useGetLeagueSettings(leagueId);
  const settings = activeSettingsFromResponse(settingsResponse);
  const { data: settingsHistory } = useListLeagueSettingsHistory(leagueId);

  // Pick first season by default
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
    { query: { enabled: !!activeSeason?.id, queryKey: getListWeeksQueryKey(activeSeason?.id ?? '') } }
  );
  const weeks = weeksData?.data ?? [];

  const generate = useGenerateSchedule();
  const [genError, setGenError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedStartDate, setAdvancedStartDate] = useState('');

  const handleGenerate = () => {
    if (!activeSeason || !seasonSettings) return;
    setGenError(null);
    const startDate = advancedStartDate || (activeSeason.starts_on
      ? activeSeason.starts_on.slice(0, 10)
      : new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10));
    if (!confirm(`Generate schedule from season settings version ${seasonSettings.version}?\n\nStarts: ${startDate}\nFormat: ${seasonSettings.schedule_format.replaceAll('_', ' ')}\n\nThis cannot be undone.`)) return;
    generate.mutate(
      { seasonId: activeSeason.id, data: { start_date: startDate } },
      {
        onSuccess: () => qc.invalidateQueries({ queryKey: getListWeeksQueryKey(activeSeason.id) }),
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
          {seasons.map(s => (
            <button key={s.id} className={`btn ${s.id === selectedSeasonId ? '' : 'ghost'}`}
              onClick={() => setSelectedSeasonId(s.id)} style={{ fontSize: '12px', padding: '5px 12px' }}>
              {s.label || s.id.slice(0, 8)}
            </button>
          ))}
        </div>
      )}

      {noSchedule && (
        <div className="panel" style={{ maxWidth: '480px' }}>
          <div className="panel-head"><h2>No Schedule Yet</h2></div>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontFamily: 'var(--data)', fontSize: '12px', color: 'var(--steel)', lineHeight: 1.6 }}>
              {seasonSettings
                ? <>Generation uses season settings version {seasonSettings.version}: {seasonSettings.schedule_format.replaceAll('_', ' ')}, {String(activeSeason?.games_per_matchup ?? seasonSettings.schedule_settings.games_per_matchup ?? 1)} game(s) per matchup, {String(seasonSettings.schedule_settings.week_duration_days ?? 7)} day weeks.</>
                : <>Create active league settings before generating a schedule.</>}
            </div>
            {genError && (
              <div style={{ background: '#FCF2F0', border: '1px solid #E5B8B1', borderRadius: '3px', padding: '10px 14px', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--goal)' }}>
                {genError}
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button className="btn" onClick={handleGenerate} disabled={generate.isPending || !seasonSettings}>
                {generate.isPending ? 'Generating…' : 'Generate Schedule'}
              </button>
              <button type="button" className="btn ghost" onClick={() => setShowAdvanced(value => !value)}>
                Advanced Options
              </button>
            </div>
            {showAdvanced && (
              <div style={{ padding: 12, border: '1px solid var(--rule)', background: '#FAFCFD' }}>
                <label style={{ display: 'block', fontFamily: 'var(--data)', fontSize: 10, color: 'var(--steel)', textTransform: 'uppercase', marginBottom: 6 }}>Schedule start date</label>
                <input type="date" value={advancedStartDate} onChange={event => setAdvancedStartDate(event.target.value)} style={{ padding: '8px 10px', border: '1px solid var(--rule)', borderRadius: 3 }} />
                <div style={{ marginTop: 6, color: 'var(--steel)', fontSize: 11 }}>Leave blank to use the season start date or one week from today.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {weeks.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>Week Windows</h2>
            <span className="note">{weeks.length} weeks · {weeks.reduce((sum, week) => sum + week.games.total, 0)} games</span>
            <Link href={`/leagues/${leagueId}/schedule`} className="btn ghost" style={{ fontSize: '11px', padding: '4px 10px', marginLeft: 'auto' }}>
              Full View
            </Link>
          </div>
          {weeks.slice(0, 8).map((week: WeekWindow) => {
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


function CommunicationsTab({ leagueId }: { leagueId: string }) {
  const queryClient = useQueryClient();
  const { data: webhooksData, isLoading: isLoadingWebhooks } = useListDiscordWebhooks(leagueId);
  const webhooks = webhooksData?.data || [];

  const createAnnouncement = useCreateAnnouncement();
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');

  const createWebhook = useCreateDiscordWebhook();
  const updateWebhook = useUpdateDiscordWebhook();
  const deleteWebhook = useDeleteDiscordWebhook();
  const testWebhook = useTestDiscordWebhook();

  const [webhookName, setWebhookName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookFilters, setWebhookFilters] = useState<DiscordEventFilter[]>(['commissioner.announcement']);
  const [editingWebhookId, setEditingWebhookId] = useState<string | null>(null);

  const filterOptions: Array<{ value: DiscordEventFilter; label: string }> = [
    { value: 'commissioner.announcement', label: 'Announcements' },
    { value: 'result.reported', label: 'Result Reported' },
    { value: 'result.confirmed', label: 'Result Confirmed' },
    { value: 'result.disputed', label: 'Result Disputed' },
    { value: 'schedule.generated', label: 'Schedule Published' },
    { value: 'schedule.window_shifted', label: 'Game Window Changed' },
    { value: 'schedule.game_postponed', label: 'Game Postponed' },
    { value: 'schedule.game_resolved', label: 'Game Force-Resolved' },
    { value: 'trade.proposed', label: 'Trade Proposed' },
    { value: 'trade.executed', label: 'Trade Executed' },
    { value: 'signing', label: 'Player Signed' },
    { value: 'waiver.claim', label: 'Waiver Claim' },
  ];

  const handleSendAnnouncement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirm('Send this announcement to the entire league?')) return;
    createAnnouncement.mutate({ leagueId, data: { title: announcementTitle, body: announcementBody } }, {
      onSuccess: () => {
        setAnnouncementTitle('');
        setAnnouncementBody('');
        alert('Announcement queued for delivery.');
      }
    });
  };

  const handleSaveWebhook = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingWebhookId) {
      updateWebhook.mutate({
        leagueId,
        webhookId: editingWebhookId,
        data: { name: webhookName, url: webhookUrl || undefined, event_filters: webhookFilters }
      }, {
        onSuccess: () => {
          setEditingWebhookId(null);
          setWebhookName('');
          setWebhookUrl('');
          setWebhookFilters(['commissioner.announcement']);
          queryClient.invalidateQueries({ queryKey: getListDiscordWebhooksQueryKey(leagueId) });
        }
      });
    } else {
      createWebhook.mutate({
        leagueId,
        data: { name: webhookName, url: webhookUrl, event_filters: webhookFilters }
      }, {
        onSuccess: () => {
          setWebhookName('');
          setWebhookUrl('');
          setWebhookFilters(['commissioner.announcement']);
          queryClient.invalidateQueries({ queryKey: getListDiscordWebhooksQueryKey(leagueId) });
        }
      });
    }
  };

  const handleEditWebhook = (webhook: DiscordWebhook) => {
    setEditingWebhookId(webhook.id);
    setWebhookName(webhook.name);
    setWebhookUrl('');
    setWebhookFilters(webhook.event_filters);
  };

  const handleDeleteWebhook = (id: string) => {
    if (!confirm('Delete this webhook?')) return;
    deleteWebhook.mutate({ leagueId, webhookId: id }, {
      onSuccess: () => {
        if (editingWebhookId === id) {
          setEditingWebhookId(null);
          setWebhookName('');
          setWebhookUrl('');
          setWebhookFilters(['commissioner.announcement']);
        }
        queryClient.invalidateQueries({ queryKey: getListDiscordWebhooksQueryKey(leagueId) });
      }
    });
  };

  const handleToggleWebhook = (webhook: DiscordWebhook) => {
    updateWebhook.mutate({
      leagueId,
      webhookId: webhook.id,
      data: { enabled: !webhook.enabled }
    }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListDiscordWebhooksQueryKey(leagueId) })
    });
  };

  const handleTestWebhook = (id: string) => {
    testWebhook.mutate({ leagueId, webhookId: id }, {
      onSuccess: () => alert('Test notification queued.'),
      onError: (err: unknown) => alert(err instanceof Error ? err.message : 'Test failed.')
    });
  };

  const toggleFilter = (val: DiscordEventFilter) => {
    setWebhookFilters(prev => prev.includes(val) ? prev.filter(f => f !== val) : [...prev, val]);
  };

  return (
    <div className="notification-comms-grid">
      <div className="panel">
        <div className="panel-head">
          <h2>Send Announcement</h2>
        </div>
        <form onSubmit={handleSendAnnouncement} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '6px' }}>
              Title
            </label>
            <input
              type="text"
              value={announcementTitle}
              onChange={e => setAnnouncementTitle(e.target.value)}
              required
              maxLength={160}
              data-testid="input-announcement-title"
              style={{ width: '100%', padding: '10px 12px', fontFamily: 'var(--body)', fontSize: '14px', border: '1px solid var(--rule)', borderRadius: '3px' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '6px' }}>
              Message
            </label>
            <textarea
              value={announcementBody}
              onChange={e => setAnnouncementBody(e.target.value)}
              required
              maxLength={4000}
              rows={5}
              data-testid="input-announcement-body"
              style={{ width: '100%', padding: '10px 12px', fontFamily: 'var(--body)', fontSize: '14px', border: '1px solid var(--rule)', borderRadius: '3px', resize: 'vertical' }}
            />
          </div>
          <button type="submit" className="btn" data-testid="button-send-announcement" disabled={createAnnouncement.isPending || !announcementTitle || !announcementBody}>
            {createAnnouncement.isPending ? 'Sending...' : 'Send to League'}
          </button>
          {createAnnouncement.isError && (
            <div className="notification-error" data-testid="status-announcement-error">
              The announcement could not be queued. Try again.
            </div>
          )}
        </form>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Discord Webhooks</h2>
          <div className="note">{webhooks.length} / 5</div>
        </div>
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {isLoadingWebhooks ? (
            <div style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px', textAlign: 'center' }}>Loading webhooks...</div>
           ) : webhooksData == null ? (
             <div className="notification-error" data-testid="status-webhooks-error">Discord webhooks could not be loaded.</div>
          ) : webhooks.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {webhooks.map((wh: DiscordWebhook) => (
                <div key={wh.id} data-testid={"row-webhook-" + wh.id} style={{ border: '1px solid var(--rule)', borderRadius: '4px', padding: '12px', background: wh.enabled ? '#fff' : '#f9f9f9', opacity: wh.enabled ? 1 : 0.7 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px' }}>{wh.name}</div>
                      <div style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', marginTop: '2px', wordBreak: 'break-all' }}>{wh.masked_url}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {wh.disabled_at && <span className="chip" style={{ background: 'var(--goal)', color: '#fff', border: 'none' }}>Failing</span>}
                      {!wh.enabled && !wh.disabled_at && <span className="chip">Disabled</span>}
                      {wh.enabled && <span className="chip conf">Active</span>}
                    </div>
                  </div>

                  <div style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)', marginBottom: '12px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {wh.event_filters.map(f => (
                      <span key={f} style={{ background: 'var(--rule)', padding: '2px 6px', borderRadius: '2px' }}>{f}</span>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button onClick={() => handleToggleWebhook(wh)} data-testid={"button-toggle-webhook-" + wh.id} className="btn ghost" style={{ fontSize: '10px', padding: '4px 8px' }}>
                      {wh.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button onClick={() => handleEditWebhook(wh)} data-testid={"button-edit-webhook-" + wh.id} className="btn ghost" style={{ fontSize: '10px', padding: '4px 8px' }}>Edit</button>
                    <button onClick={() => handleTestWebhook(wh.id)} data-testid={"button-test-webhook-" + wh.id} className="btn ghost" style={{ fontSize: '10px', padding: '4px 8px' }} disabled={testWebhook.isPending}>Test</button>
                    <button onClick={() => handleDeleteWebhook(wh.id)} data-testid={"button-delete-webhook-" + wh.id} className="btn ghost" style={{ fontSize: '10px', padding: '4px 8px', color: 'var(--goal)' }}>Delete</button>
                  </div>
                  {wh.failure_count > 0 && <div style={{ fontSize: '10px', color: 'var(--goal)', marginTop: '8px' }}>Failed {wh.failure_count} times recently</div>}
                </div>
              ))}
            </div>
          ) : (
             <div style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px', textAlign: 'center' }}>No webhooks configured.</div>
          )}

          <div style={{ borderTop: '1px solid var(--rule)', paddingTop: '20px' }}>
            <h3 style={{ fontSize: '14px', marginBottom: '12px', textTransform: 'uppercase', fontFamily: 'var(--display)', letterSpacing: '.04em' }}>
              {editingWebhookId ? 'Edit Webhook' : webhooks.length >= 5 ? 'Webhook Limit Reached (Max 5)' : 'Add Webhook'}
            </h3>
            {(!editingWebhookId && webhooks.length >= 5) ? (
              <div style={{ fontSize: '13px', color: 'var(--steel)' }}>You have reached the maximum of 5 webhooks for this league. Please delete one to add a new one.</div>
            ) : (
            <form onSubmit={handleSaveWebhook} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '6px' }}>Name</label>
                <input type="text" value={webhookName} onChange={e => setWebhookName(e.target.value)} required maxLength={100} placeholder="e.g. Main Channel" data-testid="input-webhook-name" style={{ width: '100%', padding: '8px 10px', fontFamily: 'var(--body)', fontSize: '13px', border: '1px solid var(--rule)', borderRadius: '3px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '6px' }}>URL</label>
                <input type="url" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} required={!editingWebhookId} placeholder={editingWebhookId ? 'Leave blank to keep existing URL' : 'https://discord.com/api/webhooks/...'} data-testid="input-webhook-url" style={{ width: '100%', padding: '8px 10px', fontFamily: 'var(--body)', fontSize: '13px', border: '1px solid var(--rule)', borderRadius: '3px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '6px' }}>Events</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {filterOptions.map(opt => (
                    <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={webhookFilters.includes(opt.value)} onChange={() => toggleFilter(opt.value)} data-testid={"checkbox-webhook-filter-" + opt.value} style={{ accentColor: 'var(--crease)' }} />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button type="submit" className="btn" data-testid="button-save-webhook" disabled={webhookFilters.length === 0 || createWebhook.isPending || updateWebhook.isPending}>
                  {editingWebhookId ? 'Update Webhook' : 'Add Webhook'}
                </button>
                {editingWebhookId && (
                  <button type="button" className="btn ghost" data-testid="button-cancel-webhook-edit" onClick={() => { setEditingWebhookId(null); setWebhookName(''); setWebhookUrl(''); setWebhookFilters(['commissioner.announcement']); }}>Cancel</button>
                )}
              </div>
              {(createWebhook.isError || updateWebhook.isError) && (
                <div className="notification-error" data-testid="status-webhook-save-error">
                  The webhook could not be saved. Verify the Discord URL and try again.
                </div>
              )}
            </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type ManageTab = 'seats'|'rulebook'|'schedule'|'settings'|'links'|'discovery'|'applicants'|'communications';

function initialManageTab(): ManageTab {
  const tab = new URLSearchParams(window.location.search).get('tab');
  return ['seats', 'rulebook', 'schedule', 'settings', 'links', 'discovery', 'applicants', 'communications'].includes(tab ?? '')
    ? tab as ManageTab
    : 'seats';
}

export default function ManageLeague() {

  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<ManageTab>(initialManageTab);
  
  const { isLoaded, isSignedIn } = useAuth();
  const { data: league, isLoading: isLoadingLeague } = useGetLeague(id || '');
  const { data: seasonsData } = useListSeasons(id || '');
  const activeSeason = (seasonsData?.data ?? []).find((season) => season.is_active);

  if (!isLoaded || isLoadingLeague) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (!isSignedIn || !league) {
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
          {activeSeason && (
            <div className="eyebrow" style={{ marginTop: '8px', color: 'var(--ice)' }}>
              Active season · {activeSeason.label}
            </div>
          )}
        </div>
      </div>
      <div className="wrap" style={{ paddingTop: '20px', paddingBottom: '60px' }}>
        <div className="manage-tabs" style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid var(--rule)', paddingBottom: '12px' }}>
          <button
            onClick={() => setActiveTab('seats')}
            className={`btn ${activeTab !== 'seats' ? 'ghost' : ''}`}
          >
            Franchise Seats
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
          <button
            onClick={() => setActiveTab('settings')}
            className={`btn ${activeTab !== 'settings' ? 'ghost' : ''}`}
          >
            Settings
          </button>
          <button 
            onClick={() => setActiveTab('links')}
            className={`btn ${activeTab !== 'links' ? 'ghost' : ''}`}
          >
            Links
          </button>
          <button 
            onClick={() => setActiveTab('discovery')}
            className={`btn ${activeTab !== 'discovery' ? 'ghost' : ''}`}
          >
            Discovery
          </button>
          <button 
            onClick={() => setActiveTab('applicants')}
            className={`btn ${activeTab !== 'applicants' ? 'ghost' : ''}`}
          >
            Applicants
          </button>
          <button
            onClick={() => setActiveTab('communications')}
            className={`btn ${activeTab !== 'communications' ? 'ghost' : ''}`}
          >
            Comms
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>

            <Link href={`/leagues/${league.id}/dq`} className="btn ghost" style={{ borderColor: 'var(--steel)', fontSize: '12px' }}>
              DQ
            </Link>
            <Link href={`/leagues/${league.id}/season/new`} className="btn ghost" style={{ borderColor: 'var(--steel)' }}>
              + New Season
            </Link>
          </div>
        </div>

        {activeTab === 'seats' && <SeatsTab leagueId={league.id} />}
        {activeTab === 'rulebook' && <RulebookTab leagueId={league.id} />}
        {activeTab === 'schedule' && (
          <ScheduleTab leagueId={league.id} />
        )}
        {activeTab === 'settings' && <LeagueSettings leagueId={league.id} editable />}
        {activeTab === 'links' && (
          <LinksTab leagueId={league.id} leagueSlug={league.slug} />
        )}
        {activeTab === 'discovery' && (
          <DiscoveryTab leagueId={league.id} />
        )}

        {activeTab === 'applicants' && (
          <ApplicantsTab leagueId={league.id} />
        )}
        {activeTab === 'communications' && (
          <CommunicationsTab leagueId={league.id} />
        )}

      </div>
    </>
  );
}
