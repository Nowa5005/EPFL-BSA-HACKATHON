// Receive screen QR: encodes ONLY the wallet's public Safe address, as a plain EIP-55 checksummed address.
// We deliberately do not use an EIP-681 URI ("ethereum:<addr>@11155111"): many wallets ignore or mishandle the
// chain id, and some refuse to scan URIs at all, while a plain address is universally understood. The network is
// therefore stated explicitly next to the code instead of being encoded. Never encodes keys, codes or secrets.

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download } from 'lucide-react';
import { tr } from '../lib/i18n';
import { groupAddress, QR_OPTIONS, qrPayload } from '../lib/receiveQr';
import { CopyButton, Notice } from '../components/ui';

export function ReceiveQr({ address }: { address: string }) {
  const payload = qrPayload(address);
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
          <img src={url} alt={tr(`QR code of the address ${payload}`, `QR code de l’adresse ${payload}`)} width={208} height={208} className="rounded-[8px] border border-sq-line" data-payload={payload} />
        ) : err ? (
          <Notice tone="bad">{tr('QR code unavailable', 'QR code indisponible')}: {err}</Notice>
        ) : (
          <div className="size-[208px] animate-pulse rounded-[8px] bg-sq-chip/70" />
        )}
      </div>
      <p className="text-center text-[13px] font-semibold text-sq-ink">
        {tr('Ethereum Sepolia (testnet) — send only ETH or USDC on Sepolia', 'Ethereum Sepolia (réseau de test) — envoyez uniquement de l’ETH ou des USDC sur Sepolia')}
      </p>
      <code className="block break-words rounded-[10px] bg-sq-bg p-3 text-center font-mono text-[15px] leading-relaxed tracking-wide" aria-label={payload} data-testid="receive-address">
        {groupAddress(payload)}
      </code>
      <div className="flex flex-wrap gap-2">
        <div className="min-w-0 flex-1">
          <CopyButton value={payload} label={tr('Copy address', 'Copier l’adresse')} />
        </div>
        {url && (
          <a href={url} download={`my-wall-sepolia-${payload}.png`} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[10px] border border-sq-line bg-white px-4 text-[14px] font-semibold text-sq-ink hover:bg-sq-bg">
            <Download size={18} strokeWidth={1.75} /> {tr('Download QR (PNG)', 'Télécharger le QR (PNG)')}
          </a>
        )}
      </div>
      <p className="text-[12px] text-sq-muted">{tr('The QR code contains only this public address (no amount, no network, no secret).', 'Le QR code contient uniquement cette adresse publique (ni montant, ni réseau, ni secret).')}</p>
    </div>
  );
}
