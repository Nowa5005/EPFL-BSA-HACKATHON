import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isAddress, parseEther, parseUnits } from 'ethers';
import { USDC_ADDRESS, USDC_DECIMALS, buildSafeTx, usdcTransferData, type SafeTx } from '@sq/shared';
import { bank, cosigner } from '../lib/api';
import { useLocal, usePoll, useWalletData } from '../lib/hooks';
import { Button, Card, cx, Field, fmt, inputCls, Notice, PageHeader, Why } from '../components/ui';
import { TxFlow } from '../components/TxFlow';

const DEMO_BOB = '0xb0b0000000000000000000000000000000000b0b';
const DEMO_SANCTIONED = '0x098B716B8Aaf21512996dC57EB0615e2383E2f96';

export default function Send() {
  const { device } = useLocal();
  const [params] = useSearchParams();
  const { data, reload } = useWalletData();
  const bankInfo = usePoll(() => bank.get(`/clients/${device!.clientId}`), 30000, [device?.clientId]);
  const [asset, setAsset] = useState<'USDC' | 'ETH'>(params.get('asset') === 'ETH' ? 'ETH' : 'USDC');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('10');
  const [saveName, setSaveName] = useState('');
  const [tx, setTx] = useState<SafeTx | null>(null);
  const [err, setErr] = useState('');

  const contacts: any[] = data?.client?.contacts ?? [];
  const balance = Number(asset === 'USDC' ? data?.onchain?.usdc ?? 0 : data?.onchain?.eth ?? 0);
  const treasury: string | undefined = bankInfo.data?.treasury;

  const suggestions = useMemo(
    () => [
      ...contacts.map((c) => ({ name: c.name, address: c.address, note: c.known ? 'contact' : 'new contact (cooling-off)' })),
      ...(contacts.some((c) => c.address.toLowerCase() === DEMO_BOB.toLowerCase()) ? [] : [{ name: 'Bob (demo)', address: DEMO_BOB, note: 'not yet a contact' }]),
      ...(treasury && !contacts.some((c) => c.address.toLowerCase() === treasury.toLowerCase()) ? [{ name: 'My Swissquote account', address: treasury, note: 'verified' }] : []),
      { name: 'Sanctioned address (demo)', address: DEMO_SANCTIONED, note: 'on OFAC list' },
    ],
    [contacts, treasury],
  );

  const review = async () => {
    setErr('');
    if (!isAddress(to)) return setErr('Please enter a valid Ethereum address (0x…).');
    if (!(Number(amount) >= 0)) return setErr('Please enter an amount.');
    try {
      if (saveName.trim()) {
        await cosigner.post(`/clients/${device!.clientId}/contacts`, { name: saveName.trim(), address: to });
        setSaveName('');
      }
      const nonce = (await cosigner.get(`/clients/${device!.clientId}/onchain`)).nonce;
      const t =
        asset === 'USDC'
          ? buildSafeTx({ to: USDC_ADDRESS, data: usdcTransferData(to, parseUnits(amount || '0', USDC_DECIMALS)), nonce })
          : buildSafeTx({ to, value: parseEther(amount || '0'), nonce });
      setTx(t);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  if (tx)
    return (
      <div>
        <PageHeader title="Review" />
        <TxFlow
          clientId={device!.clientId}
          safeAddress={device!.safeAddress!}
          safeTx={tx}
          onBack={() => setTx(null)}
          onDone={() => {
            void reload();
            if (treasury && to.toLowerCase() === treasury.toLowerCase()) setTimeout(() => void creditBank(device!.clientId), 500);
          }}
        />
      </div>
    );

  return (
    <div className="space-y-4">
      <PageHeader title="Send" />
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-navy-100 p-1">
        {(['USDC', 'ETH'] as const).map((a) => (
          <button key={a} onClick={() => setAsset(a)} className={cx('rounded-lg py-2 text-sm font-semibold', asset === a ? 'bg-white shadow-sm' : 'text-navy-700/70')}>
            {a}
          </button>
        ))}
      </div>
      <Card className="space-y-4">
        <Field label="To" hint="Ethereum address (Sepolia)">
          <input className={cx(inputCls, 'font-mono text-sm')} value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="0x…" />
        </Field>
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s.address}
              onClick={() => {
                setTo(s.address);
                if (s.name === 'Bob (demo)') setSaveName('Bob');
              }}
              className={cx('rounded-full border px-3 py-1.5 text-left text-xs', to.toLowerCase() === s.address.toLowerCase() ? 'border-navy-900 bg-navy-900 text-white' : 'border-navy-100 bg-white')}
            >
              <b>{s.name}</b> <span className="opacity-60">· {s.note}</span>
            </button>
          ))}
        </div>
        <Field label={`Amount (${asset})`} hint={`Available: ${fmt(balance, asset === 'ETH' ? 5 : 2)} ${asset}`}>
          <input className={cx(inputCls, 'num text-lg')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} />
        </Field>
        {isAddress(to) && !contacts.some((c) => c.address.toLowerCase() === to.toLowerCase()) && (
          <Field label="Save as contact (optional)" hint="New recipients become trusted after a short cooling-off period">
            <input className={inputCls} value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. Bob" />
          </Field>
        )}
      </Card>
      {err && <Notice tone="bad">{err}</Notice>}
      <Why>Before you confirm, we show in plain words what will happen, run Swissquote's compliance checks and simulate the transaction on Ethereum.</Why>
      <Button onClick={review} disabled={!to || !amount}>
        Review
      </Button>
    </div>
  );
}

async function creditBank(clientId: string) {
  const reqs = await cosigner.get(`/clients/${clientId}/tx-requests`);
  const last = reqs.find((r: any) => r.status === 'executed');
  if (last?.txHash) await bank.post(`/clients/${clientId}/credit-from-wallet`, { txHash: last.txHash }).catch(() => undefined);
}
