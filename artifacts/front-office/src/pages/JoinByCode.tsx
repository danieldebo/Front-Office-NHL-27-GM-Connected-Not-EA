import React from 'react';
import { useParams, useLocation } from 'wouter';
import { useResolvePublicCode } from '@workspace/api-client-react';

/**
 * /j/:code — resolves a league public code and redirects to /l/:slug.
 * No auth required.
 */
export default function JoinByCode() {
  const { code } = useParams<{ code: string }>();
  const [, setLocation] = useLocation();

  const { data, isLoading, isError } = useResolvePublicCode(
    code?.toUpperCase() ?? '',
    { query: { enabled: !!code, retry: false } as any }
  );

  React.useEffect(() => {
    if (data?.slug) {
      setLocation(`/l/${data.slug}`, { replace: true });
    }
  }, [data?.slug, setLocation]);

  if (isLoading) {
    return (
      <div className="loading-screen">
        Finding league…
      </div>
    );
  }

  if (isError || (!isLoading && !data?.slug)) {
    return (
      <div className="empty-state" style={{ margin: '60px auto', maxWidth: '480px' }}>
        <h2>League Not Found</h2>
        <p style={{
          color: 'var(--steel)',
          fontFamily: 'var(--data)',
          fontSize: '12px',
          marginTop: '10px',
          textTransform: 'uppercase',
          letterSpacing: '.1em',
        }}>
          No league with code <strong>{code?.toUpperCase()}</strong> was found.
          Double-check the code and try again.
        </p>
        <div style={{ marginTop: '20px' }}>
          <a href="/" className="btn">Back to Home</a>
        </div>
      </div>
    );
  }

  // Redirecting — show nothing while the effect fires
  return <div className="loading-screen">Redirecting…</div>;
}
