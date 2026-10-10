import { useMemo, useState } from 'react';
import { ArrowLeftRight, Banknote, ChartNoAxesColumn, ChevronRight, CirclePlus, List, WalletCards, Bitcoin } from 'lucide-react';
import { MOCK_ETH_CHF, MOCK_USDC_CHF } from '@sq/shared';
import { bank, cosigner } from '../lib/api';
import { useLocal, usePoll } from '../lib/hooks';
import { Amount, Card, cx, fmt, MockBadge, RoundAction, Tile } from '../components/ui';
import { Money, setPrefs } from '../lib/prefs';
import { SqMobileTop } from './SqShell';
import { PORTFOLIO } from './mockMarkets';

/** Thin blue line chart with a very light gradient (hand-made SVG, no chart library). */
function LineChart({ data }: { data: number[] }) {
  const w = 600;
  const h = 150;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 10 - ((v - min) / (max - min || 1)) * (h - 30)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" preserveAspectRatio="none" role="img" aria-label="Évolution de la valeur du portefeuille">
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

export default function SqHome() {
  const { session, device } = useLocal();
  const clientId = session?.clientId;
  const [period, setPeriod] = useState('1W');
  const bankInfo = usePoll(() => bank.get(`/clients/${clientId}`), 15000, [clientId]);
  const wall = usePoll(
    async () => {
      if (!clientId) return null;
      const c = await cosigner.get(`/clients/${clientId}`).catch(() => null);
      if (c?.preferences) setPrefs(c.preferences); // respect "masquer les montants" here too
      if (!c?.safeAddress) return { privacy: c?.privacy, value: null };
      const on = await cosigner.get(`/clients/${clientId}/onchain`);
      return { privacy: c.privacy as string, value: Number(on.usdc) * MOCK_USDC_CHF + Number(on.eth) * MOCK_ETH_CHF + (on.simulatedUsdc ?? 0) * MOCK_USDC_CHF };
    },
    15000,
    [clientId, device?.safeAddress],
  );

  const cash = bankInfo.data?.accounts?.CHF ?? 31000;
  const total = PORTFOLIO.assets + PORTFOLIO.crypto + cash;
  const series = useMemo(() => {
    const s = PORTFOLIO.series[period];
    const k = total / s[s.length - 1];
    return s.map((v) => v * k);
  }, [period, total]);
  const showWall = wall.data?.value != null && wall.data.privacy !== 'none';

  return (
    <div className="lg:grid lg:grid-cols-12 lg:gap-6">
      <div className="lg:col-span-12">
        <SqMobileTop />
        <div className="pb-5 pt-2 text-center lg:pt-0 lg:text-left">
          <div className="text-[16px] text-sq-ink-2">Total value</div>
          <Amount value={total} className="text-[32px] lg:text-[40px]" />
        </div>
      </div>

      <Card className="lg:col-span-8">
        <div className="text-[16px] text-sq-ink-2">{PORTFOLIO.account}</div>
        <div className="mt-3 flex items-center gap-2">
          <span className="num text-[24px] font-semibold">{fmt(total)}</span>
          <span className="rounded-full bg-sq-chip px-1.5 py-0.5 text-[11px] font-semibold">CHF</span>
        </div>
        <div className="num mt-1 text-[14px] text-sq-ink-2">
          <span className="font-medium text-sq-up">
            + {fmt(PORTFOLIO.dailyChange)} CHF ▲ {fmt(PORTFOLIO.dailyChangePct)}%
          </span>{' '}
          daily change
        </div>
        <div className="num text-[14px] text-sq-ink-2">
          <span className="font-medium text-sq-up">+ {fmt(PORTFOLIO.absolutePerf)} CHF</span> absolute performance
        </div>
        <div className="mt-3">
          <LineChart data={series} />
        </div>
        <div className="mt-2 grid grid-cols-5 rounded-full bg-sq-bg p-1" role="tablist" aria-label="Période">
          {['1W', '1M', '6M', '1Y', 'All'].map((p) => (
            <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)} className={cx('min-h-9 rounded-full text-[14px]', period === p ? 'bg-white font-semibold shadow-sm' : 'text-sq-ink-2')}>
              {p}
            </button>
          ))}
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:col-span-4 lg:mt-0 lg:content-start">
        <Tile>
          <TileHead icon={<ChartNoAxesColumn size={16} strokeWidth={1.75} />} label="Assets" />
          <div className="num mt-1 text-[16px] font-semibold">{fmt(PORTFOLIO.assets)}</div>
        </Tile>
        <Tile>
          <TileHead icon={<Bitcoin size={16} strokeWidth={1.75} />} label="Crypto" />
          <div className="num mt-1 text-[16px] font-semibold">{showWall ? <Money value={PORTFOLIO.crypto + wall.data!.value!} /> : fmt(PORTFOLIO.crypto)}</div>
          {showWall && (
            <div className="num mt-0.5 text-[12px] text-sq-muted">
              dont My Wall : <Money value={wall.data!.value!} unit="CHF" unitClassName="ml-1" />
            </div>
          )}
        </Tile>
        <Tile>
          <TileHead icon={<Banknote size={16} strokeWidth={1.75} />} label="Cash" />
          <div className="num mt-1 text-[16px] font-semibold">{fmt(cash)}</div>
        </Tile>
        <Tile>
          <TileHead icon={<WalletCards size={16} strokeWidth={1.75} />} label="Buying power" />
          <div className="num mt-1 text-[16px] font-semibold">{fmt(PORTFOLIO.buyingPower)}</div>
        </Tile>
        <div className="col-span-2 mt-3 flex justify-around">
          <RoundAction icon={<ArrowLeftRight size={20} strokeWidth={1.75} />} label="Open orders" />
          <RoundAction icon={<List size={20} strokeWidth={1.75} />} label="Transactions" />
          <RoundAction icon={<CirclePlus size={20} strokeWidth={1.75} />} label="Add money" />
        </div>
        <p className="col-span-2 text-center text-[11px] text-sq-muted">
          Valeurs du compte <MockBadge label="Fictives" />
        </p>
      </div>
    </div>
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
