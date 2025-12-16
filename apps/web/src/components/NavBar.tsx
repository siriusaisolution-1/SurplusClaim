import Link from 'next/link';

import { useAuth } from '../lib/auth-context';

const links = [
  { href: '/', label: 'Dashboard', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'REVIEWER', 'OPS', 'B2B_CLIENT', 'READ_ONLY'] },
  { href: '/cases', label: 'Cases', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'REVIEWER', 'OPS'] },
  { href: '/triage', label: 'Triage', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'REVIEWER', 'OPS'] },
  { href: '/portal', label: 'Client Portal', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'REVIEWER', 'OPS', 'B2B_CLIENT'] },
  { href: '/admin', label: 'Admin', roles: ['SUPER_ADMIN', 'TENANT_ADMIN'] }
];

export function NavBar() {
  const { user, logout } = useAuth();

  return (
    <nav className="navbar">
      <div>
        <strong>Surplus Claim</strong>
      </div>
      <div className="nav-links">
        {links
          .filter((link) => (user ? link.roles.includes(user.role) : false))
          .map((link) => (
            <Link key={link.href} href={link.href} style={{ color: '#e5e7eb' }}>
              {link.label}
            </Link>
          ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {user && <span className="tag">{user.role}</span>}
        <button className="button" onClick={() => logout()}>
          Logout
        </button>
      </div>
    </nav>
  );
}
