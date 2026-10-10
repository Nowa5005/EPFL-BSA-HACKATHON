import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { DemoFooter, Logo } from './ui';
import { tr } from '../lib/i18n';

/** Frame for internal / demo-only pages (Swissquote back-office, attacker scenario). */
export function InternalShell({ title, banner, children }: { title: string; banner: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-sq-bg">
      <div className="bg-sq-dark px-4 py-1.5 text-center text-[12px] text-white/85">{banner}</div>
      <header className="sticky top-0 z-30 border-b border-sq-line bg-white">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 lg:px-6">
          <Logo size={28} />
          <span className="text-[16px] font-semibold tracking-tight">{title}</span>
          <div className="flex-1" />
          <Link to="/sq" className="inline-flex min-h-11 items-center gap-1 text-[14px] font-medium text-sq-ink-2 hover:text-sq-ink">
            <ChevronLeft size={18} strokeWidth={1.75} /> {tr('Swissquote app', 'App Swissquote')}
          </Link>
        </div>
      </header>
      <main className="mw-page mx-auto max-w-[1200px] px-4 pb-10 pt-6 lg:px-6">
        {children}
        <DemoFooter />
      </main>
    </div>
  );
}
