import type { AppProps } from 'next/app';

import { AuthProvider } from '../lib/auth-context';

import './styles.css';

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <Component {...pageProps} />
    </AuthProvider>
  );
}
