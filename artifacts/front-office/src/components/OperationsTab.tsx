/**
 * Commissioner "Operations" tab — box score review queue, weekly digest
 * settings, calendar feed links, and charity/sponsor profile fields.
 */
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListPendingBoxScores,
  useApproveBoxScore,
  useRejectBoxScore,
  useUpdateBoxScoreSettings,
  useGetDigestSettings,
  useUpdateDigestSettings,
  useGetLeagueCalendarFeed,
  useRevokeLeagueCalendarFeed,
  useGetPartners,
  useUpdatePartners,
  type PartnerInput,
} from '@workspace/api-client-react';

const panelStyle: React.CSSProperties = { marginBottom: '28px' };
const smallBtn: React.CSSProperties = { fontSize: '11px', padding: '6px 10px' };
const fieldLabel: React.CSSProperties = { fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.08em' };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--rule)', borderRadius: '3px', fontFamily: 'var(--data)', fontSize: '12px' };

function BoxScoreQueue({ leagueId }: { leagueId: string }) {
  const qc = useQueryClient();
  const { data } = useListPendingBoxScores(leagueId);
  const approve = useApproveBoxScore();
  const reject = useRejectBoxScore();
  const updateSettings = useUpdateBoxScoreSettings();
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, { home: string; away: string }>>({});

  const invalidate = () => qc.invalidateQueries({ queryKey: [`/api/leagues/${leagueId}/box-scores/pending`] });

  return (
    <div className="panel" style={panelStyle}>
      <div className="panel-head"><h2>Box Score Uploads</h2></div>
      <div style={{ padding: '16px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', fontFamily: 'var(--data)', fontSize: '12px' }}>
          <input
            type="checkbox"
            onChange={(e) => updateSettings.mutate({ leagueId, data: { box_score_auto_approve: e.target.checked } })}
          />
          Auto-approve CSV uploads (screenshots always need manual review)
        </label>

        {(!data?.data || data.data.length === 0) && (
          <p style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>No uploads pending review.</p>
        )}

        {(data?.data ?? []).map((upload) => {
          const draft = scoreDrafts[upload.id] ?? { home: '', away: '' };
          return (
            <div key={upload.id} className="panel" style={{ marginBottom: '10px' }}>
              <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontFamily: 'var(--data)', fontSize: '12px' }}>
                  {upload.kind === 'csv' ? `CSV — ${upload.parsed_home_goals} - ${upload.parsed_away_goals}` : 'Screenshot upload'}
                </div>
                {upload.kind === 'screenshot' && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input style={inputStyle} placeholder="Home goals" type="number" min={0}
                      value={draft.home}
                      onChange={(e) => setScoreDrafts((d) => ({ ...d, [upload.id]: { ...draft, home: e.target.value } }))} />
                    <input style={inputStyle} placeholder="Away goals" type="number" min={0}
                      value={draft.away}
                      onChange={(e) => setScoreDrafts((d) => ({ ...d, [upload.id]: { ...draft, away: e.target.value } }))} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn"
                    style={smallBtn}
                    onClick={() => approve.mutate(
                      {
                        boxScoreId: upload.id,
                        data: upload.kind === 'screenshot'
                          ? { home_goals: Number(draft.home), away_goals: Number(draft.away) }
                          : {},
                      },
                      { onSuccess: invalidate }
                    )}
                  >
                    Approve
                  </button>
                  <button
                    className="btn ghost"
                    style={smallBtn}
                    onClick={() => {
                      const reason = window.prompt('Reason for rejecting this upload?');
                      if (!reason) return;
                      reject.mutate({ boxScoreId: upload.id, data: { reason } }, { onSuccess: invalidate });
                    }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DigestSettings({ leagueId }: { leagueId: string }) {
  const { data } = useGetDigestSettings(leagueId);
  const update = useUpdateDigestSettings();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return (
    <div className="panel" style={panelStyle}>
      <div className="panel-head"><h2>Weekly Digest Email</h2></div>
      <div style={{ padding: '16px', display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', gridColumn: '1 / -1' }}>
          <input
            type="checkbox"
            checked={data?.digest_enabled ?? false}
            onChange={(e) => update.mutate({ leagueId, data: { digest_enabled: e.target.checked } })}
          />
          <span style={{ fontFamily: 'var(--data)', fontSize: '12px' }}>Send a weekly digest to league members</span>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <span style={fieldLabel}>Send day</span>
          <select
            style={inputStyle}
            value={data?.digest_day_of_week ?? 1}
            onChange={(e) => update.mutate({ leagueId, data: { digest_day_of_week: Number(e.target.value) } })}
          >
            {days.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <span style={fieldLabel}>Send hour (0-23, local)</span>
          <input
            type="number" min={0} max={23} style={inputStyle}
            value={data?.digest_hour_local ?? 9}
            onChange={(e) => update.mutate({ leagueId, data: { digest_hour_local: Number(e.target.value) } })}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <span style={fieldLabel}>Timezone (IANA)</span>
          <input
            style={inputStyle}
            defaultValue={data?.digest_timezone ?? 'UTC'}
            onBlur={(e) => update.mutate({ leagueId, data: { digest_timezone: e.target.value } })}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', gridColumn: '1 / -1' }}>
          <span style={fieldLabel}>Template (optional — {'{{standings}}, {{recent_results}}, {{upcoming_games}}, {{unsubscribe_url}}'})</span>
          <textarea
            style={{ ...inputStyle, minHeight: '90px' }}
            defaultValue={data?.digest_template_md ?? ''}
            onBlur={(e) => update.mutate({ leagueId, data: { digest_template_md: e.target.value } })}
          />
        </label>
      </div>
    </div>
  );
}

function CalendarFeed({ leagueId }: { leagueId: string }) {
  const { data } = useGetLeagueCalendarFeed(leagueId);
  const revoke = useRevokeLeagueCalendarFeed();

  return (
    <div className="panel" style={panelStyle}>
      <div className="panel-head"><h2>League Calendar Feed</h2></div>
      <div style={{ padding: '16px' }}>
        <p style={{ fontFamily: 'var(--data)', fontSize: '12px', color: 'var(--steel)' }}>
          Subscribe any calendar app to this read-only feed of every scheduled game.
        </p>
        <input readOnly style={{ ...inputStyle, marginBottom: '10px' }} value={data?.ics_url ?? ''} onFocus={(e) => e.target.select()} />
        <button className="btn ghost" style={smallBtn} onClick={() => revoke.mutate({ leagueId })}>
          Revoke &amp; reissue
        </button>
      </div>
    </div>
  );
}

function PartnersEditor({ leagueId }: { leagueId: string }) {
  const { data } = useGetPartners(leagueId);
  const update = useUpdatePartners();
  const [charities, setCharities] = useState<PartnerInput[]>([]);
  const [sponsors, setSponsors] = useState<PartnerInput[]>([]);
  const [loaded, setLoaded] = useState(false);

  if (data && !loaded) {
    setCharities(data.charities.map((c) => ({ name: c.name, link: c.link, blurb: c.blurb ?? undefined, logo_url: c.logo_url ?? undefined })));
    setSponsors(data.sponsors.map((s) => ({ name: s.name, link: s.link, blurb: s.blurb ?? undefined, logo_url: s.logo_url ?? undefined })));
    setLoaded(true);
  }

  function renderList(kind: 'charities' | 'sponsors', items: PartnerInput[], setItems: (v: PartnerInput[]) => void) {
    return (
      <div>
        <h3 style={{ fontFamily: 'var(--data)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--steel)' }}>
          {kind} (max 2)
        </h3>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', marginBottom: '8px' }}>
            <input style={inputStyle} placeholder="Name" value={item.name}
              onChange={(e) => setItems(items.map((it, j) => j === i ? { ...it, name: e.target.value } : it))} />
            <input style={inputStyle} placeholder="Link" value={item.link}
              onChange={(e) => setItems(items.map((it, j) => j === i ? { ...it, link: e.target.value } : it))} />
            <button className="btn ghost" style={smallBtn} onClick={() => setItems(items.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        {items.length < 2 && (
          <button className="btn ghost" style={smallBtn} onClick={() => setItems([...items, { name: '', link: '' }])}>
            + Add {kind === 'charities' ? 'charity' : 'sponsor'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="panel" style={panelStyle}>
      <div className="panel-head"><h2>Charity &amp; Sponsors</h2></div>
      <div style={{ padding: '16px', display: 'grid', gap: '16px' }}>
        {renderList('charities', charities, setCharities)}
        {renderList('sponsors', sponsors, setSponsors)}
        <button
          className="btn"
          style={smallBtn}
          disabled={update.isPending}
          onClick={() => update.mutate({
            leagueId,
            data: {
              charities: charities.filter((c) => c.name && c.link),
              sponsors: sponsors.filter((s) => s.name && s.link),
            },
          })}
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function OperationsTab({ leagueId }: { leagueId: string }) {
  return (
    <div>
      <BoxScoreQueue leagueId={leagueId} />
      <DigestSettings leagueId={leagueId} />
      <CalendarFeed leagueId={leagueId} />
      <PartnersEditor leagueId={leagueId} />
    </div>
  );
}
