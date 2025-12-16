import { useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import { NavBar } from '../components/NavBar';
import { useAuth } from '../lib/auth-context';

export default function AdminPage() {
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
        <title>Admin | Surplus Claim</title>
      </Head>
      <NavBar />
      <div className="content-shell">
        <div className="panel">
          <h1>Admin controls</h1>
          <p style={{ color: '#9ca3af' }}>
            Only tenant and super admins will see this navigation entry. Use this area for RBAC-managed settings.
          </p>
        </div>
      </div>
    </div>
  );
}
