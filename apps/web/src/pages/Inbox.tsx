import { useState } from 'react';
import { cosigner } from '../lib/api';
import { useLocal, usePoll } from '../lib/hooks';
import { Button, Card, MockBadge, Notice, PageHeader } from '../components/ui';

export function InboxList({ clientId, compact }: { clientId: string; compact?: boolean }) {
  const { data, reload } = usePoll(() => cosigner.get(`/clients/${clientId}/inbox`), 3000, [clientId]);
  const [msg, setMsg] = useState('');
  const act = async (kind: string, id: string) => {
    try {
      if (kind === 'cancel-recovery') await cosigner.post(`/recovery/${id}/cancel`, { by: 'Swissquote account (separate login)' });
      else await cosigner.post(`/tx/${id}/cancel`);
      setMsg('Cancelled. Nothing was changed.');
      void reload();
    } catch (e: any) {
      setMsg(e.message);
    }
  };
  const items = (data ?? []).slice(0, compact ? 5 : 100);
  return (
    <div className="space-y-2">
      {msg && <Notice tone="ok">{msg}</Notice>}
      {!items.length && <Card className="text-sm text-navy-700/60">No messages.</Card>}
      {items.map((m: any) => (
        <Card key={m.id} className="space-y-1 p-4">
          <div className="flex items-center gap-2 text-xs text-navy-700/60">
            <span className="rounded bg-navy-100 px-1.5 py-0.5 font-semibold uppercase">{m.channel}</span>
            <span>{new Date(m.ts).toLocaleTimeString('de-CH')}</span>
          </div>
          <div className="font-semibold">{m.subject}</div>
          <div className="text-sm text-navy-800">{m.body}</div>
          {m.action && (
            <div className="pt-2">
              <Button variant="danger" onClick={() => act(m.action.kind, m.action.id)}>
                {m.action.label}
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

export default function Inbox() {
  const { device, session } = useLocal();
  const clientId = device?.clientId ?? session?.clientId;
  return (
    <div>
      <PageHeader title={<>Inbox <MockBadge label="Mock email / SMS" /></>} back="/wallet" />
      <p className="mb-3 text-sm text-navy-700/70">Emails, SMS and app notifications are simulated and shown here. SMS and email are only notifications or a secondary factor — never enough alone.</p>
      {clientId ? <InboxList clientId={clientId} /> : <Card>Sign in first.</Card>}
    </div>
  );
}
