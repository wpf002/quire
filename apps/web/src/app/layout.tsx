import type { Metadata } from 'next';
import { EB_Garamond, IBM_Plex_Mono, Instrument_Sans, Libre_Caslon_Text } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const display = Libre_Caslon_Text({ subsets: ['latin'], weight: ['400', '700'], style: ['normal', 'italic'], variable: '--font-display' });
const ui = Instrument_Sans({ subsets: ['latin'], variable: '--font-ui' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });
const text = EB_Garamond({ subsets: ['latin'], style: ['normal', 'italic'], variable: '--font-text' });

export const metadata: Metadata = {
  title: { default: 'Quire', template: '%s · Quire' },
  description: 'Edit, comply, export and rank a self-published book in one place.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable} ${text.variable}`}>
      <body>{children}</body>
    </html>
  );
}
