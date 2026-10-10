import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, ExternalLink, Eye, EyeOff, Landmark, ShieldCheck, Sparkles } from 'lucide-react';
import { PLANS } from '@sq/shared';
import { hideAgain, Money, revealAmounts, savePrefs, useMasked, usePrefs } from '../lib/prefs';
import { MOCK_ETH_CHF, MOCK_USDC_CHF, explorerAddress } from '@sq/shared';
import { bank, cosigner } from '../lib/api';
import { useLocal, usePoll, useWalletData, useWalletTxs } from '../lib/hooks';
import { Amount, Button, Card, cx, Field, fmt, inputCls, MockBadge, NetBadge, Notice, RoundAction, Spinner, useMedia } from '../components/ui';
import { useCountUp } from '../components/Confirm';
import { useCompactBar } from './WalletShell';
import { TxListCompact, TxTable } from './TxList';
import { InfoBoard } from './Info';

export default function Home() {
  const { device, session } = useLocal();
  const clientId = device!.clientId;
  const { data, error, reload } = useWalletData(6000);
  const txs = useWalletTxs(4000);
  const bankInfo = usePoll(() => bank.get(`/clients/${clientId}`), 10000, [clientId]);
  const isDesktop = useMedia('(min-width: 1024px)');
  const isTablet = useMedia('(min-width: 768px)');
  const setCompact = useCompactBar();
  const sentinel = useRef<HTMLDivElement>(null);
  const transferRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  const { prefs, revealed } = usePrefs();
  const masked = useMasked();
  const usdc = Number(data?.onchain?.usdc ?? 0);
  const eth = Number(data?.onchain?.eth ?? 0);
  const sim = Number(data?.onchain?.simulatedUsdc ?? 0);
  const total = (usdc + sim) * MOCK_USDC_CHF + eth * MOCK_ETH_CHF;
  const prev = useRef(0);
  const shownTotal = useCountUp(total, prev.current);
  useEffect(() => {
    prev.current = total;
  }, [total]);

  // Compact sticky bar once the content sheet covers the balances.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting && e.boundingClientRect.top < 100 ? `My Wall · ${masked ? '••••••' : fmt(total)} CHF` : null), { rootMargin: '-72px 0px 0px 0px' });
    io.observe(el);
    return () => {
      io.disconnect();
      setCompact(null);
    };
  }, [total, setCompact, masked]);

  const [maskErr, setMaskErr] = useState('');
  const hidden = (id: string) => prefs.hiddenWallets.includes(id);
  const toggleMask = async () => {
    setMaskErr('');
    try {
      if (!prefs.hideAmounts) await savePrefs(clientId, { hideAmounts: true });
      else if (revealed) hideAgain();
      else await revealAmounts(clientId);
    } catch (e: any) {
      setMaskErr(e?.name === 'NotAllowedError' ? 'Vérification annulée : les montants restent masqués.' : `Les montants restent masqués : ${e.message}. Configurez une passkey compatible (Paramètres › Appareils).`);
    }
  };

  const revoked = data?.onchain?.deployed && data.onchain.owners && !data.onchain.owners.map((o: string) => o.toLowerCase()).includes(device!.deviceAddress.toLowerCase());

  const simulate = async () => {
    await cosigner.post(`/clients/${clientId}/simulate-receive`, { amount: '250' });
    void txs.reload();
  };

  const hero = (
    <section aria-label="Soldes" className={cx(isDesktop ? 'grid grid-cols-12 items-end gap-6 pb-8' : 'pb-6 pt-3 text-center')}>
      <div className={cx(isDesktop && 'col-span-5')}>
        <div className={cx('flex items-center gap-1 text-[15px] text-sq-ink-2', !isDesktop && 'justify-center')}>
          Valeur totale · {session?.profile?.name?.split(' ')[0]}
          <button type="button" onClick={toggleMask} className="ml-1 flex size-10 items-center justify-center rounded-full hover:bg-sq-chip/60" aria-label={masked ? 'Afficher les montants (vérification par passkey)' : 'Masquer les montants'} title={masked ? 'Afficher les montants' : 'Masquer les montants'}>
            {masked ? <Eye size={18} strokeWidth={1.75} /> : <EyeOff size={18} strokeWidth={1.75} />}
          </button>
        </div>
        {maskErr && <p className="text-[12px] text-sq-down">{maskErr}</p>}
        <Amount value={shownTotal} className={cx('mt-1 block', isDesktop ? 'text-[48px]' : 'text-[40px]')} />
        <div className={cx('mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-sq-muted', !isDesktop && 'justify-center')}>
          <span>taux indicatifs</span>
          <NetBadge />
          <a className="inline-flex items-center gap-1 hover:text-sq-ink" href={explorerAddress(device!.safeAddress!)} target="_blank" rel="noreferrer">
            {device!.safeAddress!.slice(0, 6)}…{device!.safeAddress!.slice(-4)} <ExternalLink size={12} strokeWidth={1.75} />
          </a>
        </div>
        {sim > 0 && (
          <div className="mt-1 text-[12px] text-sq-muted">
            dont <Money value={sim} unit="USDC" unitClassName="ml-1" /> simulés <MockBadge label="Démo" />
          </div>
        )}
      </div>
      <div className={cx(isDesktop ? 'col-span-4 grid grid-cols-2 gap-3' : 'mt-5 grid grid-cols-2 gap-3 text-left')}>
        {!hidden('mywall-usdc') && <AssetTile sym="USDC" name="USD Coin" amount={usdc + sim} chfv={(usdc + sim) * MOCK_USDC_CHF} />}
        {!hidden('mywall-eth') && <AssetTile sym="ETH" name="Ether" amount={eth} chfv={eth * MOCK_ETH_CHF} decimals={4} />}
        {prefs.hiddenWallets.length > 0 && (
          <Link to="/settings" className="col-span-2 text-[12px] text-sq-muted underline underline-offset-2">
            {prefs.hiddenWallets.length} élément(s) masqué(s) de l’affichage — Paramètres
          </Link>
        )}
      </div>
      <div className={cx(isDesktop ? 'col-span-3 flex justify-end gap-2' : 'mt-6 flex justify-center gap-6')}>
        <RoundAction icon={<ArrowUpRight size={20} strokeWidth={1.75} />} label="Envoyer" to="/send" />
        <RoundAction icon={<ArrowDownLeft size={20} strokeWidth={1.75} />} label="Recevoir" to="/asset/USDC" />
        <RoundAction
          icon={<Landmark size={20} strokeWidth={1.75} />}
          label={isDesktop ? 'Depuis le compte' : 'Depuis mon compte'}
          onClick={() => transferRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
        />
      </div>
    </section>
  );

  const recent = (
    <Card className="min-w-0">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[17px] font-semibold">Transactions récentes</h2>
        <Link to="/wallet/transactions" className="inline-flex min-h-11 items-center gap-0.5 text-[14px] font-medium text-sq-ink-2 hover:text-sq-ink">
          Tout voir <ChevronRight size={16} strokeWidth={1.75} />
        </Link>
      </div>
      {isDesktop ? (
        <TxTable items={(txs.data ?? []).slice(0, 8)} clientName={session?.profile?.name ?? ''} loading={txs.loading && !txs.data} />
      ) : (
        <TxListCompact items={(txs.data ?? []).slice(0, 5)} loading={txs.loading && !txs.data} />
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-sq-line pt-3">
        <Button variant="secondary" className="min-h-11 w-auto px-4 text-[14px]" onClick={simulate}>
          <Sparkles size={16} strokeWidth={1.75} /> Simuler une réception (démo)
        </Button>
        <MockBadge />
      </div>
    </Card>
  );

  const side = (
    <div className="min-w-0 space-y-4">
      {!hidden('swissquote-account') && (
        <div ref={transferRef}>
          <BankTransfer clientId={clientId} safe={device!.safeAddress!} bankData={bankInfo.data} onDone={() => void reload()} />
        </div>
      )}
      <Card>
        <Link to="/wallet/security" className="flex items-center gap-3">
          <ShieldCheck size={22} strokeWidth={1.75} className="text-sq-ink-2" />
          <span className="flex-1">
            <span className="block text-[15px] font-semibold">Sécurité</span>
            <span className="block text-[13px] text-sq-muted">2 clés sur 3 requises · appareil lié · kit de récupération</span>
          </span>
          <ChevronRight size={18} strokeWidth={1.75} className="text-sq-muted" />
        </Link>
      </Card>
      <div className="rounded-[10px] border border-sq-line bg-white px-4 py-3 text-[13px] text-sq-ink-2">
        <div className="mb-1 font-semibold text-sq-ink">Vos frais</div>
        <ul className="space-y-0.5">
          <li>
            <Link to="/wallet/plans#frais" className="underline-offset-2 hover:underline">Envoyer*</Link> : aucune commission, frais réseau offerts par Swissquote
          </li>
          <li>
            <Link to="/wallet/plans#frais" className="underline-offset-2 hover:underline">Recevoir*</Link> : gratuit
          </li>
          <li>
            Échanger : commission {((PLANS[(data?.client?.plan ?? 'free') as 'free'].commissionBps) / 100).toFixed(2)} % (offre {PLANS[(data?.client?.plan ?? 'free') as 'free'].name})
          </li>
        </ul>
        {data?.client?.usage ? <div className="mt-1 text-sq-muted">{data.client.usage.sponsoredTx}/20 transactions offertes utilisées aujourd'hui.</div> : null}
        <Link to="/wallet/plans#frais" className="mt-1 inline-block text-[12px] text-sq-muted underline underline-offset-2">
          * Détail des frais applicables
        </Link>
      </div>
    </div>
  );

  return (
    <div>
      {error && <Notice tone="warn" title="Actualisation impossible" className="mb-3">{error}</Notice>}
      {revoked && (
        <Notice tone="bad" title="Cet appareil a été révoqué" className="mb-3">
          Sa clé ne fait plus partie de votre wallet. Utilisez « J'ai perdu mon appareil » sur votre nouvel appareil.
        </Notice>
      )}
      {/* Balances stay underneath (sticky); the white sheet slides over them on scroll. */}
      <div className={cx('sticky z-0', isDesktop ? 'top-16' : 'top-14')}>{hero}</div>
      <div ref={sentinel} aria-hidden className="h-px" />
      <div className={cx('relative z-10 -mx-4 rounded-t-[16px] bg-white px-4 pb-4 shadow-[0_-6px_20px_rgba(0,0,0,0.06)] [&_.mw-card]:border [&_.mw-card]:border-sq-line [&_.mw-card]:shadow-none', isDesktop && '-mx-6 px-6 pt-6')}>
        {!isDesktop && <SheetHandle />}
        {isDesktop ? (
          <div className="grid grid-cols-12 gap-5">
            <div className="col-span-8">{recent}</div>
            <div className="col-span-4">{side}</div>
            <div className="col-span-12">
              <h2 className="mb-3 mt-2 text-[17px] font-semibold">Informations</h2>
              <InfoBoard limit={4} />
            </div>
          </div>
        ) : isTablet ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-4">{recent}</div>
            <div>{side}</div>
            <div className="col-span-2">
              <InfoBoard limit={4} />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {recent}
            {side}
            <InfoBoard limit={4} />
            <Button variant="ghost" onClick={() => nav('/wallet/info')}>
              Toutes les informations
            </Button>
          </div>
        )}
      </div>
    </div>
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
      aria-label="Développer ou réduire le volet"
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

function AssetTile({ sym, name, amount, chfv, decimals = 2 }: { sym: string; name: string; amount: number; chfv: number; decimals?: number }) {
  return (
    <Link to={`/asset/${sym}`} className="block rounded-[10px] border border-sq-line bg-white px-3.5 py-3 transition-colors hover:border-sq-muted/50">
      <div className="flex items-center gap-1 text-[13px] text-sq-ink-2">
        <span className="flex-1">{name}</span>
        <ChevronRight size={16} strokeWidth={1.75} className="text-sq-muted" />
      </div>
      <div className="num mt-1 text-[17px] font-semibold">
        <Money value={amount} decimals={decimals} unit={sym} unitClassName="ml-1 text-[12px] font-normal" />
      </div>
      <div className="num text-[12px] text-sq-muted">
        <Money value={chfv} unit="CHF" unitClassName="ml-1" />
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
      setMsg({ tone: 'ok', text: `Virement de ${amount} USDC envoyé. Il apparaît « en attente » puis « confirmé » dans vos transactions.` });
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
        <h2 className="text-[17px] font-semibold">Compte Swissquote ↔ wallet</h2>
        <MockBadge label="Banque simulée" />
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
        {verified ? 'Wallet vérifié comme le vôtre (Travel Rule, preuve EIP-1271).' : 'Wallet pas encore vérifié.'}
      </p>
      <Field label="Depuis mon compte vers mon wallet (USDC)">
        <div className="flex gap-2">
          <input className={cx(inputCls, 'num min-w-0 flex-1')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} aria-label="Montant en USDC" />
          <Button className="w-32 shrink-0" onClick={go} disabled={busy || !verified || !(Number(amount) > 0)}>
            {busy ? <Spinner /> : 'Transférer'}
          </Button>
        </div>
      </Field>
      <p className="text-[12px] text-sq-muted">Vers le compte : envoyez des USDC au contact « Compte Swissquote » depuis Envoyer.</p>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </Card>
  );
}
