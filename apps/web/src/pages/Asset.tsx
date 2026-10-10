import { Link, useParams } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { MOCK_ETH_CHF, MOCK_USDC_CHF, USDC_ADDRESS } from '@sq/shared';
import { useLocal, useWalletData, useWalletTxs } from '../lib/hooks';
import { Addr, Amount, Card, CopyButton, fmt, NetBadge, Notice, PageHeader } from '../components/ui';
import { Money } from '../lib/prefs';
import { TxListCompact } from '../wallet/TxList';

export default function Asset() {
  const { symbol = 'USDC' } = useParams();
  const sym = symbol.toUpperCase() === 'ETH' ? 'ETH' : 'USDC';
  const { device } = useLocal();
  const { data } = useWalletData();
  const txs = useWalletTxs();
  const sim = sym === 'USDC' ? Number(data?.onchain?.simulatedUsdc ?? 0) : 0;
  const amount = Number(sym === 'ETH' ? data?.onchain?.eth ?? 0 : data?.onchain?.usdc ?? 0) + sim;
  const rate = sym === 'ETH' ? MOCK_ETH_CHF : MOCK_USDC_CHF;

  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <PageHeader title={sym === 'ETH' ? 'Ether' : 'USD Coin'} back="/wallet" />
      <Card className="text-center">
        <Amount value={amount * rate} className="text-[32px]" />
        <div className="num mt-1 text-[14px] text-sq-muted">
          <Money value={amount} decimals={sym === 'ETH' ? 5 : 2} unit={sym} unitClassName="ml-1" /> · 1 {sym} ≈ {fmt(rate)} CHF (indicatif)
        </div>
        <div className="mt-2 flex justify-center">
          <NetBadge />
        </div>
      </Card>
      <Link to={`/send?asset=${sym}`} className="flex min-h-12 items-center justify-center gap-2 rounded-[10px] bg-sq-orange text-[15px] font-semibold text-white">
        <ArrowUpRight size={18} strokeWidth={1.75} /> Envoyer
      </Link>
      <Card id="receive" className="space-y-3">
        <h2 className="text-[17px] font-semibold">Recevoir des {sym}</h2>
        <p className="text-[14px] text-sq-muted">Partagez l’adresse publique de votre wallet. Elle ne permet que de recevoir.</p>
        <code className="block break-all rounded-[10px] bg-sq-bg p-3 font-mono text-[14px]">{device!.safeAddress}</code>
        <CopyButton value={device!.safeAddress!} label="Copier l’adresse" />
        <Notice tone="warn">
          N’envoyez des {sym} que sur <b>Ethereum Sepolia</b> (réseau de test).
          {sym === 'USDC' && (
            <>
              {' '}
              Contrat du jeton : <Addr a={USDC_ADDRESS} /> (Circle).
            </>
          )}
        </Notice>
      </Card>
      <Card>
        <h2 className="mb-1 text-[17px] font-semibold">Historique {sym}</h2>
        <TxListCompact items={(txs.data ?? []).filter((t) => t.asset === sym)} loading={txs.loading && !txs.data} />
      </Card>
    </div>
  );
}
