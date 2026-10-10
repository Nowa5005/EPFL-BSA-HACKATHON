import { Bot, Building2, ScaleIcon, ShieldAlert, Handshake, UserRound } from 'lucide-react';
import type { ActivityEvent } from '@sq/shared';
import { Card, cx, dateTime, TxLink } from './ui';

const ACTOR: Record<string, { icon: any; label: string }> = {
  client: { icon: UserRound, label: 'Client' },
  swissquote: { icon: Building2, label: 'Swissquote' },
  compliance: { icon: ScaleIcon, label: 'Conformité' },
  partner: { icon: Handshake, label: 'Partenaire de récupération' },
  system: { icon: Bot, label: 'Système' },
  attacker: { icon: ShieldAlert, label: 'Attaquant' },
};

export function ActivityList({ items, showClient }: { items: ActivityEvent[]; showClient?: boolean }) {
  if (!items.length) return <Card className="text-[14px] text-sq-muted">Rien pour l’instant.</Card>;
  return (
    <Card className="divide-y divide-sq-line p-0">
      {items.map((e) => {
        const a = ACTOR[e.actor] ?? ACTOR.system;
        const bad = /rejected|refused|failed/.test(e.type);
        return (
          <div key={e.id} className="flex gap-3 px-4 py-3">
            <a.icon size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-sq-ink-2" />
            <div className="min-w-0 flex-1">
              <div className={cx('text-[14px]', bad && 'text-sq-down')}>{e.message}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-sq-muted">
                <span>{a.label}</span>
                {showClient && <span>{e.clientId}</span>}
                <span>{dateTime(e.ts)}</span>
                {e.txHash && <TxLink hash={e.txHash}>Etherscan</TxLink>}
              </div>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
