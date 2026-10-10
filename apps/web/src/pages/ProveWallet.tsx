// #9 — Page for the BENEFICIARY of a transfer to a personal (unhosted) wallet: sign the message issued by Swissquote
// with the wallet that will receive the funds (EIP-191 personal_sign), then give the signature back to the sender.
// No Swissquote session needed: the sender shares the link (message in the URL fragment, never sent to a server).
// Without a wallet extension, a demo test wallet can be created in this browser (Sepolia demonstrations only).

import { useEffect, useMemo, useState } from 'react';
import { BrowserProvider, Wallet, getAddress, type Eip1193Provider } from 'ethers';
import { PenLine, Wallet as WalletIcon } from 'lucide-react';
import { parseOwnershipProofMessage } from '@sq/shared';
import { Button, Card, CopyButton, DemoFooter, Field, inputCls, Logo, Notice, Spinner } from '../components/ui';
import { tr } from '../lib/i18n';

const DEMO_KEY = 'mw:demo-beneficiary-key';
const loadDemo = (): Wallet | null => {
  try {
    const k = localStorage.getItem(DEMO_KEY);
    return k ? new Wallet(k) : null;
  } catch {
    return null;
  }
};

const fromFragment = () => {
  try {
    const m = new URLSearchParams(window.location.hash.slice(1)).get('m');
    return m ? new TextDecoder().decode(Uint8Array.from(atob(m.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))) : '';
  } catch {
    return '';
  }
};

/** Link the sender shares with the beneficiary (message base64url-encoded in the fragment). */
export function proveWalletLink(message: string) {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(message))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${window.location.origin}/prove-wallet#m=${b64}`;
}

export default function ProveWallet() {
  const [message, setMessage] = useState(fromFragment);
  const [demo, setDemo] = useState<Wallet | null>(loadDemo);
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const parsed = useMemo(() => parseOwnershipProofMessage(message.trim()), [message]);
  const hasExtension = typeof window !== 'undefined' && !!(window as any).ethereum;
  useEffect(() => setSignature(''), [message]);

  const signWithExtension = async () => {
    setErr('');
    setBusy(true);
    try {
      const p = new BrowserProvider((window as any).ethereum as Eip1193Provider);
      const signer = await p.getSigner();
      if (getAddress(await signer.getAddress()) !== getAddress(parsed!.address))
        throw new Error(tr(`Select the account ${parsed!.address} in your wallet: only that address can prove ownership.`, `Sélectionnez le compte ${parsed!.address} dans votre wallet : seule cette adresse peut prouver la propriété.`));
      setSignature(await signer.signMessage(message.trim()));
    } catch (e: any) {
      setErr(e?.code === 4001 || e?.code === 'ACTION_REJECTED' ? tr('You declined in your wallet. Nothing was signed.', 'Vous avez refusé dans votre wallet. Rien n’a été signé.') : e.message);
    } finally {
      setBusy(false);
    }
  };

  const signWithDemo = async () => {
    setErr('');
    if (!demo || getAddress(demo.address) !== getAddress(parsed!.address)) return setErr(tr('This message is for another address than your demo wallet.', 'Ce message concerne une autre adresse que votre wallet de démo.'));
    setSignature(await demo.signMessage(message.trim()));
  };

  const createDemo = () => {
    const w = Wallet.createRandom();
    try {
      localStorage.setItem(DEMO_KEY, w.privateKey);
    } catch {
      /* storage unavailable: kept for this page only */
    }
    setDemo(new Wallet(w.privateKey));
  };

  return (
    <div className="mw-page min-h-screen bg-sq-bg">
      <div className="mx-auto max-w-[560px] space-y-4 px-4 pb-10 pt-8">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">{tr('Prove you own your wallet', 'Prouvez que vous détenez votre wallet')}</h1>
            <p className="text-[13px] text-sq-muted">{tr('For the beneficiary of a transfer from a Swissquote client', 'Pour le bénéficiaire d’un transfert d’un client Swissquote')}</p>
          </div>
        </div>
        <Notice>
          {tr(
            'Someone wants to send you crypto from My Wall. Swiss anti-money-laundering rules (the Travel Rule) require proof that the receiving personal wallet is yours. Signing is free: no transaction, no access to your funds. Never share a recovery phrase or private key.',
            'Quelqu’un souhaite vous envoyer des cryptos depuis My Wall. Les règles suisses contre le blanchiment (la Travel Rule) exigent la preuve que le wallet personnel qui reçoit est bien le vôtre. Signer est gratuit : aucune transaction, aucun accès à vos fonds. Ne communiquez jamais de phrase de récupération ni de clé privée.',
          )}
        </Notice>

        <Card className="space-y-3">
          <Field label={tr('Message to sign', 'Message à signer')} hint={tr('Sent to you by the sender. It must not be changed.', 'Transmis par l’expéditeur. Il ne doit pas être modifié.')}>
            <textarea className={`${inputCls} min-h-[180px] font-mono text-[12px]`} value={message} onChange={(e) => setMessage(e.target.value)} spellCheck={false} />
          </Field>
          {message.trim() && !parsed && <Notice tone="bad">{tr('This is not a valid My Wall ownership message (it may have been altered).', 'Ce n’est pas un message de propriété My Wall valable (il a peut-être été modifié).')}</Notice>}
          {parsed && (
            <p className="text-[13px] text-sq-ink-2">
              {tr('Beneficiary', 'Bénéficiaire')}: <b>{parsed.name}</b> · {tr('address', 'adresse')} <span className="break-all font-mono text-[12px]">{parsed.address}</span>
            </p>
          )}
          {parsed && !signature && (
            <div className="flex flex-wrap gap-2">
              {hasExtension && (
                <Button className="w-auto px-4" onClick={signWithExtension} disabled={busy}>
                  {busy ? <Spinner /> : <><PenLine size={16} strokeWidth={1.75} /> {tr('Sign with my wallet', 'Signer avec mon wallet')}</>}
                </Button>
              )}
              {demo && getAddress(demo.address) === getAddress(parsed.address) && (
                <Button variant="secondary" className="w-auto px-4" onClick={signWithDemo}>
                  {tr('Sign with my demo test wallet', 'Signer avec mon wallet de test')}
                </Button>
              )}
            </div>
          )}
          {parsed && !hasExtension && !(demo && getAddress(demo.address) === getAddress(parsed.address)) && !signature && (
            <p className="text-[13px] text-sq-muted">{tr('No wallet extension detected in this browser. Open this link in a browser with your wallet (e.g. MetaMask).', 'Aucune extension de wallet détectée dans ce navigateur. Ouvrez ce lien dans un navigateur avec votre wallet (p. ex. MetaMask).')}</p>
          )}
          {err && <Notice tone="bad">{err}</Notice>}
          {signature && (
            <Notice tone="ok" title={tr('Signed — send this signature back to the sender', 'Signé — renvoyez cette signature à l’expéditeur')}>
              <span className="block break-all font-mono text-[12px]">{signature}</span>
              <span className="mt-2 inline-block"><CopyButton value={signature} /></span>
            </Notice>
          )}
        </Card>

        <Card className="space-y-2">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <WalletIcon size={18} strokeWidth={1.75} /> {tr('No wallet at hand? Demo test wallet', 'Pas de wallet sous la main ? Wallet de test')}
          </h2>
          <p className="text-[13px] text-sq-muted">
            {tr(
              'For demonstrations on the Sepolia test network only: a key created and kept in this browser. Give its address to the sender, then open the link they send you in this same browser.',
              'Pour les démonstrations sur le réseau de test Sepolia uniquement : une clé créée et conservée dans ce navigateur. Donnez son adresse à l’expéditeur, puis ouvrez le lien qu’il vous envoie dans ce même navigateur.',
            )}
          </p>
          {demo ? (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="break-all font-mono text-[12px]">{demo.address}</span>
              <CopyButton value={demo.address} />
            </div>
          ) : (
            <Button variant="secondary" className="w-auto px-4" onClick={createDemo}>
              {tr('Create a demo test wallet', 'Créer un wallet de test')}
            </Button>
          )}
        </Card>
        <DemoFooter />
      </div>
    </div>
  );
}
