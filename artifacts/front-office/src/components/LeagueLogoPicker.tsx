/**
 * League logo picker — a grid of generated generic hockey-style presets
 * plus a free-text field for linking any public image. Shared by league
 * creation and the Settings tab's branding panel.
 */
import { LEAGUE_LOGO_PRESETS } from './leagueLogos';

interface LeagueLogoPickerProps {
  value: string;
  onChange: (url: string) => void;
}

export default function LeagueLogoPicker({ value, onChange }: LeagueLogoPickerProps) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
        <span
          style={{
            width: '52px', height: '52px', borderRadius: '50%', border: '1px solid var(--rule)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
            background: '#fff',
          }}
        >
          {value
            ? <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
            : <span style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)' }}>No logo</span>}
        </span>
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://example.com/your-logo.png"
          aria-label="League logo URL"
          className="input"
          style={{ flex: 1, fontFamily: 'var(--data)', fontSize: '13px' }}
        />
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }} role="group" aria-label="Generic hockey logo presets">
        {LEAGUE_LOGO_PRESETS.map((preset) => {
          const selected = value === preset.url;
          return (
            <button
              key={preset.name}
              type="button"
              onClick={() => onChange(preset.url)}
              aria-pressed={selected}
              aria-label={preset.name}
              title={preset.name}
              style={{
                width: '44px', height: '44px', padding: '4px', borderRadius: '50%',
                border: selected ? '2px solid var(--crease)' : '1px solid var(--rule)',
                background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <img src={preset.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </button>
          );
        })}
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="btn ghost"
            style={{ fontSize: '11px', padding: '4px 10px' }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
