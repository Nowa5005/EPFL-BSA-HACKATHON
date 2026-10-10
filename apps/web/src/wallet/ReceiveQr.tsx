// Receive screen QR (#20): encodes the EIP-681 URI `ethereum:<checksummed Safe address>@11155111` — the public
// address plus the Sepolia chain id, nothing else (no amount, no key, no code, no secret). EIP-681-aware wallets
// (MetaMask, Rainbow, Trust…) then pre-select the right network. Compatibility: a scanner that only accepts a bare
// address may refuse the URI — the plain address is shown in full and copyable right below, and the network is
// displayed prominently, so the client always has a network-explicit fallback.

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download } from 'lucide-react';
import { tr } from '../lib/i18n';
import { groupAddress, QR_OPTIONS, qrAddress, qrPayload } from '../lib/receiveQr';
import { CopyButton, Notice } from '../components/ui';

export function ReceiveQr({ address }: { address: string }) {
  const payload = qrPayload(address);
  const plain = qrAddress(address);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    setUrl(null);
    QRCode.toDataURL(payload, QR_OPTIONS)
      .then((u) => alive && setUrl(u))
      .catch((e) => alive && setErr(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [payload]); // re-rendered whenever the wallet (address) changes

  return (
    <div className="space-y-3" data-testid="receive-qr">
      <div className="flex justify-center">
        {url ? (
          <img src={url} alt={tr(`QR code of the address ${plain} on Ethereum Sepolia`, `QR code de l’adresse ${plain} sur Ethereum Sepolia`)} width={208} height={208} className="rounded-[8px] border border-sq-line" data-payload={payload} />
        ) : err ? (
          <Notice tone="bad">{tr('QR code unavailable', 'QR code indisponible')}: {err}</Notice>
        ) : (
          <div className="size-[208px] animate-pulse rounded-[8px] bg-sq-chip/70" />
        )}
      </div>
      <div className="rounded-[10px] border border-sq-orange/40 bg-sq-bg p-3 text-center" data-testid="receive-network">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-sq-muted">{tr('Network', 'Réseau')}</div>
        <div className="text-[20px] font-semibold text-sq-ink">Ethereum Sepolia</div>
        <div className="text-[13px] text-sq-ink-2">{tr('Test network · chain ID 11155111 — send only ETH or USDC on Sepolia. Funds sent from another network (Bitcoin, Solana, Tron, BNB Chain…) do not arrive here.', 'Réseau de test · chain ID 11155111 — envoyez uniquement de l’ETH ou des USDC sur Sepolia. Des fonds envoyés depuis un autre réseau (Bitcoin, Solana, Tron, BNB Chain…) n’arrivent pas ici.')}</div>
      </div>
      <code className="block break-words rounded-[10px] bg-sq-bg p-3 text-center font-mono text-[15px] leading-relaxed tracking-wide" aria-label={plain} data-testid="receive-address">
        {groupAddress(plain)}
      </code>
      <div className="flex flex-wrap gap-2">
        <div className="min-w-0 flex-1">
          <CopyButton value={plain} label={tr('Copy address', 'Copier l’adresse')} />
        </div>
        {url && (
          <a href={url} download={`my-wall-sepolia-${plain}.png`} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[10px] border border-sq-line bg-white px-4 text-[14px] font-semibold text-sq-ink hover:bg-sq-bg">
            <Download size={18} strokeWidth={1.75} /> {tr('Download QR (PNG)', 'Télécharger le QR (PNG)')}
          </a>
        )}
      </div>
      <p className="text-[12px] text-sq-muted">{tr('The QR code contains only this public address and the Sepolia network (EIP-681: ethereum:…@11155111) — no amount, no secret. If your scanner wants a bare address, copy it above.', 'Le QR code contient uniquement cette adresse publique et le réseau Sepolia (EIP-681 : ethereum:…@11155111) — ni montant, ni secret. Si votre lecteur exige une adresse seule, copiez-la ci-dessus.')}</p>
    </div>
  );
}
