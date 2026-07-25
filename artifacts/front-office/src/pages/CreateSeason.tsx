import React, { useState } from 'react';
import { useLocation, useParams, Link } from 'wouter';
import { useCreateSeason } from '@workspace/api-client-react';

export default function CreateSeason() {
  const { id: leagueId } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const createSeason = useCreateSeason();

  const [label, setLabel] = useState('Season 1');
  const [gameTitle, setGameTitle] = useState('NHL 27');
  const [salaryCapStr, setSalaryCapStr] = useState('');
  const [rosterMin, setRosterMin] = useState('20');
  const [rosterMax, setRosterMax] = useState('23');
  const [gamesPerMatchup, setGamesPerMatchup] = useState('3');
  
  // simple toggle for 3-2-1-0 vs 2-1-0
  const [pointSystem, setPointSystem] = useState<'traditional' | 'three_point'>('traditional');

  // tiebreakers
  const [tiebreakers, setTiebreakers] = useState(['points', 'rw', 'row', 'wins', 'diff', 'gf']);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('index', index.toString());
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    const dragIndex = parseInt(e.dataTransfer.getData('index'), 10);
    const newTb = [...tiebreakers];
    const [dragged] = newTb.splice(dragIndex, 1);
    newTb.splice(dropIndex, 0, dragged);
    setTiebreakers(newTb);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leagueId) return;

    let ptsWin = 2;
    let ptsOtLoss = 1;
    let ptsRegLoss = 0;
    if (pointSystem === 'three_point') {
      ptsWin = 3;
      ptsOtLoss = 1;
      ptsRegLoss = 0;
    }

    createSeason.mutate({
      leagueId,
      data: {
        label,
        game_title: gameTitle,
        salary_cap_cents: salaryCapStr ? Math.floor(parseFloat(salaryCapStr) * 100) : null,
        roster_min: parseInt(rosterMin, 10) || null,
        roster_max: parseInt(rosterMax, 10) || null,
        games_per_matchup: parseInt(gamesPerMatchup, 10) || 1,
        points_win: ptsWin,
        points_ot_loss: ptsOtLoss,
        points_reg_loss: ptsRegLoss,
        tiebreakers
      }
    }, {
      onSuccess: () => {
        setLocation(`/leagues/${leagueId}/manage`);
      }
    });
  };

  return (
    <div className="login-page">
      <div className="login-panel" style={{ width: '100%', maxWidth: '560px', textAlign: 'left', padding: '30px' }}>
        <h1 style={{ fontSize: '24px' }}>Create Season</h1>
        <p>Start a new campaign for your league.</p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Label</label>
              <input 
                required
                type="text" 
                value={label} 
                onChange={e => setLabel(e.target.value)}
                style={inputStyle}
                placeholder="Season 1"
              />
            </div>
            <div>
              <label style={labelStyle}>Game Title</label>
              <input 
                required
                type="text" 
                value={gameTitle} 
                onChange={e => setGameTitle(e.target.value)}
                style={inputStyle}
                placeholder="NHL 27"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Salary Cap ($)</label>
              <input 
                type="number" 
                step="0.01"
                value={salaryCapStr} 
                onChange={e => setSalaryCapStr(e.target.value)}
                style={inputStyle}
                placeholder="None"
              />
            </div>
            <div>
              <label style={labelStyle}>Min Roster</label>
              <input 
                type="number" 
                value={rosterMin} 
                onChange={e => setRosterMin(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Max Roster</label>
              <input 
                type="number" 
                value={rosterMax} 
                onChange={e => setRosterMax(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Games per Matchup</label>
              <input 
                required
                type="number" 
                value={gamesPerMatchup} 
                onChange={e => setGamesPerMatchup(e.target.value)}
                style={inputStyle}
                min="1"
              />
            </div>
            <div>
              <label style={labelStyle}>Points System</label>
              <select 
                value={pointSystem} 
                onChange={e => setPointSystem(e.target.value as 'traditional' | 'three_point')}
                style={inputStyle}
              >
                <option value="traditional">2-1-0 (NHL Standard)</option>
                <option value="three_point">3-2-1-0 (IIHF Standard)</option>
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Tiebreaker Order (Drag to reorder)</label>
            <div style={{ border: '1px solid var(--rule)', borderRadius: '3px', background: '#FAFCFD' }}>
              {tiebreakers.map((tb, idx) => (
                <div 
                  key={tb}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, idx)}
                  style={{
                    padding: '8px 12px',
                    borderBottom: idx < tiebreakers.length - 1 ? '1px solid var(--rule)' : 'none',
                    fontFamily: 'var(--data)',
                    fontSize: '12px',
                    cursor: 'grab',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    backgroundColor: 'var(--paper)'
                  }}
                >
                  <span style={{ color: 'var(--steel)' }}>⋮</span>
                  <span style={{ fontWeight: 600 }}>{idx + 1}.</span> 
                  {tb.toUpperCase()}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
            <button 
              type="submit" 
              className="btn" 
              style={{ flex: 1, padding: '12px' }}
              disabled={createSeason.isPending}
            >
              {createSeason.isPending ? 'Creating...' : 'Create Season'}
            </button>
            <Link href={`/leagues/${leagueId}/manage`} className="btn ghost" style={{ padding: '12px' }}>
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--data)',
  fontSize: '11px',
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  color: 'var(--steel)',
  marginBottom: '6px'
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontFamily: 'var(--body)',
  fontSize: '14px',
  border: '1px solid var(--rule)',
  borderRadius: '3px',
  background: '#FAFCFD',
  color: 'var(--ink)'
};
