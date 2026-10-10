import { useState } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { Wallet, parseUnits } from 'ethers';
import { USDC_ADDRESS, buildSafeTx, signSafeTx, usdcTransferData } from '@sq/shared';
import { ApiError, cosigner, partner } from '../lib/api';
import { tr } from '../lib/i18n';
import { useLocal } from '../lib/hooks';
import { Button, Card, cx, inputCls, Notice, Spinner } from '../components/ui';
import { InternalShell } from '../components/InternalShell';
import { RefusalCard } from './Recover';

type Result = { title: string; stolen: boolean; detail: any };

export default function Attacker() {
  const { device, session } = useLocal();
  const [clientId, setClientId] = useState(device?.clientId ?? session?.clientId ?? 'CH-100234');
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});

  const run = async (k: string, fn: () => Promise<Result>) => {
    setBusy(k);
    try {
      const r = await fn();
      setResults((x) => ({ ...x, [k]: r }));
    } catch (e: any) {
      // Since the services require the victim's own session token, most attempts now stop at the door.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403))
        setResults((x) => ({
          ...x,
          [k]: {
            title: e.status === 401 ? tr('Refused: no valid Swissquote session', 'Refusé : aucune session Swissquote valide') : tr('Refused: this session cannot act for that client', 'Refusé : cette session ne peut pas agir pour ce client'),
            stolen: false,
            detail: (
              <p>
                {tr('Server response:', 'Réponse du serveur :')} <b>« {e.message} »</b>. {tr('Every service checks the signed session token and the client it belongs to before doing anything.', 'Chaque service vérifie le jeton de session signé et le client auquel il appartient avant toute action.')}
              </p>
            ),
          },
        }));
      else setResults((x) => ({ ...x, [k]: { title: tr('Error', 'Erreur'), stolen: false, detail: e.message } }));
    } finally {
      setBusy(null);
    }
  };

  // 1. Use the stolen phone: no fingerprint → no passkey assertion; device key encrypted by the password.
  const trySend = () =>
    run('send', async () => {
      const c = await cosigner.get(`/clients/${clientId}`);
      const on = await cosigner.get(`/clients/${clientId}/onchain`);
      const thief = Wallet.createRandom();
      const tx = buildSafeTx({ to: USDC_ADDRESS, data: usdcTransferData(thief.address, parseUnits(on.usdc || '0', 6)), nonce: on.nonce });
      const sig = await signSafeTx(thief, c.safeAddress, tx);
      try {
        await cosigner.post('/tx/submit', { clientId, safeTx: tx, signatureK1: sig });
        return { title: tr('Unexpected: accepted', 'Inattendu : accepté'), stolen: true, detail: '' };
      } catch (e: any) {
        return {
          title: tr('Blocked by the Swissquote co-signer', 'Bloqué par le co-signataire Swissquote'),
          stolen: false,
          detail: (
            <>
              <p>
                {tr('Server response:', 'Réponse du serveur :')} <b>« {e.message} »</b>
              </p>
              <p className="mt-1">
                {tr(
                  'Without Alice’s fingerprint there is no passkey, and the device key stays encrypted by her password. Swissquote does not co-sign: 0 valid signatures out of the 2 required.',
                  'Sans l’empreinte d’Alice, pas de passkey ; et la clé de l’appareil reste chiffrée par son mot de passe. Swissquote ne co-signe pas : 0 signature valide sur les 2 requises.',
                )}
              </p>
            </>
          ),
        };
      }
    });

  // 2./3. Recovery with phone + email: liveness fails (or is fooled), no recovery part, SIM swap, unusual IP.
  const tryRecovery = (deepfake: boolean) =>
    run(deepfake ? 'deepfake' : 'recovery', async () => {
      const s = await partner.post('/sessions', { clientId, context: { swissquoteLogin: true, newDevice: false, unusualIp: true, simSwapRecent: true, actor: 'attacker' } });
      await partner.post(`/sessions/${s.sessionId}/liveness`, { result: deepfake ? 'match' : 'no-match' });
      await partner.post(`/sessions/${s.sessionId}/answers`, { answers: ['Rex', 'Zurich', 'Muller'] });
      const d = await partner.post(`/sessions/${s.sessionId}/decide`);
      return { title: d.decision === 'released' ? tr('Unexpected: released', 'Inattendu : libérée') : tr('Recovery refused', 'Récupération refusée'), stolen: d.decision === 'released', detail: <RefusalCard refusal={d} /> };
    });

  const LABEL: Record<string, string> = {
    send: tr('Send attempt', 'Tentative d’envoi'),
    recovery: tr('Recovery attempt', 'Tentative de récupération'),
    deepfake: tr('Recovery with a deepfake', 'Récupération avec deepfake'),
  };

  return (
    <InternalShell title={tr('Attacker demo', 'Démo attaquant')} banner={tr('Scripted scenario — security demonstration', 'Scénario scripté — démonstration de sécurité')}>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card className="space-y-3">
          <h1 className="text-[20px] font-semibold">{tr('Scenario', 'Scénario')}</h1>
          <p className="text-[14px] text-sq-ink-2">
            {tr('Mallory has stolen Alice’s', 'Mallory a volé le')} <b>{tr('unlocked phone', 'téléphone déverrouillé')}</b>{' '}
            {tr('and has access to her', 'd’Alice et a accès à son')} <b>{tr('email', 'email')}</b>{' '}
            {tr('(and even her SIM card). She tries to steal the funds.', '(et même à sa carte SIM). Elle tente de voler les fonds.')}
          </p>
          <label className="block text-[14px]">
            {tr('Target client', 'Client ciblé')}
            <input className={cx(inputCls, 'mt-1 font-mono text-[14px]')} value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </label>
          <ol className="space-y-2">
            <li>
              <Button variant="secondary" onClick={trySend} disabled={!!busy}>
                {busy === 'send' ? <Spinner /> : tr('1. Send all USDC from the phone', '1. Envoyer tous les USDC depuis le téléphone')}
              </Button>
            </li>
            <li>
              <Button variant="secondary" onClick={() => tryRecovery(false)} disabled={!!busy}>
                {busy === 'recovery' ? <Spinner /> : tr('2. “I lost my device” with phone + email', '2. « J’ai perdu mon appareil » avec téléphone + email')}
              </Button>
            </li>
            <li>
              <Button variant="secondary" onClick={() => tryRecovery(true)} disabled={!!busy}>
                {busy === 'deepfake' ? <Spinner /> : tr('3. Same, assuming a deepfake fools the selfie', '3. Idem, en supposant un deepfake qui trompe le selfie')}
              </Button>
            </li>
          </ol>
          <Notice title={tr('4. What if everything were fooled?', '4. Et si tout était trompé ?')}>
            {tr(
              'The key replacement still waits 48 h (2 min in the demo) while Alice is alerted by email, SMS and in her Swissquote account (separate sign-in) — one tap is enough to cancel. Her cloud backup is encrypted by her password, and 2 parts out of 3 are always required.',
              'Le remplacement de clé attend encore 48 h (2 min en démo) pendant qu’Alice est alertée par email, SMS et dans son compte Swissquote (connexion séparée) — un geste suffit pour annuler. Sa sauvegarde cloud est chiffrée par son mot de passe, et 2 parties sur 3 sont toujours nécessaires.',
            )}
          </Notice>
        </Card>
        <div className="space-y-3">
          {!Object.keys(results).length && <Card className="text-[14px] text-sq-muted">
              {tr(
                'Launch an attack on the left. Results appear here and in the Swissquote console; Alice is notified in her inbox.',
                'Lancez une attaque à gauche. Les résultats s’affichent ici et dans la console Swissquote ; Alice est notifiée dans sa boîte de réception.',
              )}
            </Card>}
          {(['send', 'recovery', 'deepfake'] as const)
            .filter((k) => results[k])
            .map((k) => (
              <Card key={k} className="space-y-2">
                <div className={cx('flex items-center gap-2 font-semibold', results[k].stolen ? 'text-sq-down' : 'text-sq-up')}>
                  {results[k].stolen ? <ShieldAlert size={20} strokeWidth={1.75} /> : <ShieldCheck size={20} strokeWidth={1.75} />}
                  {LABEL[k]}{tr(':', ' :')} {results[k].title}
                </div>
                <div className="text-[14px]">{results[k].detail}</div>
              </Card>
            ))}
        </div>
      </div>
    </InternalShell>
  );
}
