import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { USDC_ADDRESS } from '@sq/shared';
import { useLocal, useWalletData, useWalletTxs } from '../lib/hooks';
import { Addr, Card, fmt, MockBadge, NetBadge, Notice, PageHeader } from '../components/ui';
import { Money } from '../lib/prefs';
import { tr } from '../lib/i18n';
import { fmtChf, RateNote, useRates, valueOf } from '../lib/valuation';
import { TxListCompact } from '../wallet/TxList';
import { Change } from '../wallet/CryptoList';
import { PortfolioChart } from '../wallet/PortfolioChart';
import { ReceiveQr } from '../wallet/ReceiveQr';

export default function Asset() {
  const { symbol = 'USDC' } = useParams();
  const sym = symbol.toUpperCase() === 'ETH' ? 'ETH' : 'USDC';
  const { device } = useLocal();
  const { data } = useWalletData();
  const txs = useWalletTxs();
  const { rates, loading: ratesLoading } = useRates();
  const loc = useLocation();
  const sim = sym === 'USDC' ? Number(data?.onchain?.simulatedUsdc ?? 0) : 0;
  const amount = Number(sym === 'ETH' ? data?.onchain?.eth ?? 0 : data?.onchain?.usdc ?? 0) + sim;
  const rate = rates[sym];
  const value = valueOf(amount, rate);

  // "Receive" entry points link to /asset/USDC#receive: bring the receive card into view.
  useEffect(() => {
    if (loc.hash === '#receive') document.getElementById('receive')?.scrollIntoView({ block: 'start' });
  }, [loc.hash]);

  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <PageHeader title={sym === 'ETH' ? 'Ether' : 'USD Coin'} back="/wallet" />
      <Card className="text-center">
        <span className="num block text-[32px] font-semibold tracking-tight">
          {value === null ? '—' : fmtChf(value)}
          <span className="ml-1 text-[0.6em] font-normal">CHF</span>
        </span>
        {value === null && <div className="text-[12px] text-sq-warn">{tr('CHF value unavailable', 'Contre-valeur CHF indisponible')}</div>}
        <div className="num mt-1 text-[14px] text-sq-muted">
          <Money value={amount} decimals={sym === 'ETH' ? 5 : 2} unit={sym} unitClassName="ml-1" />
          {sim > 0 && (
            <span className="ml-1">
              ({tr('incl.', 'dont')} <Money value={sim} unit="USDC" unitClassName="ml-1" /> {tr('simulated', 'simulés')} <MockBadge label={tr('Demo', 'Démo')} />)
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-[13px] text-sq-ink-2">
          <span className="num">{rate ? `1 ${sym} = ${fmt(rate.chf, rate.chf < 10 ? 4 : 2)} CHF` : tr('Price unavailable', 'Cours indisponible')}</span>
          {rate && <Change pct={rate.changePct24h} />}
        </div>
        <div className="mt-1 text-[12px]">
          <RateNote rates={rates} assets={[sym]} loading={ratesLoading} />
        </div>
        <div className="mt-2 flex justify-center">
          <NetBadge />
        </div>
      </Card>
      <Link to={`/send?asset=${sym}`} className="flex min-h-12 items-center justify-center gap-2 rounded-[10px] bg-sq-orange text-[15px] font-semibold text-white">
        <ArrowUpRight size={18} strokeWidth={1.75} /> {tr('Send', 'Envoyer')}
      </Link>
      <Card id="receive" className="scroll-mt-20 space-y-3">
        <h2 className="text-[17px] font-semibold">{tr(`Receive ${sym}`, `Recevoir des ${sym}`)}</h2>
        <p className="text-[14px] text-sq-muted">{tr('Share your wallet’s public address. It can only be used to receive funds.', 'Partagez l’adresse publique de votre wallet. Elle ne permet que de recevoir.')}</p>
        <ReceiveQr address={device!.safeAddress!} />
        <Notice tone="warn">
          {tr('Only send', 'N’envoyez des')} {sym} {tr('on', 'que sur')} <b>Ethereum Sepolia</b> ({tr('test network', 'réseau de test')}).
          {sym === 'USDC' && (
            <>
              {' '}
              {tr('Token contract:', 'Contrat du jeton :')} <Addr a={USDC_ADDRESS} /> (Circle).
            </>
          )}
        </Notice>
      </Card>
      <PortfolioChart clientId={device!.clientId} initialView={sym} lockView />
      <Card>
        <h2 className="mb-1 text-[17px] font-semibold">{tr(`${sym} history`, `Historique ${sym}`)}</h2>
        <TxListCompact items={(txs.data ?? []).filter((t) => t.asset === sym)} loading={txs.loading && !txs.data} />
      </Card>
    </div>
  );
}
