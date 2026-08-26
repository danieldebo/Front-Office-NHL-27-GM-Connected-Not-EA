import React, { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { useCreateLeague } from '@workspace/api-client-react';

export default function CreateLeague() {
  const [, setLocation] = useLocation();
  const createLeague = useCreateLeague();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [visibility, setVisibility] = useState<'public' | 'unlisted' | 'private'>('unlisted');
  const [primaryColor, setPrimaryColor] = useState('');
  const [secondaryColor, setSecondaryColor] = useState('');
  const [logoUrl, setLogoUrl] = useState('');

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
        logo_url: logoUrl || null
      }
    }, {
      onSuccess: (league) => {
        setLocation(`/leagues/${league.id}/manage`);
      }
    });
  };

  return (
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
