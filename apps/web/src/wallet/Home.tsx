import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, CalendarClock, ChevronRight, ExternalLink, KeySquare, Landmark, ShieldCheck, SlidersHorizontal, Sparkles } from 'lucide-react';
import { PLANS } from '@sq/shared';
import { visibleWidgets, type WidgetId } from '@sq/shared/widgets';
import { Money, usePrefs } from '../lib/prefs';
import { explorerAddress } from '@sq/shared';
import { tr } from '../lib/i18n';
import { fmtChf, RateNote, sumValues, useRates, valueOf } from '../lib/valuation';
import { CryptoList } from './CryptoList';
import { AssetDot } from '../lib/assetColors';
import { PortfolioChart } from './PortfolioChart';
import { bank, cosigner } from '../lib/api';
import { useLocal, usePoll, useWalletData, useWalletTxs } from '../lib/hooks';
import { UpgradeSecurityBanner } from '../components/ProtectionCard';
import { Amount, Button, Card, cx, Field, fmt, inputCls, MockBadge, NetBadge, Notice, RoundAction, Spinner, useMedia } from '../components/ui';
import { useCountUp } from '../components/Confirm';
import { useCompactBar } from './WalletShell';
import { TxListCompact, TxTable } from './TxList';
import { InfoBoard } from './Info';
import { useIsDesktopLayout } from '../lib/platform';
import { useMobileStyle } from '../lib/mobileStyle';
import { useWidgetLayout } from '../lib/widgets';
import { WidgetCustomizer } from './WidgetCustomizer';

/** Widgets shown in a narrow side column next to a wide one (desktop / tablet grids). */
const NARROW: WidgetId[] = ['account', 'security', 'fees', 'scheduled', 'approvals'];
/** Desktop 12-column spans (the default order reproduces the original desktop layout exactly). */
const DESKTOP_SPAN: Partial<Record<WidgetId, string>> = { crypto: 'col-span-5', chart: 'col-span-7', recent: 'col-span-8', info: 'col-span-12', balances: 'col-span-12', actions: 'col-span-12' };

export default function Home() {
  const { device, session } = useLocal();
  const clientId = device!.clientId;
  const { data, error, reload } = useWalletData(6000);
  const txs = useWalletTxs(4000);
  const bankInfo = usePoll(() => bank.get(`/clients/${clientId}`), 10000, [clientId]);
  const isDesktop = useMedia('(min-width: 1024px)');
  const isTablet = useMedia('(min-width: 768px)');
  const mobile = useMobileStyle(); // N7: native app / real touch phone only
  const layoutKind = useIsDesktopLayout() ? 'desktop' : 'mobile';
  const { layout, dispatch, save } = useWidgetLayout(clientId, layoutKind);
  const [customizing, setCustomizing] = useState(false);
  const setCompact = useCompactBar();
  const sentinel = useRef<HTMLDivElement>(null);
  const transferRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  const { prefs } = usePrefs();
  const { rates, loading: ratesLoading } = useRates();
  const usdc = Number(data?.onchain?.usdc ?? 0);
  const eth = Number(data?.onchain?.eth ?? 0);
  const sim = Number(data?.onchain?.simulatedUsdc ?? 0);
  // Real indicative prices (no fixed rate): a held asset without a price makes the total unavailable, not wrong.
  const usdcValue = valueOf(usdc + sim, rates.USDC);
  const ethValue = valueOf(eth, rates.ETH);
  const totalOrNull = sumValues([usdcValue, ethValue]);
  const total = totalOrNull ?? 0;
  const prev = useRef(0);
  const shownTotal = useCountUp(total, prev.current);
  useEffect(() => {
    prev.current = total;
  }, [total]);

  // Compact sticky bar once the content sheet covers the balances.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting && e.boundingClientRect.top < 100 ? `My Wall · ${totalOrNull === null ? '—' : fmt(total)} CHF` : null), { rootMargin: '-72px 0px 0px 0px' });
    io.observe(el);
    return () => {
      io.disconnect();
      setCompact(null);
    };
  }, [total, totalOrNull, setCompact, customizing]);

  const hidden = (id: string) => prefs.hiddenWallets.includes(id);
  const visible = visibleWidgets(layout);
  const accountShown = visible.includes('account') && !hidden('swissquote-account');

  const revoked = data?.onchain?.deployed && data.onchain.owners && !data.onchain.owners.map((o: string) => o.toLowerCase()).includes(device!.deviceAddress.toLowerCase());

  const simulate = async () => {
    await cosigner.post(`/clients/${clientId}/simulate-receive`, { amount: '250' });
    void txs.reload();
  };
  const toAccount = () => transferRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // ── Balances widget parts ──
  const totalBlock = (
    <div className={cx(isDesktop && 'col-span-5')} data-widget="balances">
      <div className={cx('flex items-center gap-1 text-[15px] text-sq-ink-2', !isDesktop && 'justify-center')}>
        {tr('Total value', 'Valeur totale')} · {session?.profile?.name?.split(' ')[0]}
      </div>
      {totalOrNull === null ? (
        <span className={cx('num mt-1 block font-semibold tracking-tight', isDesktop ? 'text-[48px]' : 'text-[40px]')}>
          —<span className="ml-1 text-[0.6em] font-normal">CHF</span>
        </span>
      ) : (
        <Amount value={shownTotal} className={cx('mt-1 block', isDesktop ? 'text-[48px]' : 'text-[40px]')} />
      )}
      <BalanceMeta center={!isDesktop} sim={sim} rates={rates} ratesLoading={ratesLoading} safe={device!.safeAddress!} />
    </div>
  );
  const tiles = (
    <div className={cx(isDesktop ? 'col-span-4 grid grid-cols-2 gap-3' : 'mt-5 grid grid-cols-2 gap-3 text-left')}>
      {!hidden('mywall-usdc') && <AssetTile sym="USDC" name="USD Coin" amount={usdc + sim} chfv={usdcValue} />}
      {!hidden('mywall-eth') && <AssetTile sym="ETH" name="Ether" amount={eth} chfv={ethValue} decimals={4} />}
      {prefs.hiddenWallets.length > 0 && (
        <Link to="/settings" className="col-span-2 text-[12px] text-sq-muted underline underline-offset-2">
          {tr(`${prefs.hiddenWallets.length} item(s) hidden from view — Settings`, `${prefs.hiddenWallets.length} élément(s) masqué(s) de l’affichage — Paramètres`)}
        </Link>
      )}
    </div>
  );
  const actionsBlock = (
    <div className={cx(isDesktop ? 'col-span-3 flex justify-end gap-2' : 'mt-6 flex justify-center gap-6')} data-widget="actions">
      <RoundAction icon={<ArrowUpRight size={20} strokeWidth={1.75} />} label={tr('Send', 'Envoyer')} to="/send" />
      <RoundAction icon={<ArrowDownLeft size={20} strokeWidth={1.75} />} label={tr('Receive', 'Recevoir')} to="/asset/USDC#receive" />
      {accountShown && <RoundAction icon={<Landmark size={20} strokeWidth={1.75} />} label={isDesktop ? tr('From the account', 'Depuis le compte') : tr('From my account', 'Depuis mon compte')} onClick={toAccount} />}
    </div>
  );

  // ── Content widgets (shared by every layout) ──
  const recent = (
    <Card className="min-w-0">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[17px] font-semibold">{tr('Recent transactions', 'Transactions récentes')}</h2>
        <Link to="/wallet/transactions" className="inline-flex min-h-11 items-center gap-0.5 text-[14px] font-medium text-sq-ink-2 hover:text-sq-ink">
          {tr('See all', 'Tout voir')} <ChevronRight size={16} strokeWidth={1.75} />
        </Link>
      </div>
      {isDesktop ? (
        <TxTable items={(txs.data ?? []).slice(0, 8)} clientName={session?.profile?.name ?? ''} loading={txs.loading && !txs.data} />
      ) : (
        <TxListCompact items={(txs.data ?? []).slice(0, 5)} loading={txs.loading && !txs.data} />
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-sq-line pt-3">
        <Button variant="secondary" className="min-h-11 w-auto px-4 text-[14px]" onClick={simulate}>
          <Sparkles size={16} strokeWidth={1.75} /> {tr('Simulate an incoming payment (demo)', 'Simuler une réception (démo)')}
        </Button>
        <MockBadge />
      </div>
    </Card>
  );

  const content: Partial<Record<WidgetId, ReactNode>> = {
    crypto: <CryptoList onchain={data?.onchain} rates={rates} ratesLoading={ratesLoading} variant={mobile ? 'cards' : 'list'} onCustomize={mobile ? () => setCustomizing(true) : undefined} />,
    chart: <PortfolioChart clientId={clientId} />,
    recent,
    account: hidden('swissquote-account') ? null : (
      <div ref={transferRef}>
        <BankTransfer clientId={clientId} safe={device!.safeAddress!} bankData={bankInfo.data} onDone={() => void reload()} />
      </div>
    ),
    security: (
      <Card>
        <Link to="/wallet/security" className="flex items-center gap-3">
          <ShieldCheck size={22} strokeWidth={1.75} className="text-sq-ink-2" />
          <span className="flex-1">
            <span className="block text-[15px] font-semibold">{tr('Security', 'Sécurité')}</span>
            <span className="block text-[13px] text-sq-muted">{tr('2 of 3 keys required · linked device · recovery kit', '2 clés sur 3 requises · appareil lié · kit de récupération')}</span>
          </span>
          <ChevronRight size={18} strokeWidth={1.75} className="text-sq-muted" />
        </Link>
      </Card>
    ),
    fees: <FeesBox data={data} />,
    scheduled: <ScheduledWidget clientId={clientId} />,
    approvals: <ApprovalsWidget clientId={clientId} />,
    info: isDesktop ? (
      <>
        <h2 className="mb-3 mt-2 text-[17px] font-semibold">{tr('Information', 'Informations')}</h2>
        <InfoBoard limit={4} />
      </>
    ) : isTablet && !mobile ? (
      <InfoBoard limit={4} />
    ) : (
      <div className="space-y-4">
        <InfoBoard limit={4} />
        <Button variant="ghost" onClick={() => nav('/wallet/info')}>
          {tr('All information', 'Toutes les informations')}
        </Button>
      </div>
    ),
  };

  const notices = (
    <>
      {error && <Notice tone="warn" title={tr('Could not refresh', 'Actualisation impossible')} className="mb-3">{error}</Notice>}
      {revoked && (
        <Notice tone="bad" title={tr('This device has been revoked', 'Cet appareil a été révoqué')} className="mb-3">
          {tr('Its key is no longer part of your wallet. Use “I lost my device” on your new device.', "Sa clé ne fait plus partie de votre wallet. Utilisez « J'ai perdu mon appareil » sur votre nouvel appareil.")}
        </Notice>
      )}
      {!revoked && device?.safeAddress && <UpgradeSecurityBanner clientId={clientId} safeAddress={device.safeAddress} />}
    </>
  );

  const customizeButton = (
    <div className={cx('flex', isDesktop ? 'justify-end pt-1' : 'justify-center')}>
      <Button variant="ghost" className="w-auto px-4 text-[14px]" onClick={() => setCustomizing(true)} ariaLabel={tr('Customize home', 'Personnaliser l’accueil')}>
        <SlidersHorizontal size={16} strokeWidth={1.75} /> {tr('Customize home', 'Personnaliser l’accueil')}
      </Button>
    </div>
  );

  if (customizing)
    return (
      <div>
        {notices}
        <WidgetCustomizer
          layout={layout}
          dispatch={dispatch}
          kind={layoutKind}
          save={save}
          onDone={() => {
            setCustomizing(false);
            window.scrollTo({ top: 0 });
          }}
        />
      </div>
    );

  // ── N7 mobile style (native app / touch phone): one column of rounded cards, balance → actions → assets. ──
  if (mobile) {
    const items: ReactNode[] = [];
    for (let i = 0; i < visible.length; i++) {
      const id = visible[i];
      if (id === 'balances') {
        const merged = visible[i + 1] === 'actions';
        if (merged) i++;
        items.push(
          <Fragment key="balances">
            <section aria-label={tr('Balances', 'Soldes')} className="mw-m-balance rounded-[22px] bg-sq-surface p-5" data-widget="balances">
              <div className="text-[14px] text-sq-ink-2">
                {tr('Total value', 'Valeur totale')} · {session?.profile?.name?.split(' ')[0]}
              </div>
              {totalOrNull === null ? (
                <span className="num mt-1 block text-[36px] font-semibold tracking-tight">
                  —<span className="ml-1 text-[0.6em] font-normal">CHF</span>
                </span>
              ) : (
                <Amount value={shownTotal} className="mt-1 block text-[36px] leading-tight" />
              )}
              <BalanceMeta sim={sim} rates={rates} ratesLoading={ratesLoading} safe={device!.safeAddress!} />
              {!visible.includes('crypto') && tiles}
              {merged && <MobileActions accountShown={accountShown} onAccount={toAccount} className="mt-5" />}
            </section>
            <div ref={sentinel} aria-hidden className="h-px" />
          </Fragment>,
        );
      } else if (id === 'actions') {
        items.push(
          <section key="actions" aria-label={tr('Main actions', 'Actions principales')} className="rounded-[22px] bg-sq-surface p-4" data-widget="actions">
            <MobileActions accountShown={accountShown} onAccount={toAccount} />
          </section>,
        );
      } else if (content[id]) {
        items.push(
          <div key={id} data-widget={id} className="min-w-0">
            {content[id]}
          </div>,
        );
      }
    }
    return (
      <div className="mw-m-home space-y-4 pt-1">
        {notices}
        {items}
        {customizeButton}
      </div>
    );
  }

  // ── Existing layouts (desktop, tablet, narrow window): balances + actions in the sticky hero when they lead. ──
  const headLen = (() => {
    let n = 0;
    while (n < visible.length && (visible[n] === 'balances' || visible[n] === 'actions')) n++;
    return n;
  })();
  const head = visible.slice(0, headLen);
  const rest = visible.slice(headLen);
  const hero = (
    <section aria-label={tr('Balances', 'Soldes')} className={cx(isDesktop ? 'grid grid-cols-12 items-end gap-6 pb-8' : 'pb-6 pt-3 text-center')}>
      {head.map((id) =>
        id === 'balances' ? (
          <Fragment key="b">
            {totalBlock}
            {tiles}
          </Fragment>
        ) : (
          <Fragment key="a">{actionsBlock}</Fragment>
        ),
      )}
    </section>
  );
  const sheetNode = (id: WidgetId): ReactNode =>
    id === 'balances' ? (
      <Card as="section" className="text-center">
        {totalBlock}
        {tiles}
      </Card>
    ) : id === 'actions' ? (
      <Card>{actionsBlock}</Card>
    ) : (
      content[id]
    );
  // Group consecutive narrow widgets into one side column (as the original desktop/tablet layout did).
  const groups: { ids: WidgetId[]; narrow: boolean }[] = [];
  for (const id of rest) {
    if (!sheetNode(id)) continue;
    const narrow = NARROW.includes(id);
    const last = groups[groups.length - 1];
    if (narrow && last?.narrow) last.ids.push(id);
    else groups.push({ ids: [id], narrow });
  }
  const groupNode = (g: { ids: WidgetId[]; narrow: boolean }) =>
    g.narrow ? (
      <div className="min-w-0 space-y-4">
        {g.ids.map((id) => (
          <div key={id} data-widget={id}>
            {sheetNode(id)}
          </div>
        ))}
      </div>
    ) : (
      <div data-widget={g.ids[0]} className="min-w-0">
        {sheetNode(g.ids[0])}
      </div>
    );

  return (
    <div>
      {notices}
      {/* Balances stay underneath (sticky); the white sheet slides over them on scroll. */}
      {head.length > 0 && <div className={cx('sticky z-0', isDesktop ? 'top-16' : 'top-14')}>{hero}</div>}
      <div ref={sentinel} aria-hidden className="h-px" />
      <div className={cx('relative z-10 -mx-4 rounded-t-[16px] bg-sq-surface px-4 pb-4 shadow-[0_-6px_20px_rgba(0,0,0,0.06)] [&_.mw-card]:border [&_.mw-card]:border-sq-line [&_.mw-card]:shadow-none', isDesktop && '-mx-6 px-6 pt-6')}>
        {!isDesktop && <SheetHandle />}
        {isDesktop ? (
          <div className="grid grid-flow-row-dense grid-cols-12 gap-5">
            {groups.map((g) => (
              <div key={g.ids.join('+')} className={g.narrow ? 'col-span-4' : DESKTOP_SPAN[g.ids[0]] ?? 'col-span-6'}>
                {groupNode(g)}
              </div>
            ))}
          </div>
        ) : isTablet ? (
          <div className="grid grid-flow-row-dense grid-cols-2 gap-4">
            {groups.map((g) => (
              <div key={g.ids.join('+')} className={!g.narrow && ['info', 'balances', 'actions'].includes(g.ids[0]) ? 'col-span-2' : 'min-w-0'}>
                {groupNode(g)}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <Fragment key={g.ids.join('+')}>{groupNode(g)}</Fragment>
            ))}
          </div>
        )}
        {customizeButton}
      </div>
    </div>
  );
}

function BalanceMeta({ center, sim, rates, ratesLoading, safe }: { center?: boolean; sim: number; rates: any; ratesLoading?: boolean; safe: string }) {
  return (
    <>
      <div className={cx('mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-sq-muted', center && 'justify-center')}>
        <RateNote rates={rates} assets={['ETH', 'USDC']} loading={ratesLoading} />
        <NetBadge />
        <a className="inline-flex min-h-6 items-center gap-1 hover:text-sq-ink" href={explorerAddress(safe)} target="_blank" rel="noreferrer">
          {safe.slice(0, 6)}…{safe.slice(-4)} <ExternalLink size={12} strokeWidth={1.75} />
        </a>
      </div>
      {sim > 0 && (
        <div className="mt-1 text-[12px] text-sq-muted">
          {tr('incl.', 'dont')} <Money value={sim} unit="USDC" unitClassName="ml-1" /> {tr('simulated', 'simulés')} <MockBadge label={tr('Demo', 'Démo')} />
        </div>
      )}
    </>
  );
}

/** N7: the two main actions as large rounded buttons side by side (thumb reach), the account transfer below. */
function MobileActions({ accountShown, onAccount, className }: { accountShown: boolean; onAccount: () => void; className?: string }) {
  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-3">
        <Link to="/send" className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-sq-orange px-4 text-[16px] font-semibold text-white active:bg-sq-orange-600">
          <ArrowUpRight size={20} strokeWidth={2} aria-hidden /> {tr('Send', 'Envoyer')}
        </Link>
        <Link to="/asset/USDC#receive" className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-sq-chip px-4 text-[16px] font-semibold text-sq-ink active:bg-sq-line">
          <ArrowDownLeft size={20} strokeWidth={2} aria-hidden /> {tr('Receive', 'Recevoir')}
        </Link>
      </div>
      {accountShown && (
        <button type="button" onClick={onAccount} className="mt-2.5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-sq-line text-[14px] font-medium text-sq-ink-2">
          <Landmark size={17} strokeWidth={1.75} aria-hidden /> {tr('From my Swissquote account', 'Depuis mon compte Swissquote')}
        </button>
      )}
    </div>
  );
}

function FeesBox({ data }: { data: any }) {
  return (
    <div className="rounded-[10px] border border-sq-line bg-sq-surface px-4 py-3 text-[13px] text-sq-ink-2 mw-fees">
      <div className="mb-1 font-semibold text-sq-ink">{tr('Your fees', 'Vos frais')}</div>
      <ul className="space-y-0.5">
        <li>
          <Link to="/wallet/plans#frais" className="underline-offset-2 hover:underline">{tr('Send*', 'Envoyer*')}</Link>{tr(': no commission, network fees paid by Swissquote', ' : aucune commission, frais réseau offerts par Swissquote')}
        </li>
        <li>
          <Link to="/wallet/plans#frais" className="underline-offset-2 hover:underline">{tr('Receive*', 'Recevoir*')}</Link>{tr(': free', ' : gratuit')}
        </li>
        <li>
          {tr('Swap: commission', 'Échanger : commission')} {((PLANS[(data?.client?.plan ?? 'free') as 'free'].commissionBps) / 100).toFixed(2)} % ({tr('plan', 'offre')} {(data?.client?.plan ?? 'free') === 'free' ? tr('Free', PLANS.free.name) : PLANS[data?.client?.plan as 'free'].name})
        </li>
      </ul>
      {data?.client?.usage ? <div className="mt-1 text-sq-muted">{data.client.usage.sponsoredTx}/20 {tr('free transactions used today.', "transactions offertes utilisées aujourd'hui.")}</div> : null}
      <Link to="/wallet/plans#frais" className="mt-1 inline-block text-[12px] text-sq-muted underline underline-offset-2">
        {tr('* Applicable fees in detail', '* Détail des frais applicables')}
      </Link>
    </div>
  );
}

/** Optional widget: scheduled payments and reminders still open (never sent automatically). */
function ScheduledWidget({ clientId }: { clientId: string }) {
  const { data } = usePoll<any[]>(() => cosigner.get(`/clients/${clientId}/scheduled`), 30000, [clientId]);
  const open = (data ?? []).filter((s) => s.status !== 'done');
  const due = open.filter((s) => s.status === 'due').length;
  return (
    <Card>
      <Link to="/wallet/scheduled" className="flex items-center gap-3">
        <CalendarClock size={22} strokeWidth={1.75} className="text-sq-ink-2" />
        <span className="flex-1">
          <span className="block text-[15px] font-semibold">{tr('Scheduled payments', 'Paiements planifiés')}</span>
          <span className={cx('block text-[13px]', due ? 'text-sq-warn' : 'text-sq-muted')}>
            {!data ? '…' : due ? tr(`${due} to confirm now`, `${due} à confirmer maintenant`) : open.length ? tr(`${open.length} upcoming`, `${open.length} à venir`) : tr('None planned', 'Aucun prévu')}
          </span>
        </span>
        <ChevronRight size={18} strokeWidth={1.75} className="text-sq-muted" />
      </Link>
    </Card>
  );
}

/** Optional widget: spending approvals granted to apps. */
function ApprovalsWidget({ clientId }: { clientId: string }) {
  const { data } = usePoll<any[]>(() => cosigner.get(`/clients/${clientId}/allowances`), 60000, [clientId]);
  return (
    <Card>
      <Link to="/wallet/approvals" className="flex items-center gap-3">
        <KeySquare size={22} strokeWidth={1.75} className="text-sq-ink-2" />
        <span className="flex-1">
          <span className="block text-[15px] font-semibold">{tr('Authorised apps', 'Applications autorisées')}</span>
          <span className="block text-[13px] text-sq-muted">
            {!data ? '…' : data.length ? tr(`${data.length} active approval(s)`, `${data.length} autorisation(s) active(s)`) : tr('No active approval', 'Aucune autorisation active')}
          </span>
        </span>
        <ChevronRight size={18} strokeWidth={1.75} className="text-sq-muted" />
      </Link>
    </Card>
  );
}

/** Mobile handle: tap or drag to expand / collapse the sheet (it simply scrolls — never blocks scrolling). */
function SheetHandle() {
  const start = useRef<{ y: number; scroll: number } | null>(null);
  const toggle = () => {
    const expanded = window.scrollY > 120;
    window.scrollTo({ top: expanded ? 0 : 340, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return (
    <button
      type="button"
      aria-label={tr('Expand or collapse the panel', 'Développer ou réduire le volet')}
      onClick={toggle}
      onPointerDown={(e) => {
        start.current = { y: e.clientY, scroll: window.scrollY };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        window.scrollTo({ top: start.current.scroll + (start.current.y - e.clientY) });
      }}
      onPointerUp={() => (start.current = null)}
      style={{ touchAction: 'none' }}
      className="mx-auto flex h-7 w-full items-center justify-center"
    >
      <span className="h-1 w-9 rounded-full bg-sq-line" />
    </button>
  );
}

function AssetTile({ sym, name, amount, chfv, decimals = 2 }: { sym: string; name: string; amount: number; chfv: number | null; decimals?: number }) {
  return (
    <Link to={`/asset/${sym}`} className="block rounded-[10px] border border-sq-line bg-sq-surface px-3.5 py-3 transition-colors hover:border-sq-muted/50">
      <div className="flex items-center gap-1.5 text-[13px] text-sq-ink-2">
        <AssetDot symbol={sym} />
        <span className="flex-1">{name}</span>
        <ChevronRight size={16} strokeWidth={1.75} className="text-sq-muted" />
      </div>
      <div className="num mt-1 text-[17px] font-semibold">
        <Money value={amount} decimals={decimals} unit={sym} unitClassName="ml-1 text-[12px] font-normal" />
      </div>
      <div className="num text-[12px] text-sq-muted">
        {chfv === null ? tr('CHF value unavailable', 'Contre-valeur indisponible') : chfv > 0 && chfv < 0.01 ? `${fmtChf(chfv)} CHF` : <Money value={chfv ?? 0} unit="CHF" unitClassName="ml-1" />}
      </div>
    </Link>
  );
}

function BankTransfer({ clientId, safe, bankData, onDone }: { clientId: string; safe: string; bankData: any; onDone: () => void }) {
  const [amount, setAmount] = useState('5');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const verified = bankData?.verifiedWallets?.some((w: any) => w.address.toLowerCase() === safe.toLowerCase());

  const go = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await bank.post(`/clients/${clientId}/transfer-to-wallet`, { amount: Number(amount), address: safe });
      setMsg({ tone: 'ok', text: tr(`Transfer of ${amount} USDC sent. It shows as “pending”, then “confirmed” in your transactions.`, `Virement de ${amount} USDC envoyé. Il apparaît « en attente » puis « confirmé » dans vos transactions.`) });
      onDone();
    } catch (e: any) {
      setMsg({ tone: 'bad', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[17px] font-semibold">{tr('Swissquote account ↔ wallet', 'Compte Swissquote ↔ wallet')}</h2>
        <MockBadge label={tr('Simulated bank', 'Banque simulée')} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-[10px] border border-sq-line px-3 py-2.5">
          <div className="text-[12px] text-sq-muted">CHF</div>
          <div className="num text-[15px] font-semibold">{bankData ? <Money value={bankData.accounts.CHF} /> : '—'}</div>
        </div>
        <div className="rounded-[10px] border border-sq-line px-3 py-2.5">
          <div className="text-[12px] text-sq-muted">USDC</div>
          <div className="num text-[15px] font-semibold">{bankData ? <Money value={bankData.accounts.USDC} /> : '—'}</div>
        </div>
      </div>
      <p className={cx('text-[12px]', verified ? 'text-sq-up' : 'text-sq-warn')}>
        {verified ? tr('Wallet verified as yours (Travel Rule, EIP-1271 proof).', 'Wallet vérifié comme le vôtre (Travel Rule, preuve EIP-1271).') : tr('Wallet not verified yet.', 'Wallet pas encore vérifié.')}
      </p>
      <Field label={tr('From my account to my wallet (USDC)', 'Depuis mon compte vers mon wallet (USDC)')}>
        <div className="flex gap-2">
          <input className={cx(inputCls, 'num min-w-0 flex-1')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} aria-label={tr('Amount in USDC', 'Montant en USDC')} />
          <Button className="w-32 shrink-0" onClick={go} disabled={busy || !verified || !(Number(amount) > 0)}>
            {busy ? <Spinner /> : tr('Transfer', 'Transférer')}
          </Button>
        </div>
      </Field>
      <p className="text-[12px] text-sq-muted">{tr('To the account: send USDC to your Swissquote account contact from Send.', 'Vers le compte : envoyez des USDC au contact « Compte Swissquote » depuis Envoyer.')}</p>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </Card>
  );
}
