// #21 (part A) — Emergency mode: works with EVERY Swissquote service down. Reads balances and the wallet's keys
// directly from Ethereum Sepolia through public RPC nodes (browser-side, packages/shared makeProvider), shows the
// history cached on this device (on-chain facts only), and explains the protected exit — completed by the wallet
// security upgrade (Phase B: on-chain delay module). No call to any Swissquote service is made from this page.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, CloudOff, LifeBuoy, RefreshCw } from 'lucide-react';
import { formatEther, formatUnits, getAddress, isAddress } from 'ethers';
import { CHAIN_NAME, USDC_DECIMALS, explorerAddress, explorerTx, makeProvider, safeContract, usdcContract } from '@sq/shared';
import { getDevice } from '../lib/device';
import { readCachedTxs, useServiceHealth } from '../lib/serviceHealth';
import { tr } from '../lib/i18n';
import { Button, Card, dateTime, fmt, Notice, Spinner } from '../components/ui';

interface ChainView {
  block: number;
  eth: string;
  usdc: string;
  owners: string[];
  threshold: number;
  readAt: string;
}

export default function Emergency() {
  const device = getDevice();
  const fromUrl = new URLSearchParams(window.location.search).get('safe') ?? '';
  const [manual, setManual] = useState(fromUrl);
  const safe = device?.safeAddress ?? (isAddress(manual) ? getAddress(manual) : '');
  const health = useServiceHealth();
  const [view, setView] = useState<ChainView | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const read = useCallback(async () => {
    if (!safe) return;
    setLoading(true);
    setErr('');
    try {
      const p = makeProvider();
      const s = safeContract(safe, p);
      const [block, eth, usdc, owners, threshold] = await Promise.all([
        p.getBlockNumber(),
        p.getBalance(safe),
        usdcContract(p).balanceOf(safe) as Promise<bigint>,
        s.getOwners() as Promise<string[]>,
        s.getThreshold() as Promise<bigint>,
      ]);
      setView({ block, eth: formatEther(eth), usdc: formatUnits(usdc, USDC_DECIMALS), owners: owners.map((o) => getAddress(o)), threshold: Number(threshold), readAt: new Date().toISOString() });
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [safe]);

  useEffect(() => {
    void read();
  }, [read]);

  const cached = safe ? readCachedTxs(safe) : null;
  const deviceKey = device?.deviceAddress?.toLowerCase();

  return (
    <div className="mw-page mx-auto max-w-[760px] space-y-4 px-4 pb-10 pt-6" data-testid="emergency-page">
      <div className="flex items-center gap-2">
        <Link to="/wallet" className="-ml-2 flex size-11 items-center justify-center rounded-full text-sq-ink hover:bg-sq-chip/60" aria-label={tr('Back', 'Retour')}>
          <ChevronLeft size={22} strokeWidth={1.75} />
        </Link>
        <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
          <LifeBuoy size={22} strokeWidth={1.75} className="text-sq-orange" aria-hidden /> {tr('Emergency mode', 'Mode urgence')}
        </h1>
      </div>

      <Notice tone={health.down ? 'warn' : 'info'} title={health.down ? tr('Swissquote services are unreachable. Your funds are safe.', 'Les services Swissquote sont injoignables. Vos fonds sont en sécurité.') : tr('Swissquote services are answering again', 'Les services Swissquote répondent à nouveau')}>
        {tr(
          'Your funds are on the Ethereum blockchain, in a wallet that only your keys control — not on a Swissquote server. This page reads them directly from the blockchain, without any Swissquote service.',
          'Vos fonds sont sur la blockchain Ethereum, dans un wallet que seules vos clés contrôlent — pas sur un serveur Swissquote. Cette page les lit directement sur la blockchain, sans aucun service Swissquote.',
        )}{' '}
        <button type="button" onClick={() => void health.recheck()} className="inline-flex min-h-10 items-center gap-1 font-medium underline underline-offset-4">
          <RefreshCw size={14} strokeWidth={2} aria-hidden /> {tr('Check again', 'Vérifier à nouveau')}
        </button>
      </Notice>

      {!safe && (
        <Card className="space-y-2">
          <p className="text-[14px]">{tr('No wallet is registered on this device. Enter your wallet’s public address (printed on your recovery sheet) to read it from the blockchain:', 'Aucun wallet n’est enregistré sur cet appareil. Saisissez l’adresse publique de votre wallet (imprimée sur votre fiche de récupération) pour la lire sur la blockchain :')}</p>
          <input className="min-h-11 w-full rounded-[10px] border border-sq-line bg-sq-surface px-3 font-mono text-[14px]" value={manual} onChange={(e) => setManual(e.target.value.trim())} placeholder="0x…" spellCheck={false} aria-label={tr('Wallet address', 'Adresse du wallet')} />
        </Card>
      )}

      {safe && (
        <Card as="section" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[16px] font-semibold">{tr('Balances read from the blockchain', 'Soldes lus sur la blockchain')}</h2>
            <Button variant="secondary" className="min-h-10 w-auto px-3 text-[13px]" onClick={() => void read()} disabled={loading}>
              {loading ? <Spinner /> : <RefreshCw size={16} strokeWidth={1.75} />} {tr('Refresh', 'Actualiser')}
            </Button>
          </div>
          <p className="break-all font-mono text-[12px] text-sq-muted">
            {CHAIN_NAME} ·{' '}
            <a href={explorerAddress(safe)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {safe}
            </a>
          </p>
          {err && <Notice tone="bad" title={tr('The public blockchain nodes did not answer', 'Les nœuds publics de la blockchain n’ont pas répondu')}>{err} — {tr('try again in a moment.', 'réessayez dans un instant.')}</Notice>}
          {view ? (
            <>
              <dl className="grid grid-cols-2 gap-3" data-testid="emergency-balances">
                <div className="rounded-[10px] bg-sq-bg p-3">
                  <dt className="text-[12px] text-sq-muted">USDC</dt>
                  <dd className="num text-[20px] font-semibold">{fmt(Number(view.usdc), 2)}</dd>
                </div>
                <div className="rounded-[10px] bg-sq-bg p-3">
                  <dt className="text-[12px] text-sq-muted">ETH</dt>
                  <dd className="num text-[20px] font-semibold">{fmt(Number(view.eth), 5)}</dd>
                </div>
              </dl>
              <p className="text-[12px] text-sq-muted">
                {tr(`Read at block ${view.block.toLocaleString('en-US')} through public nodes, ${dateTime(view.readAt)}. Test network: no real value.`, `Lu au bloc ${view.block.toLocaleString('fr-CH')} via des nœuds publics, ${dateTime(view.readAt)}. Réseau de test : aucune valeur réelle.`)}
              </p>
              <div className="text-[13px]">
                <div className="font-medium">{tr(`Wallet keys: ${view.owners.length}, of which ${view.threshold} are needed to move funds`, `Clés du wallet : ${view.owners.length}, dont ${view.threshold} nécessaires pour déplacer des fonds`)}</div>
                <ul className="mt-1 space-y-0.5 font-mono text-[12px] text-sq-ink-2">
                  {view.owners.map((o) => (
                    <li key={o} className="break-all">
                      {o} {o.toLowerCase() === deviceKey && <span className="font-sans font-medium text-sq-up">· {tr('this device', 'cet appareil')}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            !err && (
              <p className="flex items-center gap-2 text-[14px] text-sq-muted">
                <Spinner /> {tr('Reading the blockchain…', 'Lecture de la blockchain…')}
              </p>
            )
          )}
        </Card>
      )}

      {safe && (
        <Card as="section" className="space-y-2">
          <h2 className="text-[16px] font-semibold">{tr('Recent history (saved on this device)', 'Historique récent (enregistré sur cet appareil)')}</h2>
          {cached?.rows.length ? (
            <>
              <ul className="divide-y divide-sq-line" data-testid="emergency-history">
                {cached.rows.map((t) => (
                  <li key={`${t.txHash}${t.kind}${t.amount}`} className="flex items-center gap-3 py-2 text-[13px]">
                    {t.kind === 'receive' ? <ArrowDownLeft size={18} strokeWidth={1.75} aria-hidden /> : <ArrowUpRight size={18} strokeWidth={1.75} aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {t.kind === 'receive' ? tr('Received', 'Reçu') : tr('Sent', 'Envoyé')} {t.amount} {t.asset}
                      </span>
                      <span className="block text-[12px] text-sq-muted">{dateTime(t.at)}</span>
                    </span>
                    {t.txHash && (
                      <a href={explorerTx(t.txHash)} target="_blank" rel="noreferrer" className="text-[12px] underline underline-offset-2">
                        Etherscan
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-sq-muted">{tr(`Copy saved ${dateTime(cached.savedAt)}. Only blockchain facts are kept on the device (no names, no notes). Newer operations are on Etherscan.`, `Copie enregistrée le ${dateTime(cached.savedAt)}. Seuls les faits de la blockchain sont conservés sur l’appareil (ni noms, ni notes). Les opérations plus récentes sont sur Etherscan.`)}</p>
            </>
          ) : (
            <p className="text-[13px] text-sq-muted">
              {tr('No history saved on this device yet. The complete history is public on ', 'Aucun historique enregistré sur cet appareil. L’historique complet est public sur ')}
              <a href={explorerAddress(safe)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                Etherscan
              </a>
              .
            </p>
          )}
        </Card>
      )}

      <Card as="section" className="space-y-2" id="protected-exit">
        <h2 className="text-[16px] font-semibold">{tr('Protected exit — available after the wallet security upgrade', 'Sortie protégée — disponible après la mise à niveau de sécurité du wallet')}</h2>
        <p className="text-[14px] text-sq-ink-2">
          {tr(
            'The guided exit will let you move your funds from this page with your device key and your recovery key, without Swissquote, after an on-chain safety delay (48 h; 2 min in the demo). It arrives with the wallet security upgrade and is not available in this version — this page never pretends to send anything.',
            'La sortie guidée vous permettra de déplacer vos fonds depuis cette page avec la clé de votre appareil et votre clé de secours, sans Swissquote, après un délai de sécurité inscrit sur la blockchain (48 h ; 2 min en démo). Elle arrive avec la mise à niveau de sécurité du wallet et n’est pas disponible dans cette version — cette page ne prétend jamais envoyer quoi que ce soit.',
          )}
        </p>
        <p className="text-[13px] text-sq-muted">
          {tr(
            'Already true today: 2 of your wallet’s 3 keys are enough, and two of them are yours (this device and your recovery key). Swissquote holds only one and can never move your funds alone.',
            'Déjà vrai aujourd’hui : 2 des 3 clés de votre wallet suffisent, et deux sont à vous (cet appareil et votre clé de secours). Swissquote n’en détient qu’une et ne peut jamais déplacer vos fonds seule.',
          )}
        </p>
      </Card>

      <p className="flex items-center gap-2 text-[12px] text-sq-muted">
        <CloudOff size={14} strokeWidth={1.75} aria-hidden /> {tr('Nothing on this page depends on Swissquote’s servers.', 'Rien sur cette page ne dépend des serveurs de Swissquote.')}{' '}
        <Link to="/about" className="underline underline-offset-2">
          {tr('About this prototype', 'À propos de ce prototype')}
        </Link>
      </p>
    </div>
  );
}
