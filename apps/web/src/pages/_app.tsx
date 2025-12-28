import { ComplianceNotice } from '../components/ComplianceNotice';
import { AuthProvider } from '../lib/auth-context';

import type { AppProps } from 'next/app';

import './styles.css';

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <ComplianceNotice />
      <Component {...pageProps} />
    </AuthProvider>
  );
}
