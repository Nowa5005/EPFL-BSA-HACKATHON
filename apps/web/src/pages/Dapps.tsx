import { useState } from 'react';
import { MaxUint256, parseUnits } from 'ethers';
import { USDC_ADDRESS, buildSafeTx, erc20Iface, type SafeTx } from '@sq/shared';
import { cosigner } from '../lib/api';
import { useLocal } from '../lib/hooks';
import { Addr, Button, Card, PageHeader, Why } from '../components/ui';
import { TxFlow } from '../components/TxFlow';

const DAPPS = [
  { name: 'Uniswap', desc: 'Swap tokens (SwapRouter02, Sepolia)', address: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E', approved: true, icon: '🦄' },
  { name: 'Aave', desc: 'Lend & borrow (V3 Pool, Sepolia)', address: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951', approved: true, icon: '👻' },
  { name: 'FreeMint Airdrop', desc: 'Unknown site that asks for an approval', address: '0x5ee5bf7ae06d1be5997a1a72006fe6c607ec6de8', approved: false, icon: '🎁' },
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
      <div>
        <PageHeader title="dApp request" />
        <TxFlow clientId={device!.clientId} safeAddress={device!.safeAddress!} safeTx={tx} onBack={() => setTx(null)} />
      </div>
    );

  return (
    <div className="space-y-4">
      <PageHeader title="dApps" back="/wallet" />
      <Why>Swissquote only co-signs interactions with approved dApps, screens every counterparty against sanctions lists, and explains each request in plain words before you sign. dApp interactions always use reinforced checks.</Why>
      {DAPPS.map((d) => (
        <Card key={d.name} className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{d.icon}</span>
            <div className="flex-1">
              <div className="font-semibold">{d.name}</div>
              <div className="text-xs text-navy-700/70">
                {d.desc} · <Addr a={d.address} />
              </div>
            </div>
            <span className={d.approved ? 'rounded-full bg-ok-50 px-2 py-0.5 text-xs font-semibold text-ok-600' : 'rounded-full bg-bad-50 px-2 py-0.5 text-xs font-semibold text-bad-600'}>
              {d.approved ? 'Approved' : 'Not approved'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => approve(d.address, parseUnits('25', 6))}>
              Allow 25 USDC
            </Button>
            <Button variant="secondary" onClick={() => approve(d.address, MaxUint256)}>
              Allow unlimited
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
