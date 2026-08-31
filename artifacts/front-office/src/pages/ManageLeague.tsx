import React, { useEffect, useState } from 'react';
import { useLocation, useParams, useSearch, Link } from 'wouter';
import { 
  useGetLeague, 
  useListSeats,
  useListUnassignedMembers,
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
  useGetLeagueSettings,
  useListLeagueSettingsHistory,
  useGetCommissionerInvite,
  useCreateCommissionerInvite,
  useRotateCommissionerInvite,
  useUpdateCommissionerInvite,
  useRevokeCommissionerInvite,
  useSetPublicCode,
  useGetLeagueListing,
  useUpdateLeagueListing,
  useListLeagueSignups,
  useListLeagueWaitlist,
  useAcceptApplicant,
  useDeclineApplicant,
  useReorderWaitlistEntry,
  Seat,
  JoinRequest,
  InviteLink,
  LeagueApplicant,
  WaitlistApplicant,
   RulebookRevision,
   AssignedGm,
   UnassignedMember,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';
import Header from '@/components/Header';
import { gmIdentityLabel } from '@/components/gmIdentity';
import LeagueSettings, { hasSettings } from '@/components/LeagueSettings';
import SetupChecklist from '@/components/SetupChecklist';
import OperationsTab from '@/components/OperationsTab';

// Helper components

/** "12-8-2" once OT/SO losses exist, else the plain "12-8" most leagues expect. */
function formatGmRecord(record?: { w: number; l: number; otl: number } | null): string | null {
  if (!record) return null;
  if (record.w === 0 && record.l === 0 && record.otl === 0) return null;
  return record.otl > 0 ? `${record.w}-${record.l}-${record.otl}` : `${record.w}-${record.l}`;
}

export function SeatGmLabel({ gm, seatId }: { gm: AssignedGm; seatId: string }) {
  const identity = gmIdentityLabel(gm);
  const name = gm.display_name || 'Unknown GM';
  const leagueRecord = formatGmRecord(gm.league_record);
  const siteRecord = formatGmRecord(gm.site_record);
  const hasFacts = Boolean(gm.first_nhl_game || leagueRecord || siteRecord);

  return (
    <div className="gm-card" data-testid={`text-seat-gm-${seatId}`}>
      <span className="gm-card-avatar" aria-hidden="true">
        {gm.profile_image_url ? (
          <img
            src={gm.profile_image_url}
            alt=""
            loading="lazy"
            onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
          />
        ) : (
          <span className="gm-card-avatar-fallback">{name.charAt(0).toUpperCase()}</span>
        )}
      </span>
      <div className="gm-card-body">
        <div className="gm-card-pills">
          <span className="gm-card-pill gm-card-pill-name">{name}</span>
          {identity && <span className="gm-card-pill gm-card-pill-tag">{identity}</span>}
        </div>
        {hasFacts && (
          <dl className="gm-card-facts">
            {gm.first_nhl_game && (
              <div className="gm-card-fact">
                <dt>First game</dt>
                <dd>{gm.first_nhl_game}</dd>
              </div>
            )}
            {leagueRecord && (
              <div className="gm-card-fact">
                <dt>League</dt>
                <dd>{leagueRecord}</dd>
              </div>
            )}
            {siteRecord && (
              <div className="gm-card-fact">
                <dt>Site</dt>
                <dd>{siteRecord}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </div>
  );
}

function AssignGmPicker({
  seat,
  members,
  onCancel,
  onAssign,
  isPending,
}: {
  seat: Seat;
  members: UnassignedMember[];
  onCancel: () => void;
  onAssign: (userId: string) => void;
  isPending: boolean;
}) {
  const [selected, setSelected] = useState('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      {members.length === 0 ? (
        <div style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)' }}>
          No unassigned members. Accept an applicant from the Players tab first.
        </div>
      ) : (
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          autoFocus
          style={{ width: '100%', padding: '8px', fontFamily: 'var(--body)', fontSize: '13px', border: '1px solid var(--rule)', borderRadius: '4px' }}
        >
          <option value="">Select a member…</option>
          {members.map(m => {
            const identity = m.identity ? gmIdentityLabel(m.identity) : null;
            return (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name ?? m.user_id}{identity ? ` — ${identity}` : ''}
              </option>
            );
          })}
        </select>
      )}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          type="button"
          className="btn"
          disabled={!selected || isPending}
          onClick={() => onAssign(selected)}
          style={{ background: 'var(--crease)', borderColor: 'var(--crease)', padding: '6px 12px', fontSize: '12px' }}
        >
          {isPending ? 'Assigning…' : `Assign to ${seat.franchise_name}`}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={isPending}
          onClick={onCancel}
          style={{ padding: '6px 12px', fontSize: '12px' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SeatsTab({ leagueId }: { leagueId: string }) {
  const { data: seatsResponse, isLoading } = useListSeats(leagueId);
  const seats = seatsResponse?.data || [];
  const { data: membersResponse } = useListUnassignedMembers(leagueId);
  const members = membersResponse?.data || [];
  const assignGm = useAssignGm();
  const revokeGm = useRevokeGm();
  const queryClient = useQueryClient();
  const [assigningSeatId, setAssigningSeatId] = useState<string | null>(null);

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

  const invalidateSeatData = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/leagues', leagueId, 'seats'] as any });
    queryClient.invalidateQueries({ queryKey: ['/api/leagues', leagueId, 'members', 'unassigned'] as any });
  };

  const handleRevoke = (seat: Seat) => {
    if (!confirm(`Revoke GM assignment for ${seat.franchise_name}?`)) return;
    revokeGm.mutate({ teamSeasonId: seat.team_season_id }, {
      onSuccess: invalidateSeatData,
    });
  };

  const handleAssign = (seat: Seat, userId: string) => {
    if (!userId) return;
    assignGm.mutate({
      teamSeasonId: seat.team_season_id,
      data: { user_id: userId, role: 'gm' }
    }, {
      onSuccess: () => {
        setAssigningSeatId(null);
        invalidateSeatData();
      },
      onError: (err: unknown) => alert(err instanceof Error ? err.message : 'Failed to assign GM'),
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
          <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            {seat.gm ? (
              <>
                <SeatGmLabel gm={seat.gm} seatId={seat.team_season_id} />
                <button onClick={() => handleRevoke(seat)} className="btn ghost" style={{ color: 'var(--goal)', borderColor: 'var(--goal)' }}>Revoke</button>
              </>
            ) : assigningSeatId === seat.team_season_id ? (
              <AssignGmPicker
                seat={seat}
                members={members}
                isPending={assignGm.isPending}
                onCancel={() => setAssigningSeatId(null)}
                onAssign={userId => handleAssign(seat, userId)}
              />
            ) : (
              <>
                <div style={{ fontFamily: 'var(--data)', fontSize: '12px', color: 'var(--steel)' }}>
                  No GM assigned
                </div>
                <button onClick={() => setAssigningSeatId(seat.team_season_id)} className="btn" style={{ background: 'var(--crease)', borderColor: 'var(--crease)' }}>Assign GM</button>
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
              placeholder={"# League Rules\n\n1. No tanking — every team plays to win, every game.\n2. Report results within 24 hours of the final horn.\n3. Be cool."}
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

type MergedApplicant = {
  userId: string;
  reviewId: string;
  displayName: string | null;
  skillDivision: string | null;
  countryCode: string | null;
  location: string | null;
  timezone: string | null;
  platform: string | null;
  preferredClub: string | null;
  message: string | null;
  requestedAt: string;
  isSignup: boolean;
  isWaitlist: boolean;
  waitlistStatus: WaitlistApplicant['status'] | null;
  waitlistPosition: number | null;
};

function mergeApplicants(signups: LeagueApplicant[], waitlist: WaitlistApplicant[]): MergedApplicant[] {
  const byUser = new Map<string, MergedApplicant>();

  for (const s of signups) {
    byUser.set(s.user_id, {
      userId: s.user_id,
      reviewId: s.signup_id,
      displayName: s.display_name ?? null,
      skillDivision: s.skill_division ?? null,
      countryCode: s.country_code ?? null,
      location: s.location ?? null,
      timezone: s.timezone ?? null,
      platform: s.platform ?? null,
      preferredClub: s.preferred_club ?? null,
      message: s.message ?? null,
      requestedAt: s.created_at,
      isSignup: true,
      isWaitlist: Boolean(s.waitlist_status),
      waitlistStatus: (s.waitlist_status as WaitlistApplicant['status'] | null) ?? null,
      waitlistPosition: s.waitlist_position ?? null,
    });
  }

  // A waitlist entry that already matches a signup (linked by user id) only adds
  // its queue position — it must never render as a second, disconnected row.
  for (const w of waitlist) {
    const existing = byUser.get(w.user_id);
    if (existing) {
      existing.isWaitlist = true;
      existing.waitlistStatus = w.status;
      existing.waitlistPosition = w.position;
      continue;
    }
    byUser.set(w.user_id, {
      userId: w.user_id,
      reviewId: w.signup_id ?? w.waitlist_entry_id,
      displayName: w.display_name ?? null,
      skillDivision: w.skill_division ?? null,
      countryCode: w.country_code ?? null,
      location: w.location ?? null,
      timezone: w.timezone ?? null,
      platform: w.platform ?? null,
      preferredClub: null,
      message: null,
      requestedAt: w.joined_at,
      isSignup: false,
      isWaitlist: true,
      waitlistStatus: w.status,
      waitlistPosition: w.position,
    });
  }

  return Array.from(byUser.values()).sort(
    (a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime()
  );
}

type PlayersView = 'pending' | 'history';

function PlayersTab({ leagueId, leagueSlug }: { leagueId: string; leagueSlug: string }) {
  const [view, setView] = useState<PlayersView>('pending');

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        <button
          onClick={() => setView('pending')}
          className={`btn ${view !== 'pending' ? 'ghost' : ''}`}
          style={{ fontSize: '12px', padding: '6px 16px' }}
        >
          Pending
        </button>
        <button
          onClick={() => setView('history')}
          className={`btn ${view !== 'history' ? 'ghost' : ''}`}
          style={{ fontSize: '12px', padding: '6px 16px' }}
        >
          History
        </button>
      </div>
      {view === 'pending' ? <PendingPlayers leagueId={leagueId} leagueSlug={leagueSlug} /> : <PlayersHistory leagueId={leagueId} />}
    </div>
  );
}

function PendingPlayers({ leagueId, leagueSlug }: { leagueId: string; leagueSlug: string }) {
  const queryClient = useQueryClient();
  const { data: reqsResponse, isLoading: isLoadingReqs } = useListJoinRequests(leagueId, { status: 'pending' });
  const { data: invResponse, isLoading: isLoadingInv } = useListInvites(leagueId);
  const { data: signupsData, isLoading: signupsLoading } = useListLeagueSignups(leagueId);
  const { data: waitlistData, isLoading: waitlistLoading } = useListLeagueWaitlist(leagueId);
  const { data: commInviteData, isLoading: commInviteLoading } = useGetCommissionerInvite(leagueId);

  const approveReq = useApproveJoinRequest();
  const rejectReq = useRejectJoinRequest();
  const createInvite = useCreateInvite();
  const acceptApplicant = useAcceptApplicant();
  const declineApplicant = useDeclineApplicant();
  const reorderWaitlist = useReorderWaitlistEntry();
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState('');

  const createCommissionerInvite = useCreateCommissionerInvite();
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

  const invalidateCommissionerInvite = () =>
    queryClient.invalidateQueries({ queryKey: ['/api/leagues', leagueId, 'commissioner-invite'] as any });

  React.useEffect(() => {
    if (commInviteData?.public_code && !publicCodeEditing) {
      setPublicCodeInput(commInviteData.public_code ?? '');
    }
  }, [commInviteData?.public_code]);

  const requests = reqsResponse?.data ?? [];
  const invites = invResponse?.data ?? [];
  const signups = signupsData?.data ?? [];
  const waitlist = waitlistData?.data ?? [];
  const applicants = mergeApplicants(signups, waitlist);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/leagues/${leagueId}/signups`] as any });
    queryClient.invalidateQueries({ queryKey: [`/api/leagues/${leagueId}/waitlist`] as any });
  };

  const invalidateRequests = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/leagues/${leagueId}/join-requests`] as any });

  const handleApproveRequest = (req: JoinRequest) => {
    approveReq.mutate({ leagueId, requestId: req.id }, { onSuccess: invalidateRequests });
  };

  const handleRejectRequest = (req: JoinRequest) => {
    rejectReq.mutate({ leagueId, requestId: req.id }, { onSuccess: invalidateRequests });
  };

  const handleCreateInvite = () => {
    createInvite.mutate({ leagueId, data: { max_uses: null, expires_in_hours: null } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/leagues/${leagueId}/invites`] as any }),
    });
  };

  const handleCopyInvite = (token: string) => {
    const url = `${window.location.origin}/join/${token}`;
    navigator.clipboard.writeText(url);
    alert('Invite link copied!');
  };

  const commissionerInvite = commInviteData?.invite ?? null;
  const publicCode = commInviteData?.public_code ?? '';
  const commissionerInviteUrl = commissionerInvite ? `${window.location.origin}/join/${commissionerInvite.token}` : null;
  const publicCodeUrl = publicCode ? `${window.location.origin}/j/${publicCode}` : null;
  const publicPageUrl = `${window.location.origin}/l/${leagueSlug}`;

  const handleCopyCommissionerInvite = () => {
    if (commissionerInviteUrl) { navigator.clipboard.writeText(commissionerInviteUrl); alert('Invite link copied!'); }
  };
  const handleCopyCode = () => {
    navigator.clipboard.writeText(publicCode); alert('Public code copied!');
  };
  const handleCopyPublicUrl = () => {
    if (publicCodeUrl) { navigator.clipboard.writeText(publicCodeUrl); alert('Public URL copied!'); }
  };
  const handleCopyPublicPage = () => {
    navigator.clipboard.writeText(publicPageUrl); alert('Public league page URL copied!');
  };

  const handleSavePublicCode = () => {
    const code = publicCodeInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{5,12}$/.test(code)) {
      setPublicCodeError('Must be 5–12 uppercase letters/digits (e.g. RUSTBELT)');
      return;
    }
    setPublicCodeError(null);
    setPublicCode.mutate({ leagueId, data: { public_code: code } }, {
      onSuccess: () => { setPublicCodeEditing(false); invalidateCommissionerInvite(); },
      onError: (err: unknown) => setPublicCodeError(err instanceof Error ? err.message : 'Error saving code'),
    });
  };

  const handleCreateCommissionerInvite = () => {
    createCommissionerInvite.mutate({ leagueId }, {
      onSuccess: () => invalidateCommissionerInvite(),
    });
  };

  const handleRotate = () => {
    if (!confirm('Rotate the invite link? The old URL will stop working immediately.')) return;
    rotateInvite.mutate({ leagueId }, {
      onSuccess: () => invalidateCommissionerInvite(),
    });
  };

  const handleRevoke = () => {
    if (!confirm('Revoke the invite link? Anyone with the old URL will no longer be able to join.')) return;
    revokeInvite.mutate({ leagueId }, {
      onSuccess: () => invalidateCommissionerInvite(),
    });
  };

  const handleSaveCap = () => {
    const maxUses = maxUsesInput ? parseInt(maxUsesInput, 10) : null;
    const expiresAt = expiresAtInput || null;
    updateInvite.mutate({
      leagueId,
      data: { max_uses: maxUses, expires_at: expiresAt ?? undefined },
    }, {
      onSuccess: () => { setCapEditing(false); invalidateCommissionerInvite(); },
    });
  };

  // Position among 'waiting' entries only — same domain the backend reorders in.
  const waitingOnly = waitlist.filter(e => e.status === 'waiting');

  const handleMove = (applicant: MergedApplicant, direction: 'up' | 'down') => {
    const waitingIdx = waitingOnly.findIndex(e => e.user_id === applicant.userId);
    if (waitingIdx === -1) return; // invited or already resolved — no-op
    const targetPos = direction === 'up' ? waitingIdx : waitingIdx + 2;
    const clamped = Math.max(1, Math.min(targetPos, waitingOnly.length));
    reorderWaitlist.mutate(
      { leagueId, userId: applicant.userId, data: { position: clamped } },
      { onSuccess: () => invalidate(), onError: (err: unknown) => alert(err instanceof Error ? err.message : 'Failed to reorder') }
    );
  };

  const handleAccept = (applicant: MergedApplicant) => {
    if (!confirm(`Accept ${applicant.displayName ?? 'this applicant'}?\n\nThey will be added as a league member. You can assign them to a franchise seat from the Seats tab.`)) return;
    acceptApplicant.mutate({ leagueId, signupId: applicant.reviewId }, {
      onSuccess: () => invalidate(),
      onError: (err: unknown) => alert(err instanceof Error ? err.message : 'Failed to accept applicant'),
    });
  };

  const handleDecline = (event: React.FormEvent, applicant: MergedApplicant) => {
    event.preventDefault();
    declineApplicant.mutate({
      leagueId,
      signupId: applicant.reviewId,
      data: declineNote.trim() ? { note: declineNote.trim() } : undefined,
    }, {
      onSuccess: () => {
        setDecliningId(null);
        setDeclineNote('');
        invalidate();
      },
      onError: (err: unknown) => alert(err instanceof Error ? err.message : 'Failed to decline applicant'),
    });
  };

  if (isLoadingReqs || isLoadingInv || signupsLoading || waitlistLoading || commInviteLoading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>Loading players…</div>;
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
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '26px', marginBottom: '28px' }}>
        <div>
          <h3 style={{ fontFamily: 'var(--display)', fontSize: '20px', textTransform: 'uppercase', marginBottom: '16px' }}>Join Requests</h3>
          {requests.length === 0 ? (
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
                  {requests.map(req => (
                    <tr key={req.id}>
                      <td className="l" style={{ fontWeight: 600 }}>{req.display_name || req.user_id}</td>
                      <td className="l">{new Date(req.created_at).toLocaleDateString()}</td>
                      <td style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button onClick={() => handleApproveRequest(req)} className="btn" style={{ background: '#1F7A4C', borderColor: '#1F7A4C' }}>Approve</button>
                        <button onClick={() => handleRejectRequest(req)} className="btn ghost" style={{ color: 'var(--goal)' }}>Reject</button>
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
                <button onClick={() => handleCopyInvite(inv.token)} className="btn ghost">Copy Link</button>
              </div>
            ))}
            <div style={{ padding: '16px', textAlign: 'center' }}>
              <button onClick={handleCreateInvite} className="btn" style={{ width: '100%' }}>Generate New Invite</button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '26px', marginBottom: '28px' }}>
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

            <div style={{ borderTop: '1px solid var(--rule)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Public League Page</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <code style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--crease)', wordBreak: 'break-all', flex: 1 }}>{publicPageUrl}</code>
                <button onClick={handleCopyPublicPage} className="btn ghost" style={{ fontSize: '11px', padding: '4px 10px', whiteSpace: 'nowrap' }}>Copy URL</button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Commissioner Invite Link */}
        <div className="panel">
          <div className="panel-head">
            <h2>Reusable Invite Link</h2>
            {commissionerInvite && (
              <span className="chip conf" style={{ fontSize: '10px' }}>Active</span>
            )}
          </div>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', lineHeight: 1.5 }}>
              Share one link to let anyone claim a seat. Rotate it to revoke the old URL and get a fresh one.
            </div>

            {!commissionerInvite && (
              <button onClick={handleCreateCommissionerInvite} className="btn" disabled={createCommissionerInvite.isPending}>
                {createCommissionerInvite.isPending ? 'Creating…' : 'Generate Invite Link'}
              </button>
            )}

            {commissionerInvite && (
              <>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    readOnly
                    value={commissionerInviteUrl ?? ''}
                    style={{
                      flex: 1, padding: '8px 10px', fontFamily: 'var(--data)', fontSize: '11px',
                      border: '1px solid var(--rule)', borderRadius: '3px', background: '#F6F8FA',
                      color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}
                  />
                  <button onClick={handleCopyCommissionerInvite} className="btn ghost" style={{ whiteSpace: 'nowrap', fontSize: '11px', padding: '6px 12px' }}>Copy</button>
                </div>

                <div style={{ display: 'flex', gap: '16px', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)' }}>
                  <span>
                    Uses: <strong style={{ color: 'var(--ink)' }}>{commissionerInvite.uses}{commissionerInvite.max_uses ? ` / ${commissionerInvite.max_uses}` : ''}</strong>
                  </span>
                  {commissionerInvite.expires_at && (
                    <span>
                      Expires: <strong style={{ color: 'var(--ink)' }}>{new Date(commissionerInvite.expires_at).toLocaleDateString()}</strong>
                    </span>
                  )}
                  {!commissionerInvite.expires_at && !commissionerInvite.max_uses && (
                    <span style={{ color: 'var(--bulb)' }}>No cap or expiry set</span>
                  )}
                </div>

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
                    setMaxUsesInput(commissionerInvite.max_uses ? String(commissionerInvite.max_uses) : '');
                    setExpiresAtInput(commissionerInvite.expires_at ? new Date(commissionerInvite.expires_at).toISOString().slice(0, 16) : '');
                    setCapEditing(true);
                  }} className="btn ghost" style={{ fontSize: '12px', padding: '5px 12px', alignSelf: 'flex-start' }}>
                    Set Cap / Expiry
                  </button>
                )}

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

      <h3 style={{ fontFamily: 'var(--display)', fontSize: '20px', textTransform: 'uppercase', marginBottom: '16px' }}>
        Applicants
        {applicants.length > 0 && (
          <span style={{ fontFamily: 'var(--data)', fontSize: '12px', color: 'var(--steel)', fontWeight: 400, marginLeft: '10px', textTransform: 'none' }}>
            {applicants.length} pending
          </span>
        )}
      </h3>

      {applicants.length === 0 ? (
        <div className="panel" style={{ padding: '28px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>
          No sign-ups or waitlist entries yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {applicants.map((applicant) => {
            const waitingIdx = waitingOnly.findIndex(e => e.user_id === applicant.userId);
            const canReorder = applicant.waitlistStatus === 'waiting' && waitingIdx !== -1;
            const atTop = canReorder && waitingIdx === 0;
            const atBottom = canReorder && waitingIdx === waitingOnly.length - 1;

            return (
              <div key={applicant.userId} style={cardStyle}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 700, fontSize: '15px', flex: 1, minWidth: 0 }}>
                    {applicant.displayName ?? <span style={{ color: 'var(--steel)' }}>Unknown user</span>}
                  </div>
                  <DivisionBadge division={applicant.skillDivision} />
                  {applicant.isSignup && (
                    <span className="chip conf" style={{ fontSize: '10px' }}>Sign-up</span>
                  )}
                  {applicant.isWaitlist && (
                    <span className={`chip ${applicant.waitlistStatus === 'waiting' ? 'ocr' : 'conf'}`} style={{ fontSize: '10px' }}>
                      {applicant.waitlistStatus === 'invited' ? 'Waitlist · invited' : `Waitlist #${applicant.waitlistPosition}`}
                    </span>
                  )}
                </div>

                {/* Meta row */}
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)' }}>
                  {applicant.countryCode && (
                    <span title={applicant.location ?? undefined}>
                      {applicant.location ? `${applicant.location} (${applicant.countryCode})` : applicant.countryCode}
                    </span>
                  )}
                  {applicant.platform && <span>{applicant.platform.toUpperCase()}</span>}
                  {applicant.timezone && <span>{applicant.timezone}</span>}
                  {applicant.preferredClub && <span>Wants: {applicant.preferredClub}</span>}
                  <span style={{ marginLeft: 'auto' }}>
                    {applicant.isSignup ? 'Applied' : 'Joined'} {new Date(applicant.requestedAt).toLocaleDateString()}
                  </span>
                </div>

                {/* Message */}
                {applicant.message && (
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
                    "{applicant.message}"
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', paddingTop: '4px', alignItems: 'center' }}>
                  <button
                    onClick={() => handleAccept(applicant)}
                    className="btn"
                    disabled={acceptApplicant.isPending}
                    style={{ background: '#1F7A4C', borderColor: '#1F7A4C' }}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDecliningId(applicant.reviewId); setDeclineNote(''); }}
                    className="btn ghost"
                    disabled={declineApplicant.isPending || decliningId !== null}
                    style={{ color: 'var(--goal)', borderColor: 'var(--goal)' }}
                  >
                    Decline
                  </button>

                  {canReorder && (
                    <div style={{ display: 'flex', gap: '4px', marginLeft: 'auto' }}>
                      <button
                        onClick={() => handleMove(applicant, 'up')}
                        disabled={atTop || reorderWaitlist.isPending}
                        title="Move up the waitlist"
                        style={{
                          width: '26px', height: '26px', border: '1px solid var(--rule)',
                          borderRadius: '4px', background: '#fff', cursor: atTop ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '11px', color: atTop ? 'var(--rule)' : 'var(--steel)',
                          padding: 0, lineHeight: 1,
                        }}
                      >Up</button>
                      <button
                        onClick={() => handleMove(applicant, 'down')}
                        disabled={atBottom || reorderWaitlist.isPending}
                        title="Move down the waitlist"
                        style={{
                          width: '26px', height: '26px', border: '1px solid var(--rule)',
                          borderRadius: '4px', background: '#fff', cursor: atBottom ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '11px', color: atBottom ? 'var(--rule)' : 'var(--steel)',
                          padding: 0, lineHeight: 1,
                        }}
                      >Down</button>
                    </div>
                  )}
                </div>

                {decliningId === applicant.reviewId && (
                  <form
                    onSubmit={event => handleDecline(event, applicant)}
                    style={{
                      borderTop: '1px solid var(--rule)',
                      paddingTop: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <label
                      htmlFor={`decline-note-${applicant.reviewId}`}
                      style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.06em' }}
                    >
                      Decline note (optional)
                    </label>
                    <textarea
                      id={`decline-note-${applicant.reviewId}`}
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
                        onClick={() => { setDecliningId(null); setDeclineNote(''); }}
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
            );
          })}
        </div>
      )}
    </div>
  );
}

type HistoryOutcome = 'approved' | 'rejected' | 'accepted' | 'declined';

type HistoryEntry = {
  id: string;
  displayName: string | null;
  kind: 'Join Request' | 'Sign-up' | 'Waitlist';
  outcome: HistoryOutcome;
  decidedByName: string | null;
  decidedAt: string | null;
  note: string | null;
};

const HISTORY_OUTCOME_STYLE: Record<HistoryOutcome, { bg: string; color: string }> = {
  approved: { bg: '#1F7A4C', color: '#fff' },
  accepted: { bg: '#1F7A4C', color: '#fff' },
  rejected: { bg: 'var(--goal)', color: '#fff' },
  declined: { bg: 'var(--goal)', color: '#fff' },
};

function PlayersHistory({ leagueId }: { leagueId: string }) {
  const { data: reqsResponse, isLoading: isLoadingReqs } = useListJoinRequests(leagueId);
  const { data: signupsResponse, isLoading: isLoadingSignups } = useListLeagueSignups(leagueId, { status: 'resolved' });
  const { data: waitlistResponse, isLoading: isLoadingWaitlist } = useListLeagueWaitlist(leagueId, { status: 'resolved' });

  if (isLoadingReqs || isLoadingSignups || isLoadingWaitlist) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>Loading history…</div>;
  }

  const requestEntries: HistoryEntry[] = (reqsResponse?.data ?? [])
    .filter(r => r.status !== 'pending')
    .map(r => ({
      id: `jr-${r.id}`,
      displayName: r.display_name ?? null,
      kind: 'Join Request',
      outcome: r.status as HistoryOutcome,
      decidedByName: r.reviewed_by_name ?? null,
      decidedAt: r.reviewed_at ?? null,
      note: r.note ?? null,
    }));

  const signupEntries: HistoryEntry[] = (signupsResponse?.data ?? [])
    .filter(s => s.status === 'accepted' || s.status === 'declined')
    .map(s => ({
      id: `su-${s.signup_id}`,
      displayName: s.display_name ?? null,
      kind: 'Sign-up',
      outcome: s.status as HistoryOutcome,
      decidedByName: s.decided_by_name ?? null,
      decidedAt: s.decided_at ?? null,
      note: s.decision_note ?? null,
    }));

  // Waitlist-only decisions (no linked sign-up — those are already covered
  // above, since a signup-backed decision's final waitlist status rides
  // along with its signup row).
  const waitlistEntries: HistoryEntry[] = (waitlistResponse?.data ?? [])
    .filter(w => w.signup_id == null && (w.status === 'placed' || w.status === 'declined'))
    .map(w => ({
      id: `wl-${w.waitlist_entry_id}`,
      displayName: w.display_name ?? null,
      kind: 'Waitlist',
      outcome: w.status === 'placed' ? 'accepted' : 'declined',
      decidedByName: w.decided_by_name ?? null,
      decidedAt: w.resolved_at ?? null,
      note: w.decline_note ?? null,
    }));

  const entries = [...requestEntries, ...signupEntries, ...waitlistEntries].sort(
    (a, b) => new Date(b.decidedAt ?? 0).getTime() - new Date(a.decidedAt ?? 0).getTime()
  );

  if (entries.length === 0) {
    return (
      <div className="panel" style={{ padding: '28px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>
        No decisions recorded yet.
      </div>
    );
  }

  return (
    <div className="panel">
      <table style={{ textAlign: 'left' }}>
        <thead>
          <tr>
            <th className="l">User</th>
            <th className="l">Type</th>
            <th className="l">Decision</th>
            <th className="l">By</th>
            <th className="l">When</th>
            <th className="l">Note</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(entry => (
            <tr key={entry.id}>
              <td className="l" style={{ fontWeight: 600 }}>{entry.displayName ?? 'Unknown user'}</td>
              <td className="l">{entry.kind}</td>
              <td className="l">
                <span
                  className="chip"
                  style={{
                    fontSize: '10px',
                    textTransform: 'uppercase',
                    background: HISTORY_OUTCOME_STYLE[entry.outcome].bg,
                    color: HISTORY_OUTCOME_STYLE[entry.outcome].color,
                  }}
                >
                  {entry.outcome}
                </span>
              </td>
              <td className="l">{entry.decidedByName ?? '—'}</td>
              <td className="l">{entry.decidedAt ? new Date(entry.decidedAt).toLocaleDateString() : '—'}</td>
              <td className="l" style={{ maxWidth: '260px', whiteSpace: 'normal', fontStyle: entry.note ? 'italic' : undefined }}>
                {entry.note ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
    updateListing.mutate(
      {
        leagueId,
        data: {
          is_listed: isListed,
          accepting_signups: acceptingSignups,
          accepting_waitlist: acceptingWaitlist,
          blurb: blurb.trim() || null,
          platform: (platform || null) as any,
          competitiveness: (competitiveness || null) as any,
          suggested_division: suggestedDivision || null,
        },
      },
      {
        onSuccess: () => {
          setSaveSuccess(true);
          queryClient.invalidateQueries({ queryKey: [`/api/leagues/${leagueId}/listing`] as any });
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
              <span style={{ fontSize: '16px', flexShrink: 0 }}>⚠️</span>
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
              <div
                onClick={() => setIsListed(v => !v)}
                style={{
                  width: '44px', height: '24px', borderRadius: '12px', position: 'relative', cursor: 'pointer',
                  background: isListed ? 'var(--crease)' : 'var(--steel)',
                  transition: 'background .2s',
                  flexShrink: 0,
                }}
              >
                <div style={{
                  position: 'absolute', top: '3px',
                  left: isListed ? '23px' : '3px',
                  width: '18px', height: '18px', borderRadius: '50%',
                  background: '#fff', transition: 'left .2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                }} />
              </div>
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
                <option value="psn">PlayStation (PSN)</option>
                <option value="xbox">Xbox</option>
                <option value="both">Cross-play (Both)</option>
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
            <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>🔍 Discovery</div>
            When listed, your league appears on the public <strong>Open Leagues</strong> page at <code>/leagues/open</code> so fans can find you.
          </div>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>📝 Sign-ups</div>
            Enable <em>Accepting Sign-ups</em> so fans can submit an application. You review and approve them in the <strong>Join Requests</strong> tab.
          </div>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>⏳ Waitlist</div>
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
  const settings = hasSettings(settingsResponse) ? settingsResponse : undefined;
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
    { query: { enabled: !!activeSeason?.id } as any }
  );
  const weeks = (weeksData as any)?.data ?? [];

  const generate = useGenerateSchedule();
  const [genError, setGenError] = useState<string | null>(null);

  const handleGenerate = () => {
    if (!activeSeason || !seasonSettings) return;
    setGenError(null);
    const startDate = activeSeason.starts_on
      ? activeSeason.starts_on.slice(0, 10)
      : new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    if (!confirm(`Generate schedule from season settings version ${seasonSettings.version}?\n\nStarts: ${startDate}\nFormat: ${seasonSettings.schedule_format.replaceAll('_', ' ')}\n\nThis cannot be undone.`)) return;
    generate.mutate(
      { seasonId: activeSeason.id, data: { start_date: startDate } },
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
              {seasonSettings
                ? <>Generation uses season settings version {seasonSettings.version}: {seasonSettings.schedule_format.replaceAll('_', ' ')}, {String(seasonSettings.schedule_settings.games_per_matchup ?? 1)} game(s) per matchup, {String(seasonSettings.schedule_settings.week_duration_days ?? 7)} day weeks.</>
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
              <Link href={`/leagues/${leagueId}/schedule`} className="btn ghost">
                Open Schedule Page
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

type ManageTab = 'seats'|'players'|'rulebook'|'schedule'|'settings'|'discovery'|'operations';
const MANAGE_TABS: ManageTab[] = ['seats', 'players', 'rulebook', 'schedule', 'settings', 'discovery', 'operations'];

export default function ManageLeague() {
  const { id } = useParams<{ id: string }>();
  const search = useSearch();
  const [activeTab, setActiveTab] = useState<ManageTab>('seats');

  // Lets a "why isn't this done yet" link (e.g. the setup checklist) land on
  // the right tab instead of always the default.
  useEffect(() => {
    const requested = new URLSearchParams(search).get('tab');
    if (requested && (MANAGE_TABS as string[]).includes(requested)) {
      setActiveTab(requested as ManageTab);
    }
  }, [search]);

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
              {activeSeason.starts_on && (
                <> · Starts {new Date(activeSeason.starts_on).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="wrap" style={{ paddingTop: '20px', paddingBottom: '60px' }}>
        <SetupChecklist leagueId={league.id} />
        <div className="manage-tabs" style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid var(--rule)', paddingBottom: '12px' }}>
          <button 
            onClick={() => setActiveTab('seats')}
            className={`btn ${activeTab !== 'seats' ? 'ghost' : ''}`}
          >
            Franchise Seats
          </button>
          <button
            onClick={() => setActiveTab('players')}
            className={`btn ${activeTab !== 'players' ? 'ghost' : ''}`}
          >
            Players
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
            onClick={() => setActiveTab('discovery')}
            className={`btn ${activeTab !== 'discovery' ? 'ghost' : ''}`}
          >
            Discovery
          </button>
          <button
            onClick={() => setActiveTab('operations')}
            className={`btn ${activeTab !== 'operations' ? 'ghost' : ''}`}
          >
            Operations
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
        {activeTab === 'players' && <PlayersTab leagueId={league.id} leagueSlug={league.slug} />}
        {activeTab === 'rulebook' && <RulebookTab leagueId={league.id} />}
        {activeTab === 'schedule' && (
          <ScheduleTab leagueId={league.id} />
        )}
        {activeTab === 'settings' && <LeagueSettings leagueId={league.id} editable />}
        {activeTab === 'discovery' && (
          <DiscoveryTab leagueId={league.id} />
        )}
        {activeTab === 'operations' && (
          <OperationsTab leagueId={league.id} />
        )}
      </div>
    </>
  );
}
