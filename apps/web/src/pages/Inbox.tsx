import { useState } from 'react';
import { cosigner } from '../lib/api';
import { useLocal, usePoll } from '../lib/hooks';
import { Button, Card, dateTime, MockBadge, Notice, PageHeader } from '../components/ui';
import { Composer } from '../components/Composer';

const CHANNEL: Record<string, string> = { email: 'Email', sms: 'SMS', app: 'App' };

export function InboxList({ clientId }: { clientId: string }) {
  const { data, reload } = usePoll(() => cosigner.get(`/clients/${clientId}/inbox`), 3000, [clientId]);
  const [msg, setMsg] = useState('');
  const act = async (kind: string, id: string) => {
    try {
      if (kind === 'cancel-recovery') await cosigner.post(`/recovery/${id}/cancel`, { by: 'compte Swissquote (connexion séparée)' });
      else await cosigner.post(`/tx/${id}/cancel`);
      setMsg('Annulé. Rien n’a été modifié.');
      void reload();
    } catch (e: any) {
      setMsg(e.message);
    }
  };
  const items = data ?? [];
  return (
    <div className="space-y-2">
      {msg && <Notice tone="ok">{msg}</Notice>}
      {!items.length && <Card className="text-[14px] text-sq-muted">Aucun message.</Card>}
      {items.map((m: any) => (
        <Card key={m.id} className="space-y-1 p-4">
          <div className="flex items-center gap-2 text-[12px] text-sq-muted">
            <span className="rounded-[4px] bg-sq-chip px-1.5 py-0.5 font-semibold uppercase text-sq-ink-2">{CHANNEL[m.channel] ?? m.channel}</span>
            <span>{dateTime(m.ts)}</span>
          </div>
          <div className="font-semibold">{m.subject}</div>
          <div className="text-[14px] text-sq-ink-2">{m.body}</div>
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
    <div className="mx-auto max-w-[640px]">
      <PageHeader title={<>Boîte de réception <MockBadge label="Emails et SMS simulés" /></>} subtitle="Les SMS et emails ne servent qu’à notifier ou comme facteur secondaire — jamais suffisants seuls." />
      {clientId ? (
        <div className="space-y-3">
          <ComposerWithContacts clientId={clientId} />
          <InboxList clientId={clientId} />
        </div>
      ) : (
        <Card>Connectez-vous d’abord.</Card>
      )}
    </div>
  );
}

function ComposerWithContacts({ clientId }: { clientId: string }) {
  const { data } = usePoll(() => cosigner.get(`/clients/${clientId}`).then((c) => c.contacts ?? []), 60000, [clientId]);
  return <Composer clientId={clientId} contacts={data ?? []} />;
}
