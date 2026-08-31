import React, { useEffect, useRef, useState } from 'react';
import { useLocation, Link } from 'wouter';
import { useCreateLeague, useListLeagueSettingsTemplates, type LeagueSettingsInput } from '@workspace/api-client-react';
import Header from '@/components/Header';
import {
  balancedSettingsFallback,
  LeagueSettingsFields,
  settingsFromTemplate,
  TemplatePicker,
} from '@/components/LeagueSettings';

export default function CreateLeague() {
  const [, setLocation] = useLocation();
  const createLeague = useCreateLeague();
  const { data: templatesData } = useListLeagueSettingsTemplates();
  const initializedTemplate = useRef(false);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [visibility, setVisibility] = useState<'public' | 'unlisted' | 'private'>('unlisted');
  const [primaryColor, setPrimaryColor] = useState('');
  const [secondaryColor, setSecondaryColor] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [settings, setSettings] = useState<LeagueSettingsInput>(balancedSettingsFallback);

  useEffect(() => {
    if (initializedTemplate.current) return;
    const balanced = templatesData?.data.find(template => template.id === 'balanced_standard');
    if (!balanced) return;
    setSettings(settingsFromTemplate(balanced, 'Initial league settings'));
    initializedTemplate.current = true;
  }, [templatesData]);

  const slugify = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugEdited) {
      setSlug(slugify(value));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createLeague.mutate({
      data: {
        name,
        slug,
        visibility,
        primary_color: primaryColor || null,
        secondary_color: secondaryColor || null,
        logo_url: logoUrl || null,
        settings,
      }
    }, {
      onSuccess: (league) => {
        setLocation(`/leagues/${league.id}/manage`);
      }
    });
  };

  return (
    <>
      <Header />
      <div className="login-page">
        <div className="login-panel" style={{ width: '100%', maxWidth: '500px', textAlign: 'left' }}>
        <h1 style={{ fontSize: '28px' }}>Create League</h1>
        <p>Establish a new connected-franchise Front Office.</p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={labelStyle}>League Name</label>
            <input 
              required
              type="text" 
              value={name} 
              onChange={e => handleNameChange(e.target.value)}
              style={inputStyle}
              placeholder="e.g. Can-Am Elite"
            />
          </div>

          <div>
            <label style={labelStyle}>League Slug</label>
            <input 
              required
              type="text" 
              value={slug} 
              onChange={e => {
                setSlug(e.target.value);
                setSlugEdited(true);
              }}
              style={inputStyle}
              placeholder="can-am-elite"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              title="Lowercase letters, numbers, and hyphens only."
            />
          </div>

          <div>
            <label style={labelStyle}>Visibility</label>
            <select 
              value={visibility} 
              onChange={e => setVisibility(e.target.value as any)}
              style={inputStyle}
            >
              <option value="public">Public (Anyone can view)</option>
              <option value="unlisted">Unlisted (Hidden from directories)</option>
              <option value="private">Private (Invite only)</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Platform</label>
              <select
                value={settings.platform}
                onChange={event => setSettings(previous => ({ ...previous, platform: event.target.value as LeagueSettingsInput['platform'] }))}
                style={inputStyle}
              >
                <option value="xbox">Xbox</option>
                <option value="psn">PlayStation</option>
                <option value="both">Crossplay</option>
              </select>
              <small style={helpStyle}>Which consoles can join. NHL 27 supports full crossplay.</small>
            </div>
            <div>
              <label style={labelStyle}>Team Count</label>
              <input
                required
                type="number"
                min={3}
                max={32}
                value={settings.team_count}
                onChange={event => setSettings(previous => ({ ...previous, team_count: Number(event.target.value) }))}
                style={inputStyle}
                placeholder="32"
              />
              <small style={helpStyle}>Connected Franchise supports 3 to 32 teams.</small>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Primary Color (Hex)</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input 
                  type="color" 
                  value={primaryColor || '#000000'} 
                  onChange={e => setPrimaryColor(e.target.value)}
                  style={{ width: '40px', height: '38px', padding: '0', border: '1px solid var(--rule)', borderRadius: '3px' }}
                />
                <input 
                  type="text" 
                  value={primaryColor} 
                  onChange={e => setPrimaryColor(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                  placeholder="#Hex"
                />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Secondary Color (Hex)</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input 
                  type="color" 
                  value={secondaryColor || '#000000'} 
                  onChange={e => setSecondaryColor(e.target.value)}
                  style={{ width: '40px', height: '38px', padding: '0', border: '1px solid var(--rule)', borderRadius: '3px' }}
                />
                <input 
                  type="text" 
                  value={secondaryColor} 
                  onChange={e => setSecondaryColor(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                  placeholder="#Hex"
                />
              </div>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Logo URL (Optional)</label>
            <input 
              type="url" 
              value={logoUrl} 
              onChange={e => setLogoUrl(e.target.value)}
              style={inputStyle}
              placeholder="https://..."
            />
          </div>

          <details style={{ border: '1px solid var(--rule)', borderRadius: '3px', background: '#fff' }}>
            <summary style={{ cursor: 'pointer', padding: '14px', fontFamily: 'var(--display)', fontSize: '17px', textTransform: 'uppercase' }}>
              League settings — start from a template
            </summary>
            <div style={{ borderTop: '1px solid var(--rule)', padding: '14px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <TemplatePicker
                templates={templatesData?.data ?? []}
                confirmApply={false}
                onApply={template => setSettings(settingsFromTemplate(template, 'Initial league settings'))}
              />
              <LeagueSettingsFields
                value={settings}
                onChange={setSettings}
                includeLeagueBasics={false}
                includeChangeSummary={false}
              />
            </div>
          </details>

          <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
            <button 
              type="submit" 
              className="btn" 
              style={{ flex: 1, padding: '12px' }}
              disabled={createLeague.isPending}
            >
              {createLeague.isPending ? 'Creating...' : 'Create League'}
            </button>
            <Link href="/" className="btn ghost" style={{ padding: '12px' }}>
              Cancel
            </Link>
          </div>
          {createLeague.isError && (
            <p role="alert" style={{ margin: 0, color: 'var(--goal)', fontSize: '13px' }}>
              {createLeague.error.message}
            </p>
          )}
        </form>
        </div>
      </div>
    </>
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
  padding: '10px 12px',
  fontFamily: 'var(--body)',
  fontSize: '14px',
  border: '1px solid var(--rule)',
  borderRadius: '3px',
  background: '#FAFCFD',
  color: 'var(--ink)'
};

const helpStyle: React.CSSProperties = {
  display: 'block',
  marginTop: '5px',
  color: 'var(--steel)',
  fontFamily: 'var(--data)',
  fontSize: '10px',
  lineHeight: 1.4,
};
