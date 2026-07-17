import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SentinelFraud — Real-Time Fraud Detection',
  description:
    'Live fraud detection dashboard: streaming transaction scoring, signal breakdowns, and AI-written alert explanations.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 font-sans text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
