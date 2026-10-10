import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MOCK_ETH_CHF, MOCK_USDC_CHF, explorerAddress } from '@sq/shared';
import { bank, cosigner } from '../lib/api';
import { useLocal, usePoll, useWalletData } from '../lib/hooks';
import { Addr, Button, Card, chf, Field, fmt, inputCls, MockBadge, Notice, RealBadge, Spinner, TxLink } from '../components/ui';
import { ActivityList } from './Activity';

export default function WalletHome() {
  const { device, session } = useLocal();
  const { data, error, reload } = useWalletData();
  const clientId = device!.clientId;
  const bankData = usePoll(() => bank.get(`/clients/${clientId}`), 10000, [clientId]);
  const activity = usePoll(() => cosigner.get(`/clients/${clientId}/activity`), 8000, [clientId]);

  const usdc = Number(data?.onchain?.usdc ?? 0);
  const eth = Number(data?.onchain?.eth ?? 0);
  const totalChf = usdc * MOCK_USDC_CHF + eth * MOCK_ETH_CHF;

  return (
    <div className="space-y-4">
      <div className="pt-1">
        <div className="text-sm text-navy-700/70">Hello {session?.profile?.name?.split(' ')[0] ?? ''} · Total value</div>
        <div className="num mt-1 text-4xl font-semibold tracking-tight">{data ? chf(totalChf) : <Spinner />}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-navy-700/70">
          <a className="hover:underline" href={explorerAddress(device!.safeAddress!)} target="_blank" rel="noreferrer">
            <Addr a={device!.safeAddress} /> ↗
          </a>
          <RealBadge label="Ethereum Sepolia" />
          <span>indicative rates</span>
        </div>
      </div>
      {error && <Notice tone="warn" title="Could not refresh">{error}</Notice>}
      {data?.onchain?.deployed && data.onchain.owners && !data.onchain.owners.map((o: string) => o.toLowerCase()).includes(device!.deviceAddress.toLowerCase()) && (
        <Notice tone="bad" title="This device has been revoked">This device key is no longer an owner of your wallet. Use “I lost my device” on your new device, or reset this one in Settings.</Notice>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Link to="/send" className="rounded-xl bg-navy-900 py-3 text-center text-sm font-semibold text-white">
          Send
        </Link>
        <Link to="/asset/USDC" className="rounded-xl bg-white py-3 text-center text-sm font-semibold shadow-sm">
          Receive
        </Link>
        <Link to="/dapps" className="rounded-xl bg-white py-3 text-center text-sm font-semibold shadow-sm">
          dApps
        </Link>
      </div>

      <Card className="divide-y divide-navy-100 p-0">
        {[
          { sym: 'USDC', name: 'USD Coin', amount: usdc, chfv: usdc * MOCK_USDC_CHF, color: 'bg-[#2775ca]' },
          { sym: 'ETH', name: 'Ether', amount: eth, chfv: eth * MOCK_ETH_CHF, color: 'bg-[#627eea]' },
        ].map((a) => (
          <Link key={a.sym} to={`/asset/${a.sym}`} className="flex items-center gap-3 px-5 py-4 hover:bg-navy-50">
            <span className={`flex size-10 items-center justify-center rounded-full text-xs font-bold text-white ${a.color}`}>{a.sym[0]}</span>
            <div className="flex-1">
              <div className="font-semibold">{a.name}</div>
              <div className="num text-sm text-navy-700/70">
                {fmt(a.amount, a.sym === 'ETH' ? 4 : 2)} {a.sym}
              </div>
            </div>
            <div className="num text-right font-semibold">{chf(a.chfv)}</div>
          </Link>
        ))}
      </Card>

      <Notice tone="ok" title="Network fees: offered by Swissquote">
        You never need ETH to pay fees. {data?.client?.usage ? `${data.client.usage.sponsoredTx}/20 free transactions used today.` : ''}
      </Notice>

      <BankTransfer clientId={clientId} safe={device!.safeAddress!} bankData={bankData.data} onDone={() => { void reload(); void bankData.reload(); }} />

      <div className="flex items-center justify-between pt-2">
        <h2 className="font-semibold">Recent activity</h2>
        <Link to="/activity" className="text-sm text-accent-500">
          See all
        </Link>
      </div>
      <ActivityList items={(activity.data ?? []).slice(0, 4)} />
    </div>
  );
}

function BankTransfer({ clientId, safe, bankData, onDone }: { clientId: string; safe: string; bankData: any; onDone: () => void }) {
  const [amount, setAmount] = useState('20');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string; hash?: string } | null>(null);
  const verified = bankData?.verifiedWallets?.some((w: any) => w.address.toLowerCase() === safe.toLowerCase());

  const go = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await bank.post(`/clients/${clientId}/transfer-to-wallet`, { amount: Number(amount), address: safe });
      setMsg({ tone: 'ok', text: `${amount} USDC arrived in your wallet.`, hash: r.txHash });
      onDone();
    } catch (e: any) {
      setMsg({ tone: 'bad', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Swissquote account</div>
        <MockBadge label="Mock banking" />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-navy-50 p-3">
          <div className="text-navy-700/70">CHF</div>
          <div className="num font-semibold">{bankData ? chf(bankData.accounts.CHF) : '—'}</div>
        </div>
        <div className="rounded-xl bg-navy-50 p-3">
          <div className="text-navy-700/70">USDC</div>
          <div className="num font-semibold">{bankData ? fmt(bankData.accounts.USDC) : '—'}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-ok-600">
        {verified ? '✓ This wallet is a verified wallet of yours (Travel Rule, EIP-1271 proof)' : <span className="text-warn-600">Wallet not yet verified</span>}
      </div>
      <Field label="Move USDC from my account to my wallet">
        <div className="flex gap-2">
          <input className={inputCls + ' num min-w-0 flex-1'} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button className="w-32 shrink-0" onClick={go} disabled={busy || !verified || !(Number(amount) > 0)}>
            {busy ? <Spinner /> : 'Transfer'}
          </Button>
        </div>
      </Field>
      {msg && (
        <Notice tone={msg.tone}>
          {msg.text} {msg.hash && <TxLink hash={msg.hash} />}
        </Notice>
      )}
    </Card>
  );
}
