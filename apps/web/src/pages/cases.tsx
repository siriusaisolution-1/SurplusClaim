import { useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import { NavBar } from '../components/NavBar';
import { useAuth } from '../lib/auth-context';

export default function CasesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      void router.replace('/login');
    }
  }, [loading, user, router]);

  if (!user) return <div className="main-shell" />;

  return (
    <div className="main-shell">
      <Head>
        <title>Cases | Surplus Claim</title>
      </Head>
      <NavBar />
      <div className="content-shell">
        <div className="panel">
          <h1>Tenant Cases</h1>
          <p style={{ color: '#9ca3af' }}>
            This protected view is tenant-aware. The API only returns cases scoped to <strong>{user.tenantId}</strong>.
          </p>
          <ul>
            <li>Use your access token to call <code>/cases/:caseRef</code> securely.</li>
            <li>Requests for other tenants will return 404 and log a permission denial.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
