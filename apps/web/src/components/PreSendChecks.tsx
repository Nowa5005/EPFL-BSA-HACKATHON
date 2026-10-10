// #20 — Pre-send confirmations shown in the review step, from the co-signer's own on-chain reads (prep.recipientInfo):
//   • the recipient is a smart contract (not a Safe, not an approved app) → strong warning + explicit confirmation;
//   • first send to this address → "This recipient accepts Ethereum (Sepolia) USDC / ETH".
// The confirm button stays disabled until every required box is ticked (useAcks().ready).

import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { tr } from '../lib/i18n';

export interface RecipientInfo {
  address: string;
  kind?: 'account' | 'safe' | 'dapp' | 'contract' | 'unknown';
  firstSend: boolean;
  asset: 'USDC' | 'ETH';
}

export function useAcks(info: RecipientInfo | null | undefined) {
  const [contract, setContract] = useState(false);
  const [network, setNetwork] = useState(false);
  const needContract = info?.kind === 'contract';
  const needNetwork = !!info?.firstSend;
  return { contract, setContract, network, setNetwork, needContract, needNetwork, ready: (!needContract || contract) && (!needNetwork || network) };
}

export function PreSendChecks({ info, acks, disabled }: { info: RecipientInfo | null | undefined; acks: ReturnType<typeof useAcks>; disabled?: boolean }) {
  if (!info || (!acks.needContract && !acks.needNetwork && info.kind !== 'safe')) return null;
  return (
    <div className="space-y-2" data-testid="presend-checks">
      {info.kind === 'safe' && (
        <p className="text-[12px] text-sq-muted">{tr('The recipient is a Safe smart account (a multi-signature wallet): it can receive this asset.', 'Le destinataire est un compte Safe (wallet multi-signature) : il peut recevoir cet actif.')}</p>
      )}
      {acks.needContract && (
        <div role="alert" className="mw-important rounded-[10px] border border-sq-down/30 bg-sq-bad-50 p-3 text-[13px]">
          <div className="flex items-center gap-2 font-semibold text-sq-down">
            <TriangleAlert size={16} strokeWidth={2} aria-hidden /> {tr('The recipient is a smart contract, not a wallet', 'Le destinataire est un contrat intelligent, pas un wallet')}
          </div>
          <p className="mt-1 text-sq-ink-2">
            {tr(
              'This address holds program code. It is not a Safe and not an app approved by Swissquote. Many contracts cannot send back what they receive: the funds could be lost for good.',
              'Cette adresse contient du code. Ce n’est ni un Safe ni une app approuvée par Swissquote. Beaucoup de contrats ne savent pas renvoyer ce qu’ils reçoivent : les fonds pourraient être perdus définitivement.',
            )}
          </p>
          <label className="mt-2 flex min-h-11 cursor-pointer items-start gap-2.5">
            <input type="checkbox" className="mt-1 size-4 accent-[#fa5b35]" checked={acks.contract} disabled={disabled} onChange={(e) => acks.setContract(e.target.checked)} />
            <span className="font-medium text-sq-ink">{tr('The recipient asked me to use this exact contract address, and I accept the risk.', 'Le destinataire m’a demandé d’utiliser exactement cette adresse de contrat, et j’accepte le risque.')}</span>
          </label>
        </div>
      )}
      {acks.needNetwork && (
        <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-[10px] border border-sq-warn/30 bg-sq-warn-50 p-3 text-[13px]">
          <input type="checkbox" className="mt-1 size-4 accent-[#fa5b35]" checked={acks.network} disabled={disabled} onChange={(e) => acks.setNetwork(e.target.checked)} data-testid="ack-network" />
          <span>
            <span className="block font-medium text-sq-ink">
              {tr(`This recipient accepts Ethereum (Sepolia) ${info.asset}`, `Ce destinataire accepte les ${info.asset} sur Ethereum (Sepolia)`)}
            </span>
            <span className="block text-sq-ink-2">
              {tr(
                'First payment to this address. If it belongs to an exchange or a wallet on another network, the funds may not arrive. Check with the recipient that this address receives this asset on Ethereum Sepolia.',
                'Premier paiement vers cette adresse. Si elle appartient à une plateforme ou à un wallet d’un autre réseau, les fonds risquent de ne pas arriver. Vérifiez avec le destinataire que cette adresse reçoit cet actif sur Ethereum Sepolia.',
              )}
            </span>
          </span>
        </label>
      )}
    </div>
  );
}
