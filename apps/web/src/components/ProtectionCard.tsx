// "On-chain protection" card (Security) and the "Upgrade wallet security" banner (Home) for wallets opened before
// the guard existed. Status, pending protected operations (with a veto) and the emergency gas reserve.

import { useState } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { tr } from '../lib/i18n';
import { usePoll, useEnsureUnlocked } from '../lib/hooks';
import { unlockedKey } from '../lib/device';
import { activateProtection, getProtection, vetoPending, type ProtectionView } from '../lib/protection';
import { Button, Card, Notice, TxLink } from './ui';

const dur = (s: number) => (s >= 86400 ? tr(`${Math.round(s / 86400)} days`, `${Math.round(s / 86400)} jours`) : s >= 3600 ? `${Math.round(s / 3600)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);
const at = (unix: number) => new Date(unix * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function useUpgrade(clientId: string, safeAddress: string, reload: () => void) {
  const ensureUnlocked = useEnsureUnlocked();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tx, setTx] = useState<string | null>(null);
  const run = async () => {
    setErr('');
    try {
      await ensureUnlocked();
    } catch {
      return;
    }
    setBusy(true);
    try {
      const r = await activateProtection(clientId, safeAddress, unlockedKey());
      setTx(r.txHash);
      reload();
    } catch (e: any) {
      setErr(e?.name === 'NotAllowedError' ? tr('Verification was cancelled: nothing was signed.', 'La vérification a été annulée : rien n’a été signé.') : e.message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, tx, run };
}

/** Home banner: shown only for a deployed wallet that is not protected yet. */
export function UpgradeSecurityBanner({ clientId, safeAddress }: { clientId: string; safeAddress: string }) {
  const { data, reload } = usePoll(() => getProtection(clientId), 60000, [clientId]);
  const up = useUpgrade(clientId, safeAddress, () => reload?.());
  if (!data || !data.available || !data.deployed || data.protected) return null;
  return (
    <Notice tone="warn" className="mb-3" title={tr('Upgrade wallet security', 'Renforcer la sécurité du wallet')}>
      <div className="space-y-2">
        <p>{tr('Add the on-chain protection: only your device + Swissquote can act immediately; any other key combination must wait, and you can cancel it.', 'Ajoutez la protection on-chain : seuls votre appareil + Swissquote agissent immédiatement ; toute autre combinaison de clés doit attendre, et vous pouvez l’annuler.')}</p>
        {up.err && <p className="text-sq-down">{up.err}</p>}
        <Button onClick={up.run} disabled={up.busy}>
          {up.busy ? tr('Activating…', 'Activation…') : tr('Upgrade wallet security', 'Renforcer la sécurité')}
        </Button>
      </div>
    </Notice>
  );
}

/** Security page card. */
export function ProtectionCard({ clientId, safeAddress }: { clientId: string; safeAddress: string }) {
  const { data, reload } = usePoll<ProtectionView>(() => getProtection(clientId), 15000, [clientId]);
  const up = useUpgrade(clientId, safeAddress, () => reload?.());
  const ensureUnlocked = useEnsureUnlocked();
  const [vetoMsg, setVetoMsg] = useState<{ tone: 'ok' | 'bad'; text: string; tx?: string } | null>(null);
  if (!data || !data.deployed || !data.available) return null;

  const veto = async (module: 'D1' | 'D2') => {
    try {
      await ensureUnlocked();
    } catch {
      return;
    }
    try {
      const r = await vetoPending(clientId, safeAddress, unlockedKey(), module);
      setVetoMsg({ tone: 'ok', text: tr('Cancelled on the blockchain.', 'Annulée sur la blockchain.'), tx: r.txHash });
      reload?.();
    } catch (e: any) {
      setVetoMsg({ tone: 'bad', text: e.message });
    }
  };

  if (!data.protected)
    return (
      <Card className="space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldAlert size={20} strokeWidth={1.75} className="text-sq-warn" /> {tr('On-chain protection: not active', 'Protection on-chain : inactive')}
        </div>
        <p className="text-[14px] text-sq-muted">{tr('This wallet was opened before the on-chain protection existed. Activate it in one confirmation (device key + Swissquote).', 'Ce wallet a été ouvert avant la protection on-chain. Activez-la en une confirmation (clé de l’appareil + Swissquote).')}</p>
        {up.err && <Notice tone="bad">{up.err}</Notice>}
        {up.tx && <TxLink hash={up.tx}>{tr('Protection activated', 'Protection activée')}</TxLink>}
        <Button onClick={up.run} disabled={up.busy}>
          {up.busy ? tr('Activating…', 'Activation…') : tr('Upgrade wallet security', 'Renforcer la sécurité')}
        </Button>
      </Card>
    );

  const d1 = data.queues?.d1;
  const d2 = data.queues?.d2;
  const pending = [...(d1?.pending ?? []).map((p) => ({ ...p, module: 'D1' as const })), ...(d2?.pending ?? []).map((p) => ({ ...p, module: 'D2' as const }))];
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2 font-semibold">
        <ShieldCheck size={20} strokeWidth={1.75} className="text-sq-up" /> {tr('On-chain protection: active', 'Protection on-chain : active')}
      </div>
      <ul className="space-y-1 text-[14px] text-sq-ink-2">
        <li>{tr('Your device + Swissquote: immediate', 'Votre appareil + Swissquote : immédiat')}</li>
        <li>{tr(`Any other pair of keys: waits ${dur(d1?.cooldown ?? 0)} (48 h in production), cancellable`, `Toute autre paire de clés : attend ${dur(d1?.cooldown ?? 0)} (48 h en production), annulable`)}</li>
        <li>{tr(`Recovery key alone: waits ${dur(d2?.cooldown ?? 0)} (30 days in production), cancellable`, `Clé de secours seule : attend ${dur(d2?.cooldown ?? 0)} (30 jours en production), annulable`)}</li>
        {data.emergencyReserve?.eth && <li>{tr(`Emergency gas reserve: ${data.emergencyReserve.eth} ETH — used only if Swissquote is unavailable`, `Réserve de gas d’urgence : ${data.emergencyReserve.eth} ETH — utilisée seulement si Swissquote est indisponible`)}</li>}
      </ul>
      {data.record?.setupTx && <TxLink hash={data.record.setupTx}>{tr('Activation on Etherscan', 'Activation sur Etherscan')}</TxLink>}
      {pending.length > 0 && (
        <Notice tone="bad" title={tr('A protected operation is pending on your wallet', 'Une opération protégée est en attente sur votre wallet')}>
          <ul className="space-y-1">
            {pending.map((p) => (
              <li key={`${p.module}-${p.index}`}>
                {p.module} #{p.index} — {p.status === 'cooldown' ? tr(`executable at ${at(p.executableAt)}`, `exécutable à ${at(p.executableAt)}`) : p.status === 'executable' ? tr('executable now', 'exécutable maintenant') : tr('expired', 'expirée')}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            {d1?.pending.length ? <Button variant="secondary" onClick={() => veto('D1')}>{tr('Cancel it', 'L’annuler')} (D1)</Button> : null}
            {d2?.pending.length ? <Button variant="secondary" onClick={() => veto('D2')}>{tr('Cancel it', 'L’annuler')} (D2)</Button> : null}
          </div>
        </Notice>
      )}
      {vetoMsg && (
        <Notice tone={vetoMsg.tone}>
          {vetoMsg.text} {vetoMsg.tx && <TxLink hash={vetoMsg.tx} />}
        </Notice>
      )}
    </Card>
  );
}
