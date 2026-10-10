import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { isAddress, parseEther, parseUnits } from 'ethers';
import { USDC_ADDRESS, USDC_DECIMALS, buildSafeTx, usdcTransferData, type SafeTx } from '@sq/shared';
import { cosigner } from '../lib/api';
import { useLocal, useWalletData } from '../lib/hooks';
import { Button, Card, cx, Field, inputCls, Notice, PageHeader, Why } from '../components/ui';
import { TxFlow } from '../components/TxFlow';
import { RecipientCheckView } from '../components/RecipientCheck';
import { Money } from '../lib/prefs';

const DEMO_BOB = '0xb0b0000000000000000000000000000000000b0b';
const DEMO_SANCTIONED = '0x098B716B8Aaf21512996dC57EB0615e2383E2f96';

export default function Send() {
  const { device } = useLocal();
  const [params] = useSearchParams();
  const { data, reload } = useWalletData();
  const nav = useNavigate();
  const [asset, setAsset] = useState<'USDC' | 'ETH'>(params.get('asset') === 'ETH' ? 'ETH' : 'USDC');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [amount, setAmount] = useState(params.get('amount') ?? '2');
  const [note, setNote] = useState(params.get('note') ?? '');
  const [saveName, setSaveName] = useState('');
  const [saveEmail, setSaveEmail] = useState('');
  const [when, setWhen] = useState<'now' | 'payment' | 'reminder'>('now');
  const [dueLocal, setDueLocal] = useState(() => {
    const d = new Date(new Date(Date.now() + 24 * 3600_000).toLocaleString('en-US', { timeZone: 'Europe/Zurich' }));
    d.setMinutes(0, 0, 0);
    return toLocalInput(d);
  });
  const [tx, setTx] = useState<SafeTx | null>(null);
  const [err, setErr] = useState('');

  const contacts: any[] = data?.client?.contacts ?? [];
  const balance = Number(asset === 'USDC' ? data?.onchain?.usdc ?? 0 : data?.onchain?.eth ?? 0);

  const suggestions = useMemo(
    () => [
      ...contacts.map((c) => ({ name: c.name, address: c.address, note: c.known ? 'contact' : 'nouveau (délai de réflexion)' })),
      ...(contacts.some((c) => c.address.toLowerCase() === DEMO_BOB) ? [] : [{ name: 'Bob (démo)', address: DEMO_BOB, note: 'pas encore contact' }]),
      { name: 'Adresse sanctionnée (démo)', address: DEMO_SANCTIONED, note: 'liste OFAC' },
    ],
    [contacts],
  );

  const review = async () => {
    setErr('');
    if (!isAddress(to)) return setErr('Saisissez une adresse Ethereum valide (0x…).');
    if (!(Number(amount) >= 0)) return setErr('Saisissez un montant.');
    try {
      if (saveName.trim()) {
        await cosigner.post(`/clients/${device!.clientId}/contacts`, { name: saveName.trim(), address: to, email: saveEmail.trim() || undefined });
        setSaveName('');
      }
      if (when !== 'now') {
        // Planned: nothing is signed now. At the due date it becomes "à confirmer" with a fresh simulation.
        const contact = contacts.find((c) => c.address.toLowerCase() === to.toLowerCase());
        await cosigner.post(`/clients/${device!.clientId}/scheduled`, { kind: when, recipient: to, recipientName: contact?.name ?? (saveName.trim() || undefined), asset, amount, dueAt: zurichLocalToIso(dueLocal), note: note.trim() || undefined });
        nav('/wallet/scheduled');
        return;
      }
      const nonce = (await cosigner.get(`/clients/${device!.clientId}/onchain`)).nonce;
      setTx(
        asset === 'USDC'
          ? buildSafeTx({ to: USDC_ADDRESS, data: usdcTransferData(to, parseUnits(amount || '0', USDC_DECIMALS)), nonce })
          : buildSafeTx({ to, value: parseEther(amount || '0'), nonce }),
      );
    } catch (e: any) {
      setErr(e.message);
    }
  };

  if (tx)
    return (
      <div className="mx-auto max-w-[640px]">
        <PageHeader title="Vérification" />
        <TxFlow clientId={device!.clientId} safeAddress={device!.safeAddress!} safeTx={tx} note={note.trim() || undefined} onBack={() => setTx(null)} onDone={() => void reload()} />
      </div>
    );

  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <PageHeader title="Envoyer" back="/wallet" />
      <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-sq-chip/60 p-1">
        {(['USDC', 'ETH'] as const).map((a) => (
          <button key={a} onClick={() => setAsset(a)} aria-pressed={asset === a} className={cx('min-h-11 rounded-[8px] text-[14px]', asset === a ? 'bg-white font-semibold shadow-sm' : 'text-sq-ink-2')}>
            {a}
          </button>
        ))}
      </div>
      <Card className="space-y-4">
        <Field label="Destinataire" hint="Adresse Ethereum (réseau de test Sepolia)">
          <input className={cx(inputCls, 'font-mono text-[14px]')} value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
        </Field>
        {isAddress(to) && <RecipientCheckView input={to} contacts={contacts} compact />}
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s.address}
              type="button"
              onClick={() => {
                setTo(s.address);
                if (s.name === 'Bob (démo)') setSaveName('Bob');
              }}
              className={cx('min-h-9 rounded-full border px-3 py-1.5 text-left text-[13px]', to.toLowerCase() === s.address.toLowerCase() ? 'border-sq-chip bg-sq-chip font-medium' : 'border-sq-line bg-white')}
            >
              {s.name} <span className="text-sq-muted">· {s.note}</span>
            </button>
          ))}
        </div>
        <Field label={`Montant (${asset})`} hint={<>Disponible : <Money value={balance} decimals={asset === 'ETH' ? 5 : 2} unit={asset} unitClassName="ml-1" /></>}>
          <input className={cx(inputCls, 'num text-[18px]')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} />
        </Field>
        <Field label="Motif (facultatif)" hint="Figure sur le justificatif.">
          <input className={inputCls} value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} placeholder="ex. Remboursement repas" />
        </Field>
        {isAddress(to) && !contacts.some((c) => c.address.toLowerCase() === to.toLowerCase()) && (
          <>
            <Field label="Enregistrer comme contact (facultatif)" hint="Un nouveau destinataire devient « connu » après un court délai de réflexion.">
              <input className={inputCls} value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="ex. Bob" />
            </Field>
            {saveName.trim() && (
              <Field label="Email du contact (facultatif)" hint="Pour lui écrire depuis la boîte de réception.">
                <input className={inputCls} type="email" value={saveEmail} onChange={(e) => setSaveEmail(e.target.value)} placeholder="bob@exemple.ch" />
              </Field>
            )}
          </>
        )}
      </Card>
      <Card className="space-y-3">
        <div className="text-[14px] font-medium">Quand ?</div>
        <div className="grid grid-cols-3 gap-1 rounded-[10px] bg-sq-chip/60 p-1">
          {(
            [
              ['now', 'Maintenant'],
              ['payment', 'Planifier'],
              ['reminder', 'Rappel'],
            ] as const
          ).map(([id, l]) => (
            <button key={id} type="button" aria-pressed={when === id} onClick={() => setWhen(id)} className={cx('min-h-11 rounded-[8px] text-[14px]', when === id ? 'bg-white font-semibold shadow-sm' : 'text-sq-ink-2')}>
              {l}
            </button>
          ))}
        </div>
        {when !== 'now' && (
          <>
            <Field label="Date et heure (Europe/Zurich)">
              <input type="datetime-local" className={inputCls} value={dueLocal} onChange={(e) => setDueLocal(e.target.value)} />
            </Field>
            <p className="text-[12px] text-sq-muted">
              {when === 'payment'
                ? 'À l’échéance, la dépense devient « à confirmer » : frais, soldes et simulation sont recalculés et vous la confirmez vous-même. Aucune signature ni aucun envoi automatique.'
                : 'À l’échéance, vous recevez un rappel. Rien n’est préparé ni envoyé.'}{' '}
              <Link to="/wallet/scheduled" className="underline underline-offset-2">
                Voir les éléments planifiés
              </Link>
            </p>
          </>
        )}
      </Card>
      {err && <Notice tone="bad">{err}</Notice>}
      <Why>Avant de confirmer, nous vous montrons en mots simples ce qui va se passer, nous lançons les contrôles Swissquote et nous simulons l’opération sur Ethereum.</Why>
      <Button onClick={review} disabled={!to || !amount}>
        {when === 'now' ? 'Vérifier' : when === 'payment' ? 'Planifier la dépense' : 'Créer le rappel'}
      </Button>
    </div>
  );
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" read as Europe/Zurich wall-clock time → ISO UTC (independent of the browser's time zone). */
export function zurichLocalToIso(local: string) {
  const [d, t] = local.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, day, hh, mm);
  const at = new Date(guess);
  const zurich = new Date(at.toLocaleString('en-US', { timeZone: 'Europe/Zurich' }));
  const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess - (zurich.getTime() - utc.getTime())).toISOString();
}
