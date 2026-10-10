import { useState } from 'react';
import { ArrowLeftRight, Gift, Landmark } from 'lucide-react';
import { MaxUint256, parseUnits } from 'ethers';
import { USDC_ADDRESS, buildSafeTx, erc20Iface, type SafeTx } from '@sq/shared';
import { cosigner } from '../lib/api';
import { useLocal } from '../lib/hooks';
import { Addr, Button, Card, PageHeader, Why } from '../components/ui';
import { TxFlow } from '../components/TxFlow';
import { tr } from '../lib/i18n';

const DAPPS = [
  { name: 'Uniswap', desc: tr('Swap tokens (SwapRouter02, Sepolia)', 'Échanger des jetons (SwapRouter02, Sepolia)'), address: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E', approved: true, icon: ArrowLeftRight },
  { name: 'Aave', desc: tr('Lend and borrow (V3 Pool, Sepolia)', 'Prêter et emprunter (V3 Pool, Sepolia)'), address: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951', approved: true, icon: Landmark },
  { name: 'FreeMint Airdrop', desc: tr('Unknown site asking for an approval', 'Site inconnu qui demande une autorisation'), address: '0x5ee5bf7ae06d1be5997a1a72006fe6c607ec6de8', approved: false, icon: Gift },
];

export default function Dapps() {
  const { device } = useLocal();
  const [tx, setTx] = useState<SafeTx | null>(null);

  const approve = async (spender: string, amount: bigint) => {
    const nonce = (await cosigner.get(`/clients/${device!.clientId}/onchain`)).nonce;
    setTx(buildSafeTx({ to: USDC_ADDRESS, data: erc20Iface.encodeFunctionData('approve', [spender, amount]), nonce }));
  };

  if (tx)
    return (
      <div className="mx-auto max-w-[640px]">
        <PageHeader title={tr('dApp request', 'Demande d’une dApp')} />
        <TxFlow clientId={device!.clientId} safeAddress={device!.safeAddress!} safeTx={tx} onBack={() => setTx(null)} />
      </div>
    );

  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <PageHeader title="dApps" back="/wallet/more" />
      <Why>
        {tr(
          'Swissquote only co-signs with approved dApps, screens every counterparty (sanctions) and explains each request in plain words before signing. dApps always require enhanced checks.',
          'Swissquote ne co-signe qu’avec des dApps approuvées, filtre chaque contrepartie (sanctions) et explique chaque demande en mots simples avant signature. Les dApps demandent toujours des contrôles renforcés.',
        )}
      </Why>
      {DAPPS.map((d) => (
        <Card key={d.name} className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-full bg-sq-bg">
              <d.icon size={22} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{d.name}</div>
              <div className="text-[12px] text-sq-muted">
                {d.desc} · <Addr a={d.address} />
              </div>
            </div>
            <span className={d.approved ? 'rounded-[4px] bg-sq-ok-50 px-1.5 py-0.5 text-[12px] font-semibold text-sq-up' : 'rounded-[4px] bg-sq-bad-50 px-1.5 py-0.5 text-[12px] font-semibold text-sq-down'}>
              {d.approved ? tr('Approved', 'Approuvée') : tr('Not approved', 'Non approuvée')}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => approve(d.address, parseUnits('25', 6))}>
              {tr('Approve 25 USDC', 'Autoriser 25 USDC')}
            </Button>
            <Button variant="secondary" onClick={() => approve(d.address, MaxUint256)}>
              {tr('Approve unlimited', 'Autoriser sans limite')}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
