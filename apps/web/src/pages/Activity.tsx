import type { ActivityEvent } from '@sq/shared';
import { cosigner } from '../lib/api';
import { useLocal, usePoll } from '../lib/hooks';
import { Card, cx, PageHeader, TxLink } from '../components/ui';

const ACTOR: Record<string, { icon: string; label: string }> = {
  client: { icon: '👤', label: 'You' },
  swissquote: { icon: '🏦', label: 'Swissquote' },
  compliance: { icon: '🧑‍⚖️', label: 'Compliance' },
  partner: { icon: '🤝', label: 'Recovery partner' },
  system: { icon: '⚙️', label: 'System' },
  attacker: { icon: '🕵️', label: 'Attacker' },
};

export function ActivityList({ items }: { items: ActivityEvent[] }) {
  if (!items.length) return <Card className="text-sm text-navy-700/60">Nothing yet.</Card>;
  return (
    <Card className="divide-y divide-navy-100 p-0">
      {items.map((e) => {
        const a = ACTOR[e.actor] ?? ACTOR.system;
        const bad = /rejected|refused|failed/.test(e.type);
        return (
          <div key={e.id} className="flex gap-3 px-4 py-3">
            <span className="text-lg">{a.icon}</span>
            <div className="min-w-0 flex-1">
              <div className={cx('text-sm', bad && 'text-bad-600')}>{e.message}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-navy-700/60">
                <span>{a.label}</span>
                <span>{new Date(e.ts).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'medium' })}</span>
                {e.txHash && <TxLink hash={e.txHash}>Etherscan</TxLink>}
              </div>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

export default function Activity() {
  const { device } = useLocal();
  const { data } = usePoll(() => cosigner.get(`/clients/${device!.clientId}/activity`), 5000, [device?.clientId]);
  return (
    <div>
      <PageHeader title="Activity" />
      <p className="mb-3 text-sm text-navy-700/70">Everything that happened on your wallet: who signed, which checks ran. Swissquote sees the same log in its back-office (shared transparency).</p>
      <ActivityList items={data ?? []} />
    </div>
  );
}
