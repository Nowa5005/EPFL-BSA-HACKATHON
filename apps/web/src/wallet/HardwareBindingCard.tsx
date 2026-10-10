// #11 — Security → "Hardware binding": is this device's key K1 locked to its passkey (WebAuthn PRF)?
//  · active       — K1 = password keystore wrapped with a key only this device's passkey can derive (both needed)
//  · unavailable  — the browser / passkey provider has no PRF: password-only keystore (former scheme)
//  · not set      — device created before #11: one Touch ID adds the passkey layer now (no password needed)

import { useState } from 'react';
import { Cpu } from 'lucide-react';
import { bindExistingDevice, hardwareBindingStatus } from '../lib/device';
import { useLocal } from '../lib/hooks';
import { tr } from '../lib/i18n';
import { Button, Card, cx, Notice, Spinner } from '../components/ui';

export function HardwareBindingCard() {
  const { device } = useLocal();
  const status = hardwareBindingStatus(device);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);

  const bind = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await bindExistingDevice();
      setMsg(
        r === 'active'
          ? { tone: 'ok', text: tr('Done: this device’s key now needs both your password and this device’s passkey.', 'C’est fait : la clé de cet appareil exige désormais votre mot de passe et la passkey de cet appareil.') }
          : {
              tone: 'warn',
              text: tr(
                'This device’s current passkey cannot provide a hardware secret (PRF) — many passkeys created before hardware binding cannot. Your key stays protected by your password; the binding is applied automatically the next time a device is set up (new device or recovery).',
                'La passkey actuelle de cet appareil ne peut pas fournir de secret matériel (PRF) — c’est le cas de nombreuses passkeys créées avant la liaison matérielle. Votre clé reste protégée par votre mot de passe ; la liaison sera appliquée automatiquement à la prochaine configuration d’un appareil (nouvel appareil ou récupération).',
              ),
            },
      );
    } catch (e: any) {
      setMsg({ tone: 'bad', text: e?.name === 'NotAllowedError' ? tr('Touch ID cancelled: nothing changed.', 'Touch ID annulé : rien n’a changé.') : e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <Cpu size={20} strokeWidth={1.75} className="text-sq-ink-2" />
        <h2 className="flex-1 text-[16px] font-semibold">{tr('Hardware binding', 'Liaison matérielle')}</h2>
        <span
          data-testid="hw-binding-status"
          className={cx('rounded-[4px] px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide', status === 'active' ? 'bg-sq-ok-50 text-sq-up' : 'bg-sq-bg text-sq-muted')}
        >
          {status === 'active' ? tr('Active', 'Active') : status === 'unavailable' ? tr('Not available', 'Non disponible') : tr('Not set', 'Non activée')}
        </span>
      </div>
      <p className="text-[14px]" data-testid="hw-binding-line">
        {status === 'active'
          ? tr('Hardware binding: active', 'Liaison matérielle : active')
          : status === 'unavailable'
            ? tr('Hardware binding: not available on this browser', 'Liaison matérielle : non disponible sur ce navigateur')
            : tr('Hardware binding: not set on this device', 'Liaison matérielle : pas encore activée sur cet appareil')}
      </p>
      <p className="text-[13px] text-sq-muted">
        {status === 'active'
          ? tr(
              'This device’s key is encrypted twice: with your password AND with a key that only this device’s passkey (Secure Enclave / security chip) can produce. A copy of this browser’s data is useless without this device in hand.',
              'La clé de cet appareil est chiffrée deux fois : avec votre mot de passe ET avec une clé que seule la passkey de cet appareil (Secure Enclave / puce de sécurité) peut produire. Une copie des données de ce navigateur est inutile sans cet appareil en main.',
            )
          : status === 'unavailable'
            ? tr(
                'Your browser or passkey provider does not offer the WebAuthn “PRF” feature, so this device’s key is protected by your password only (signatures still need Touch ID and Swissquote’s co-signature). Recent Chrome, Edge and Safari support it.',
                'Votre navigateur ou gestionnaire de passkeys ne propose pas la fonction WebAuthn « PRF » : la clé de cet appareil n’est protégée que par votre mot de passe (les signatures exigent toujours Touch ID et la co-signature de Swissquote). Les versions récentes de Chrome, Edge et Safari la proposent.',
              )
            : tr(
                'This device was set up before hardware binding existed: its key is protected by your password only. Bind it to this device’s passkey with one Touch ID (your password is not needed).',
                'Cet appareil a été configuré avant la liaison matérielle : sa clé n’est protégée que par votre mot de passe. Liez-la à la passkey de cet appareil en un Touch ID (votre mot de passe n’est pas nécessaire).',
              )}
      </p>
      {status !== 'active' && (
        <Button variant="secondary" onClick={bind} disabled={busy}>
          {busy ? <Spinner /> : status === 'unavailable' ? tr('Try again on this browser', 'Réessayer sur ce navigateur') : tr('Bind to this device’s passkey', 'Lier à la passkey de cet appareil')}
        </Button>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </Card>
  );
}
