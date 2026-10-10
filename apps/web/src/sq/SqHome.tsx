import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, Banknote, ChartNoAxesColumn, ChevronRight, CirclePlus, List, WalletCards, Bitcoin, Info } from 'lucide-react';
import { bank, cosigner } from '../lib/api';
import { useLocal, usePoll } from '../lib/hooks';
import { tr } from '../lib/i18n';
import { instrumentPath, useQuotes, useWalletRates } from '../lib/market';
import { Card, cx, fmt, MockBadge, Skeleton, Tile } from '../components/ui';
import { Money, setPrefs } from '../lib/prefs';
import { SqMobileTop } from './SqShell';
import { PORTFOLIO } from './mockMarkets';
import { ChangeTag, fmtPrice, rowTime } from './marketUi';

/** Thin blue line chart with a very light gradient (hand-made SVG, no chart library). */
function LineChart({ data, label }: { data: number[]; label: string }) {
  const w = 600;
  const h = 150;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 10 - ((v - min) / (max - min || 1)) * (h - 30)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" preserveAspectRatio="none" role="img" aria-label={label} data-first={data[0]} data-last={data[data.length - 1]}>
      <defs>
        <linearGradient id="sqfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#2f6fed" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#2f6fed" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill="url(#sqfill)" />
      <path d={line} fill="none" stroke="#2f6fed" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const HOME_QUOTES = ['yf:^SSMI', 'yf:NESN.SW', 'yf:UBSG.SW', 'cg:bitcoin', 'cg:ethereum'];
const PERIODS = ['1W', '1M', '6M', '1Y', 'All'] as const;

export default function SqHome() {
  const { session, device } = useLocal();
  const clientId = session?.clientId;
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('1W');
  const [why, setWhy] = useState<string | null>(null);
  const bankInfo = usePoll(() => bank.get(`/clients/${clientId}`), 15000, [clientId]);
  const rates = useWalletRates();
  const wall = usePoll(
    async () => {
      if (!clientId) return null;
      const c = await cosigner.get(`/clients/${clientId}`).catch(() => null);
      if (c?.preferences) setPrefs(c.preferences); // respect "masquer les montants" here too
      if (!c?.safeAddress) return { privacy: c?.privacy as string | undefined, onchain: null };
      const on = await cosigner.get(`/clients/${clientId}/onchain`);
      return { privacy: c.privacy as string, onchain: { eth: Number(on.eth), usdc: Number(on.usdc) + Number(on.simulatedUsdc ?? 0) } };
    },
    15000,
    [clientId, device?.safeAddress],
  );
  // My Wall value at indicative live market rates (never a fixed rate); null when a rate is unavailable.
  const eth = rates.data?.rates.ETH?.chf;
  const usdc = rates.data?.rates.USDC?.chf;
  const oc = wall.data?.onchain;
  const wallValue = oc ? (eth != null && usdc != null ? oc.eth * eth + oc.usdc * usdc : null) : undefined;
  const hasWall = !!oc && wall.data?.privacy !== 'none';

  const cash = bankInfo.data?.accounts?.CHF ?? 31000;
  const total = PORTFOLIO.assets + PORTFOLIO.crypto + cash;
  const series = useMemo(() => {
    const s = PORTFOLIO.series[period];
    const k = total / s[s.length - 1];
    return s.map((v) => v * k);
  }, [period, total]);

  const unavailable = {
    orders: tr('No open orders: order placement isn’t available in this prototype.', 'Aucun ordre en cours : le passage d’ordres n’est pas disponible dans ce prototype.'),
    tx: tr('The trading account’s transaction history isn’t reconstructed in this prototype. My Wall has its own history.', 'L’historique des transactions du compte de trading n’est pas reconstitué dans ce prototype. My Wall a son propre historique.'),
    add: tr('Deposits to the trading account aren’t available in this prototype (no real payments).', 'Les dépôts sur le compte de trading ne sont pas disponibles dans ce prototype (aucun paiement réel).'),
  };

  return (
    <div className="lg:grid lg:grid-cols-12 lg:gap-6">
      <div className="lg:col-span-12">
        <SqMobileTop />
        <div className="pb-5 pt-2 text-center lg:pt-0 lg:text-left">
          <div className="text-[16px] text-sq-ink-2">
            {tr('Total value', 'Valeur totale')} <MockBadge label={tr('Demo account', 'Compte démo')} className="ml-1" />
          </div>
          <span className="num whitespace-nowrap text-[32px] font-semibold tracking-tight lg:text-[40px]">
            {fmt(total)}
            <span className="ml-1 text-[0.6em] font-normal">CHF</span>
          </span>
        </div>
      </div>

      <Card className="lg:col-span-8">
        <div className="flex items-center justify-between gap-2 text-[16px] text-sq-ink-2">
          <span>{PORTFOLIO.account}</span>
          <MockBadge label={tr('Fictitious', 'Fictif')} />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="num text-[24px] font-semibold">
            {fmt(total)}
          </span>
          <span className="rounded-full bg-sq-chip px-1.5 py-0.5 text-[11px] font-semibold">CHF</span>
        </div>
        <div className="num mt-1 text-[14px] text-sq-ink-2">
          <span className="font-medium text-sq-up">
            + {fmt(PORTFOLIO.dailyChange)} CHF ▲ {fmt(PORTFOLIO.dailyChangePct)}%
          </span>{' '}
          {tr('daily change', 'variation du jour')}
        </div>
        <div className="num text-[14px] text-sq-ink-2">
          <span className="font-medium text-sq-up">+ {fmt(PORTFOLIO.absolutePerf)} CHF</span> {tr('absolute performance', 'performance absolue')}
        </div>
        <div className="mt-3">
          <LineChart data={series} label={tr(`Demo account value over ${period} (fictitious data)`, `Valeur du compte démo sur ${period} (données fictives)`)} />
        </div>
        <div className="mt-2 grid grid-cols-5 rounded-full bg-sq-bg p-1" role="tablist" aria-label={tr('Period', 'Période')}>
          {PERIODS.map((p) => (
            <button key={p} type="button" role="tab" aria-selected={period === p} onClick={() => setPeriod(p)} className={cx('min-h-9 rounded-full text-[14px]', period === p ? 'bg-white font-semibold shadow-sm' : 'text-sq-ink-2')}>
              {p === 'All' ? tr('All', 'Tout') : p}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-sq-muted">{tr('Reconstructed demo account: values and chart are fictitious, not market data.', 'Compte de démonstration reconstitué : valeurs et graphique fictifs, pas des données de marché.')}</p>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:col-span-4 lg:mt-0 lg:content-start">
        <Tile to="/sq/markets?tab=markets&list=shares">
          <TileHead icon={<ChartNoAxesColumn size={16} strokeWidth={1.75} />} label={tr('Assets', 'Actifs')} />
          <div className="num mt-1 text-[16px] font-semibold">
            {fmt(PORTFOLIO.assets)}
          </div>
        </Tile>
        <Tile to="/sq/markets?tab=markets&list=crypto">
          <TileHead icon={<Bitcoin size={16} strokeWidth={1.75} />} label="Crypto" />
          <div className="num mt-1 text-[16px] font-semibold">
            {fmt(PORTFOLIO.crypto)}
          </div>
          {hasWall && (
            <div className="num mt-0.5 text-[12px] text-sq-muted">
              + My Wall :{' '}
              {wallValue != null ? (
                <Money value={wallValue} unit="CHF" unitClassName="ml-1" />
              ) : wallValue === null ? (
                <span title={rates.error ?? undefined}>{tr('rate unavailable', 'taux indisponible')}</span>
              ) : null}
            </div>
          )}
        </Tile>
        <Tile to="/sq/bank">
          <TileHead icon={<Banknote size={16} strokeWidth={1.75} />} label="Cash" />
          <div className="num mt-1 text-[16px] font-semibold">
            {fmt(cash)}
          </div>
        </Tile>
        <Tile to="/sq/bank">
          <TileHead icon={<WalletCards size={16} strokeWidth={1.75} />} label={tr('Buying power', 'Pouvoir d’achat')} />
          <div className="num mt-1 text-[16px] font-semibold">
            {fmt(PORTFOLIO.buyingPower)}
          </div>
        </Tile>
        <div className="col-span-2 mt-3 flex justify-around">
          <UnavailableAction icon={<ArrowLeftRight size={20} strokeWidth={1.75} />} label={tr('Open orders', 'Ordres en cours')} active={why === 'orders'} onClick={() => setWhy(why === 'orders' ? null : 'orders')} />
          <UnavailableAction icon={<List size={20} strokeWidth={1.75} />} label="Transactions" active={why === 'tx'} onClick={() => setWhy(why === 'tx' ? null : 'tx')} />
          <UnavailableAction icon={<CirclePlus size={20} strokeWidth={1.75} />} label={tr('Add money', 'Ajouter des fonds')} active={why === 'add'} onClick={() => setWhy(why === 'add' ? null : 'add')} />
        </div>
        {why && (
          <p id="home-action-why" role="status" className="col-span-2 flex gap-2 rounded-[10px] bg-sq-surface px-3 py-2 text-[13px] text-sq-ink-2">
            <Info size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-sq-muted" />
            <span>
              {unavailable[why as keyof typeof unavailable]}
              {why === 'tx' && hasWall && (
                <>
                  {' '}
                  <Link to="/wallet/transactions" className="font-medium text-sq-orange underline">
                    {tr('Open My Wall history', 'Ouvrir l’historique My Wall')}
                  </Link>
                </>
              )}
            </span>
          </p>
        )}
        <p className="col-span-2 text-center text-[11px] text-sq-muted">
          {tr('Account values', 'Valeurs du compte')} <MockBadge label={tr('Fictitious', 'Fictives')} />
          {hasWall && ` · ${tr('My Wall: on-chain balance × indicative CoinGecko rate', 'My Wall : solde on-chain × taux indicatif CoinGecko')}`}
        </p>
      </div>

      <HomeMarkets />
    </div>
  );
}

/** Small "Markets" section with real quotes (click → instrument page). */
function HomeMarkets() {
  const { data, error } = useQuotes(HOME_QUOTES);
  const byId = new Map((data?.quotes ?? []).map((q) => [q.id, q]));
  return (
    <Card className="mt-4 px-0 pb-1 pt-4 lg:col-span-12 lg:mt-0">
      <div className="flex items-center justify-between px-5">
        <h2 className="text-[17px] font-semibold">{tr('Markets', 'Marchés')}</h2>
        <Link to="/sq/markets?tab=markets" className="inline-flex min-h-11 items-center gap-1 text-[15px] text-sq-orange">
          {tr('See all', 'Tout voir')} <ChevronRight size={16} strokeWidth={1.75} />
        </Link>
      </div>
      {error && !data ? (
        <p className="px-5 pb-3 text-[13px] text-sq-down">
          {tr('Market data unavailable', 'Données de marché indisponibles')} ({error}).
        </p>
      ) : (
        <ul className="lg:grid lg:grid-cols-5">
          {HOME_QUOTES.map((id) => {
            const q = byId.get(id);
            return (
              <li key={id}>
                <Link to={instrumentPath(id)} className="flex min-h-[60px] items-center gap-3 px-5 py-2 hover:bg-sq-bg/60 lg:flex-col lg:items-start lg:gap-1">
                  {q ? (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] text-sq-ink">{q.symbol}</span>
                        <span className="num block truncate text-[11px] text-sq-muted">
                          {q.stale ? `${tr('stale', 'périmé')} · ` : ''}
                          {rowTime(q)} · {q.provider}
                        </span>
                      </span>
                      <span className="num whitespace-nowrap text-[14px]">
                        {fmtPrice(q.price)} <span className="text-[11px]">{q.currency}</span>
                      </span>
                      <ChangeTag pct={q.changePct} />
                    </>
                  ) : (data?.errors as Record<string, string> | undefined)?.[id] ? (
                    <span className="text-[13px] text-sq-muted">
                      {id.slice(3)} — {tr('unavailable', 'indisponible')}
                    </span>
                  ) : (
                    <Skeleton className="h-6 w-full" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="px-5 pb-3 text-[11px] text-sq-muted">{tr('Real market data — Yahoo Finance (exchange data, delayed or last close) / CoinGecko (crypto, CHF). For information only.', 'Données de marché réelles — Yahoo Finance (bourse, différé ou dernière clôture) / CoinGecko (crypto, CHF). À titre informatif.')}</p>
    </Card>
  );
}

/** Round action that is not available in the prototype: looks disabled, explains why when activated. */
function UnavailableAction({ icon, label, onClick, active }: { icon: ReactNode; label: string; onClick: () => void; active: boolean }) {
  return (
    <button type="button" aria-disabled="true" aria-expanded={active} aria-controls="home-action-why" onClick={onClick} className="group flex min-w-[84px] flex-col items-center gap-2 rounded-lg p-1">
      <span className="flex size-12 items-center justify-center rounded-full bg-sq-dark text-white opacity-45">{icon}</span>
      <span className="text-[13px] font-medium text-sq-ink">{label}</span>
      <span className="-mt-1.5 text-[10px] text-sq-muted">{tr('Unavailable', 'Indisponible')}</span>
    </button>
  );
}

function TileHead({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[14px] text-sq-ink">
      <span className="text-sq-orange">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight size={16} strokeWidth={1.75} className="text-sq-muted" />
    </div>
  );
}
