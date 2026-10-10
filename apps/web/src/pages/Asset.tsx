import { useParams, Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { MOCK_ETH_CHF, MOCK_USDC_CHF, USDC_ADDRESS } from '@sq/shared';
import { cosigner } from '../lib/api';
import { useLocal, usePoll, useWalletData } from '../lib/hooks';
import { Addr, Card, chf, fmt, Notice, PageHeader, RealBadge } from '../components/ui';
import { ActivityList } from './Activity';

export default function Asset() {
  const { symbol = 'USDC' } = useParams();
  const sym = symbol.toUpperCase() === 'ETH' ? 'ETH' : 'USDC';
  const { device } = useLocal();
  const { data } = useWalletData();
  const activity = usePoll(() => cosigner.get(`/clients/${device!.clientId}/activity`), 8000, [device?.clientId]);
  const amount = Number(sym === 'ETH' ? data?.onchain?.eth ?? 0 : data?.onchain?.usdc ?? 0);
  const rate = sym === 'ETH' ? MOCK_ETH_CHF : MOCK_USDC_CHF;
  const items = (activity.data ?? []).filter((e: any) => (sym === 'USDC' ? /USDC/.test(e.message) : /ETH/.test(e.message)) || e.type === 'wallet.deployed');

  return (
    <div className="space-y-4">
      <PageHeader title={sym === 'ETH' ? 'Ether' : 'USD Coin'} back="/wallet" />
      <Card className="text-center">
        <div className="num text-3xl font-semibold">{chf(amount * rate)}</div>
        <div className="num mt-1 text-navy-700/70">
          {fmt(amount, sym === 'ETH' ? 5 : 2)} {sym} · 1 {sym} ≈ {chf(rate)} (indicative)
        </div>
        <div className="mt-2"><RealBadge label="Live Sepolia balance" /></div>
      </Card>
      <div className="grid grid-cols-2 gap-2">
        <Link to={`/send?asset=${sym}`} className="rounded-xl bg-navy-900 py-3 text-center text-sm font-semibold text-white">Send</Link>
        <a href="#receive" className="rounded-xl bg-white py-3 text-center text-sm font-semibold shadow-sm">Receive</a>
      </div>
      <Card id="receive" className="flex flex-col items-center gap-3">
        <div className="font-semibold">Receive {sym}</div>
        <QRCodeSVG value={device!.safeAddress!} size={160} marginSize={1} />
        <code className="break-all rounded bg-navy-50 p-2 text-center text-xs">{device!.safeAddress}</code>
        <button className="text-sm font-medium text-accent-500" onClick={() => navigator.clipboard?.writeText(device!.safeAddress!)}>Copy address</button>
        <Notice tone="warn">Only send {sym} on <b>Ethereum Sepolia</b> (test network) to this address.{sym === 'USDC' && <> Token contract <Addr a={USDC_ADDRESS} /> (Circle).</>}</Notice>
      </Card>
      <h2 className="font-semibold">History</h2>
      <ActivityList items={items} />
    </div>
  );
}
