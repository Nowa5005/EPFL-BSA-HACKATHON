import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { explorerAddress } from '@sq/shared';
import { cosigner } from '../lib/api';
import { getDevice, guessDeviceType, lock, registerPasskey, saveDevice, saveSession } from '../lib/device';
import { useLocal, useWalletData } from '../lib/hooks';
import { Addr, Button, Card, cx, MockBadge, Notice, PageHeader, RealBadge, Why } from '../components/ui';

export default function Settings() {
  const nav = useNavigate();
  const { device, unlocked } = useLocal();
  const { data, reload } = useWalletData();
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const c = data?.client;
  const owners: string[] = data?.onchain?.owners ?? [];

  const role = (o: string) => {
    const l = o.toLowerCase();
    if (l === c?.owners?.device?.toLowerCase()) return { name: 'Device key', who: l === device!.deviceAddress.toLowerCase() ? 'this device (you)' : 'your other device', icon: '📱' };
    if (l === c?.owners?.cosigner?.toLowerCase()) return { name: 'Swissquote co-signer', who: 'Swissquote (HSM in production)', icon: '🏦' };
    if (l === c?.owners?.recovery?.toLowerCase()) return { name: 'Recovery key', who: 'split: paper · cloud · partner', icon: '🧩' };
    return { name: 'Unknown owner', who: '', icon: '❓' };
  };

  const addDevice = async () => {
    setMsg(null);
    try {
      const other = guessDeviceType() === 'mobile' ? 'desktop' : 'mobile';
      await registerPasskey(device!.clientId, other);
      setMsg({ tone: 'ok', text: `Second device (${other}) linked.` });
      void reload();
    } catch (e: any) {
      setMsg({ tone: 'bad', text: e.message });
    }
  };

  const setPrivacy = async (privacy: string) => {
    await cosigner.post(`/clients/${device!.clientId}/privacy`, { privacy });
    void reload();
  };

  const exportKey = () => {
    const d = getDevice()!;
    const blob = new Blob([JSON.stringify({ kind: 'sqwallet-device-key', safeAddress: d.safeAddress, address: d.deviceAddress, keystore: JSON.parse(d.keystore) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sq-wallet-device-key-${d.deviceAddress.slice(2, 8)}.json`;
    a.click();
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Who can move your funds</div>
          <RealBadge label={`${data?.onchain?.threshold ?? 2} of ${owners.length || 3} on-chain`} />
        </div>
        {owners.map((o) => {
          const r = role(o);
          return (
            <div key={o} className="flex items-center gap-3 text-sm">
              <span className="text-xl">{r.icon}</span>
              <div className="flex-1">
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-navy-700/70">{r.who}</div>
              </div>
              <a href={explorerAddress(o)} target="_blank" rel="noreferrer" className="text-navy-700/70 hover:underline">
                <Addr a={o} />
              </a>
            </div>
          );
        })}
        <p className="text-xs text-navy-700/70">Any 2 keys are required. Swissquote holds only one — it can refuse to co-sign, but never move your funds alone.</p>
      </Card>

      <Card className="space-y-3">
        <div className="font-semibold">Linked devices (passkeys)</div>
        {(c?.devices ?? []).map((d: any) => (
          <div key={d.credentialId} className="flex items-center gap-3 text-sm">
            <span className="text-xl">{d.deviceType === 'mobile' ? '📱' : '💻'}</span>
            <div className="flex-1">
              <div className="font-medium">{d.label}</div>
              <div className="text-xs text-navy-700/70">since {new Date(d.createdAt).toLocaleDateString('de-CH')}</div>
            </div>
            <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', d.status === 'active' ? 'bg-ok-50 text-ok-600' : d.status === 'revoked' ? 'bg-bad-50 text-bad-600' : 'bg-warn-50 text-warn-600')}>{d.status}</span>
          </div>
        ))}
        <Why>Maximum 1 phone + 1 computer. Changing device requires the existing device, your password, an email code and an SMS confirmation — or the full recovery procedure.</Why>
        <Button variant="secondary" onClick={addDevice}>
          Link another device
        </Button>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </Card>

      <Card className="space-y-3">
        <div className="font-semibold">What Swissquote sees in your consolidated view</div>
        {[
          ['full', 'Full consolidated view', 'Balances and transactions appear in your Swissquote portfolio.'],
          ['balance-only', 'Balance only', 'Only the total value is shown in your portfolio.'],
          ['none', 'Nothing', 'Swissquote does not consolidate or use your wallet data (compliance checks still apply).'],
        ].map(([v, t, d]) => (
          <label key={v} className={cx('flex cursor-pointer gap-3 rounded-xl border p-3', c?.privacy === v ? 'border-navy-900 bg-navy-50' : 'border-navy-100')}>
            <input type="radio" name="privacy" checked={c?.privacy === v} onChange={() => setPrivacy(v)} className="mt-1" />
            <span>
              <span className="block text-sm font-medium">{t}</span>
              <span className="block text-xs text-navy-700/70">{d}</span>
            </span>
          </label>
        ))}
        <p className="text-xs text-navy-700/60">Note: public blockchains are public — this setting controls Swissquote's consolidated display and data use, not on-chain visibility.</p>
      </Card>

      <Card className="space-y-3">
        <div className="font-semibold">If Swissquote disappears</div>
        <p className="text-sm text-navy-800">Your device key + your recovery key (paper kit + cloud backup) are 2 of 3 keys: you can move your funds without Swissquote, using our open-source escape-hatch script or the public Safe app (app.safe.global).</p>
        <Button variant="secondary" onClick={exportKey}>
          Export encrypted device key
        </Button>
      </Card>

      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Demo controls</div>
          <MockBadge label="Demo" />
        </div>
        <Button variant="secondary" onClick={() => lock()} disabled={!unlocked}>
          {unlocked ? 'Lock wallet (forget password for this session)' : 'Wallet locked'}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            if (!confirm('Simulate losing this device? The encrypted device key will be erased from this browser.')) return;
            saveDevice(null);
            lock();
            nav('/recover');
          }}
        >
          Simulate: I lost this device
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            saveSession(null);
            lock();
            nav('/login');
          }}
        >
          Sign out of Swissquote
        </Button>
      </Card>
    </div>
  );
}
