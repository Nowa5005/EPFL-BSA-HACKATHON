import { useState } from 'react';
import { Wallet, parseUnits } from 'ethers';
import { USDC_ADDRESS, buildSafeTx, signSafeTx, usdcTransferData } from '@sq/shared';
import { cosigner, partner } from '../lib/api';
import { useLocal } from '../lib/hooks';
import { Button, Card, MockBadge, Notice, Shell, Spinner, cx } from '../components/ui';
import { RefusalCard } from './Recover';

type Result = { title: string; ok: boolean; detail: any };

export default function Attacker() {
  const { device, session } = useLocal();
  const [clientId, setClientId] = useState(device?.clientId ?? session?.clientId ?? 'CH-100234');
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const put = (k: string, r: Result) => setResults((x) => ({ ...x, [k]: r }));

  const run = async (k: string, fn: () => Promise<Result>) => {
    setBusy(k);
    try {
      put(k, await fn());
    } catch (e: any) {
      put(k, { title: 'Error', ok: false, detail: e.message });
    } finally {
      setBusy(null);
    }
  };

  // 1. Use the stolen phone to send funds: no fingerprint → no passkey assertion; device key encrypted.
  const trySend = () =>
    run('send', async () => {
      const c = await cosigner.get(`/clients/${clientId}`);
      const on = await cosigner.get(`/clients/${clientId}/onchain`);
      const thief = Wallet.createRandom();
      const tx = buildSafeTx({ to: USDC_ADDRESS, data: usdcTransferData(thief.address, parseUnits(on.usdc || '0', 6)), nonce: on.nonce });
      // The thief cannot decrypt the device key without the password → signs with a key of his own.
      const sig = await signSafeTx(thief, c.safeAddress, tx);
      try {
        await cosigner.post('/tx/submit', { clientId, safeTx: tx, signatureK1: sig });
        return { title: 'Unexpected: accepted', ok: true, detail: '' };
      } catch (e: any) {
        return {
          title: 'Blocked by Swissquote co-signer',
          ok: false,
          detail: (
            <>
              <p>
                Server answer: <b>“{e.message}”</b>
              </p>
              <p className="mt-1">Without Alice's fingerprint there is no passkey assertion, and the device key stays encrypted by her password. Swissquote does not co-sign → only 0 of the 2 required signatures.</p>
            </>
          ),
        };
      }
    });

  // 2. Recovery with phone + email: liveness fails, no paper kit, SIM swap, unusual IP.
  const tryRecovery = (deepfake: boolean) =>
    run(deepfake ? 'deepfake' : 'recovery', async () => {
      const s = await partner.post('/sessions', {
        clientId,
        context: { swissquoteLogin: true, newDevice: false, unusualIp: true, simSwapRecent: true, actor: 'attacker' },
      });
      await partner.post(`/sessions/${s.sessionId}/liveness`, { result: deepfake ? 'match' : 'no-match' });
      await partner.post(`/sessions/${s.sessionId}/answers`, { answers: ['Rex', 'Zurich', 'Muller'] });
      const d = await partner.post(`/sessions/${s.sessionId}/decide`);
      return { title: d.decision === 'released' ? 'Unexpected: released' : 'Recovery refused', ok: d.decision === 'released', detail: <RefusalCard refusal={d} /> };
    });

  return (
    <Shell wide>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">🕵️ Attacker demo</h1>
        <MockBadge label="Scripted scenario" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card className="space-y-3">
          <div className="font-semibold">Scenario</div>
          <p className="text-sm text-navy-800">
            Mallory stole Alice's <b>unlocked phone</b> and has access to her <b>email</b> (and even a SIM swap). She tries to steal Alice's funds.
          </p>
          <label className="block text-sm">
            Target client
            <input className="mt-1 w-full rounded-lg border border-navy-100 px-3 py-2 font-mono text-sm" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </label>
          <ol className="space-y-2 text-sm">
            <li>
              <Button variant="secondary" onClick={trySend} disabled={!!busy}>
                {busy === 'send' ? <Spinner /> : '1. Send all USDC from the phone'}
              </Button>
            </li>
            <li>
              <Button variant="secondary" onClick={() => tryRecovery(false)} disabled={!!busy}>
                {busy === 'recovery' ? <Spinner /> : '2. "I lost my device" recovery with phone + email'}
              </Button>
            </li>
            <li>
              <Button variant="secondary" onClick={() => tryRecovery(true)} disabled={!!busy}>
                {busy === 'deepfake' ? <Spinner /> : '3. Same, assuming a deepfake fools the liveness check'}
              </Button>
            </li>
          </ol>
          <Notice tone="info" title="4. And if everything were fooled?">
            The key rotation still waits 48 h (2 min in the demo) while Alice is alerted by email, SMS and in her Swissquote account (separate login) — one tap cancels it. Her cloud backup is also encrypted with her wallet password, and 2 of 3 parts are always required.
          </Notice>
        </Card>
        <div className="space-y-3">
          {!Object.keys(results).length && <Card className="text-sm text-navy-700/60">Run an attack on the left. Results appear here and in the admin console; Alice is notified in her inbox.</Card>}
          {(['send', 'recovery', 'deepfake'] as const)
            .filter((k) => results[k])
            .map((k) => (
              <Card key={k} className="space-y-2">
                <div className={cx('font-semibold', results[k].ok ? 'text-bad-600' : 'text-ok-600')}>
                  {results[k].ok ? '⚠️ ' : '✅ '}
                  {k === 'send' ? 'Send attempt' : k === 'recovery' ? 'Recovery attempt' : 'Recovery with deepfake'}: {results[k].title}
                </div>
                <div className="text-sm">{results[k].detail}</div>
              </Card>
            ))}
        </div>
      </div>
    </Shell>
  );
}
