import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Forge AI', description: 'Build websites, apps and games with AI.' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}