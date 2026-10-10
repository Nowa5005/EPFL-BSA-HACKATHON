// #21 (part A) — Banner shown everywhere (except Emergency mode itself) when Swissquote's services stop answering.

import { Link, useLocation } from 'react-router-dom';
import { CloudOff } from 'lucide-react';
import { useServiceHealth } from '../lib/serviceHealth';
import { tr } from '../lib/i18n';

export function ServiceHealthBanner() {
  const { down } = useServiceHealth();
  const { pathname } = useLocation();
  if (!down || pathname.startsWith('/emergency') || pathname.startsWith('/preview')) return null;
  return (
    <div role="alert" className="fixed inset-x-0 bottom-[max(12px,env(safe-area-inset-bottom))] z-50 flex justify-center px-4" data-testid="services-down-banner">
      <div className="flex w-full max-w-xl flex-wrap items-center gap-x-3 gap-y-1 rounded-[12px] border border-sq-warn/40 bg-sq-warn-50 px-4 py-3 text-[14px] shadow-lg">
        <CloudOff size={18} strokeWidth={1.75} className="shrink-0 text-sq-warn" aria-hidden />
        <span className="min-w-0 flex-1 font-medium text-sq-ink">{tr('Swissquote services are unreachable. Your funds are safe.', 'Les services Swissquote sont injoignables. Vos fonds sont en sécurité.')}</span>
        <Link to="/emergency" className="inline-flex min-h-10 items-center font-semibold text-sq-ink underline underline-offset-4">
          {tr('Emergency mode', 'Mode urgence')}
        </Link>
      </div>
    </div>
  );
}
