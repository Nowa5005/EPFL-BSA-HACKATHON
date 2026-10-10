// External wallets (section 16): prove control of an EVM address with Sign-In with Ethereum (EIP-4361).
// The server (sq-bank, the verified-wallet registry) issues the challenge, verifies the signature (EOA or EIP-1271)
// and links the address to the authenticated client. No transaction, no network fee, no approval — and never a
// seed phrase or a private key. A verified wallet can then be chosen as "My own wallet" when sending.

import { useEffect, useRef, useState } from 'react';
import { BrowserProvider, type Eip1193Provider } from 'ethers';
import { Wallet as WalletIcon } from 'lucide-react';
import { CHAIN_ID, CHAIN_NAME } from '@sq/shared';
import { bank } from '../lib/api';
import { tr } from '../lib/i18n';
import { usePoll } from '../lib/hooks';
import { Addr, Button, Card, Field, inputCls, Notice, Spinner, dateTime } from './ui';

type Injected = Eip1193Provider & { on?: (ev: string, fn: (...a: any[]) => void) => void; removeListener?: (ev: string, fn: (...a: any[]) => void) => void };
const injected = (): Injected | undefined => (typeof window !== 'undefined' ? ((window as any).ethereum as Injected | undefined) : undefined);
const SEPOLIA_HEX = '0x' + CHAIN_ID.toString(16);

type Step =
  | { k: 'idle' }
  | { k: 'connected'; address: string; chainId: number }
  | { k: 'challenge'; address: string; chainId: number; nonce: string; message: string; expiresAt: string }
  | { k: 'busy'; label: string }
  | { k: 'done'; wallet: any };

export interface ExternalWallet {
  address: string;
  label: string;
  method: string;
  verifiedAt: string;
  chainId?: number;
}

export function ExternalWallets({ clientId }: { clientId: string }) {
  const list = usePoll<ExternalWallet[]>(() => bank.get(`/clients/${clientId}/external-wallets`), 30000, [clientId]);
  const [step, setStep] = useState<Step>({ k: 'idle' });
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const eth = injected();
  const stepRef = useRef(step);
  stepRef.current = step;

  // Account or network changed in the wallet: anything in progress is void — start again.
  useEffect(() => {
    if (!eth?.on) return;
    const reset = () => {
      if (stepRef.current.k === 'idle' || stepRef.current.k === 'done') return;
      setStep({ k: 'idle' });
      setMsg({ tone: 'warn', text: tr('Your wallet account or network changed: please start again.', 'Le compte ou le réseau de votre wallet a changé : recommencez.') });
    };
    eth.on('accountsChanged', reset);
    eth.on('chainChanged', reset);
    return () => {
      eth.removeListener?.('accountsChanged', reset);
      eth.removeListener?.('chainChanged', reset);
    };
  }, [eth]);

  const walletError = (e: any) => {
    const code = e?.code ?? e?.info?.error?.code ?? e?.error?.code;
    if (code === 4001 || code === 'ACTION_REJECTED') return tr('You declined in your wallet. Nothing was linked.', 'Vous avez refusé dans votre wallet. Rien n’a été lié.');
    return e?.shortMessage ?? e?.message ?? String(e);
  };

  const connect = async () => {
    setMsg(null);
    if (!eth) return;
    try {
      setStep({ k: 'busy', label: tr('Waiting for your wallet…', 'En attente de votre wallet…') });
      const p = new BrowserProvider(eth);
      const accounts: string[] = await p.send('eth_requestAccounts', []);
      const chainId = Number(await p.send('eth_chainId', []));
      if (!accounts?.[0]) throw new Error(tr('No account was shared by the wallet.', 'Le wallet n’a partagé aucun compte.'));
      setStep({ k: 'connected', address: accounts[0], chainId });
    } catch (e) {
      setStep({ k: 'idle' });
      setMsg({ tone: 'bad', text: walletError(e) });
    }
  };

  const switchNetwork = async () => {
    try {
      await eth!.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_HEX }] });
      // chainChanged resets the flow; reconnect to read the new network
      await connect();
    } catch (e) {
      setMsg({ tone: 'bad', text: walletError(e) });
    }
  };

  const requestChallenge = async () => {
    if (step.k !== 'connected') return;
    setMsg(null);
    try {
      const ch = await bank.post(`/clients/${clientId}/external-wallets/challenge`, { address: step.address, chainId: step.chainId, origin: window.location.origin });
      setStep({ k: 'challenge', address: ch.address, chainId: ch.chainId, nonce: ch.nonce, message: ch.message, expiresAt: ch.expiresAt });
    } catch (e: any) {
      setMsg({ tone: 'bad', text: e.message });
    }
  };

  const sign = async () => {
    if (step.k !== 'challenge') return;
    const s = step;
    setMsg(null);
    try {
      setStep({ k: 'busy', label: tr('Sign the message in your wallet…', 'Signez le message dans votre wallet…') });
      const p = new BrowserProvider(eth!);
      const accounts: string[] = await p.send('eth_accounts', []);
      if (!accounts.some((a) => a.toLowerCase() === s.address.toLowerCase())) throw new Error(tr('The wallet account changed: start again.', 'Le compte du wallet a changé : recommencez.'));
      const signer = await p.getSigner(s.address);
      const signature = await signer.signMessage(s.message); // personal_sign of the exact message shown
      setStep({ k: 'busy', label: tr('Verifying the signature…', 'Vérification de la signature…') });
      const w = await bank.post(`/clients/${clientId}/external-wallets/verify`, { nonce: s.nonce, message: s.message, signature, label: label.trim() || undefined });
      setStep({ k: 'done', wallet: w });
      setLabel('');
      void list.reload();
    } catch (e) {
      setStep({ k: 'idle' });
      setMsg({ tone: 'bad', text: walletError(e) });
    }
  };

  const revoke = async (address: string) => {
    if (!confirm(tr('Unlink this wallet? You will no longer be able to choose it as your own wallet when sending.', 'Délier ce wallet ? Vous ne pourrez plus le choisir comme votre propre wallet lors d’un envoi.'))) return;
    try {
      await bank.post(`/clients/${clientId}/external-wallets/${address}/revoke`, {});
      void list.reload();
    } catch (e: any) {
      setMsg({ tone: 'bad', text: e.message });
    }
  };

  const proofText = (w: ExternalWallet) =>
    tr(
      `Proof that you controlled this address on ${dateTime(w.verifiedAt)} (${w.method}) — not a proof of identity nor a compliance attestation.`,
      `Preuve que vous contrôliez cette adresse le ${dateTime(w.verifiedAt)} (${w.method}) — ni une preuve d’identité, ni une attestation de conformité.`,
    );

  return (
    <Card className="space-y-3" id="external-wallets">
      <div className="flex items-center gap-2">
        <WalletIcon size={20} strokeWidth={1.75} className="text-sq-ink-2" />
        <h2 className="text-[16px] font-semibold">{tr('Your external wallets', 'Vos wallets externes')}</h2>
      </div>
      <p className="text-[13px] text-sq-ink-2">
        {tr(
          'Link a wallet you control (e.g. MetaMask) by signing a message. It is free: no transaction, no network fee, no token approval. Swissquote will never ask for your seed phrase or private key. A linked wallet can then be chosen as “My own wallet” when you send.',
          'Liez un wallet que vous contrôlez (p. ex. MetaMask) en signant un message. C’est gratuit : aucune transaction, aucun frais de réseau, aucune autorisation de jetons. Swissquote ne vous demandera jamais votre phrase secrète ni votre clé privée. Un wallet lié peut ensuite être choisi comme « Mon propre wallet » lors d’un envoi.',
        )}
      </p>

      {list.data?.length ? (
        <ul className="divide-y divide-sq-line">
          {list.data.map((w) => (
            <li key={w.address} className="flex items-start gap-3 py-2.5 text-[14px]">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {w.label} <span className="font-mono text-[12px] text-sq-muted"><Addr a={w.address} /></span>
                </div>
                <div className="text-[12px] text-sq-muted">{proofText(w)}</div>
              </div>
              <Button variant="ghost" className="min-h-10 w-auto px-3 text-[13px]" onClick={() => revoke(w.address)}>
                {tr('Unlink', 'Délier')}
              </Button>
            </li>
          ))}
        </ul>
      ) : list.loading ? (
        <Spinner />
      ) : (
        <p className="text-[13px] text-sq-muted">{tr('No external wallet linked yet.', 'Aucun wallet externe lié pour l’instant.')}</p>
      )}

      {!eth ? (
        <Notice tone="warn" title={tr('No wallet extension detected', 'Aucune extension de wallet détectée')}>
          {tr(
            'Install a browser wallet such as MetaMask (or open this page in a browser that has one) to link an external wallet. Nothing else is needed.',
            'Installez un wallet de navigateur comme MetaMask (ou ouvrez cette page dans un navigateur qui en a un) pour lier un wallet externe. Rien d’autre n’est nécessaire.',
          )}
        </Notice>
      ) : step.k === 'idle' || step.k === 'done' ? (
        <>
          {step.k === 'done' && <Notice tone="ok" title={tr('Wallet linked', 'Wallet lié')}>{proofText(step.wallet)}</Notice>}
          <Button variant="secondary" onClick={connect}>
            {tr('Connect a wallet', 'Connecter un wallet')}
          </Button>
        </>
      ) : step.k === 'busy' ? (
        <div className="flex items-center gap-2 text-[14px] text-sq-ink-2">
          <Spinner className="text-sq-orange" /> {step.label}
        </div>
      ) : step.k === 'connected' ? (
        step.chainId !== CHAIN_ID ? (
          <Notice tone="warn" title={tr('Wrong network', 'Mauvais réseau')}>
            {tr(`Your wallet is on network ${step.chainId}. Switch it to ${CHAIN_NAME} to continue.`, `Votre wallet est sur le réseau ${step.chainId}. Passez sur ${CHAIN_NAME} pour continuer.`)}
            <Button variant="secondary" className="mt-2 w-auto px-4" onClick={switchNetwork}>
              {tr('Switch network', 'Changer de réseau')}
            </Button>
          </Notice>
        ) : (
          <div className="space-y-3">
            <p className="text-[14px]">
              {tr('Connected account:', 'Compte connecté :')} <span className="font-mono text-[13px]">{step.address}</span>
            </p>
            <Field label={tr('Name for this wallet (optional)', 'Nom de ce wallet (facultatif)')}>
              <input className={inputCls} value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="MetaMask" />
            </Field>
            <Button onClick={requestChallenge}>{tr('Prepare the verification message', 'Préparer le message de vérification')}</Button>
          </div>
        )
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-sq-ink-2">
            {tr(
              `Your wallet will ask you to sign exactly this message (valid until ${dateTime(step.expiresAt)}). Check the address and the website before signing.`,
              `Votre wallet vous demandera de signer exactement ce message (valable jusqu’au ${dateTime(step.expiresAt)}). Vérifiez l’adresse et le site avant de signer.`,
            )}
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-[10px] border border-sq-line bg-sq-bg p-3 font-mono text-[12px]">{step.message}</pre>
          <Button onClick={sign}>{tr('Sign in my wallet', 'Signer dans mon wallet')}</Button>
          <Button variant="ghost" onClick={() => setStep({ k: 'idle' })}>
            {tr('Cancel', 'Annuler')}
          </Button>
        </div>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </Card>
  );
}
