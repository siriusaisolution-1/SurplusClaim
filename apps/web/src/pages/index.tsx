import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

import { NavBar } from '../components/NavBar';
import { useAuth } from '../lib/auth-context';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      void router.replace('/login');
    }
  }, [loading, user, router]);

  if (!user) {
    return <div className="main-shell" />;
  }

  return (
    <div className="main-shell">
      <Head>
        <title>Surplus Claim Dashboard</title>
      </Head>
      <NavBar />
      <div className="content-shell">
        <div className="panel">
          <h1>AI-Assisted Tax Surplus Recovery</h1>
          <p style={{ color: '#9ca3af' }}>
            Authenticated session for <strong>{user.fullName}</strong> ({user.email}). Your role is
            <span className="tag" style={{ marginLeft: '0.5rem' }}>
              {user.role}
            </span>
            .
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '1rem',
              marginTop: '1rem'
            }}
          >
            <div className="panel" style={{ background: '#0f172a' }}>
              <h3>Access Token Scope</h3>
              <p style={{ color: '#9ca3af' }}>
                All API calls are tenant-scoped and deny-by-default via JWT guards.
              </p>
            </div>
            <div className="panel" style={{ background: '#0f172a' }}>
              <h3>Navigation</h3>
              <p style={{ color: '#9ca3af' }}>
                Links are filtered by role so that restricted routes stay hidden for limited accounts.
              </p>
            </div>
            <div className="panel" style={{ background: '#0f172a' }}>
              <h3>Session Controls</h3>
              <p style={{ color: '#9ca3af' }}>
                Refresh tokens and logout endpoints are wired through the API for secure session lifecycle management.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
