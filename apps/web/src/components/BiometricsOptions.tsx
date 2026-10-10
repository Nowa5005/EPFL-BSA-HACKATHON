import type { ReactNode } from 'react';
import { getLang, tr } from '../lib/i18n';

/** Discreet entry point: "La biométrie n'est pas disponible ? Découvrez les autres options." */
export function BiometricsOptions({ children, defaultOpen }: { children?: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="rounded-[10px] text-[13px] text-sq-ink-2" open={defaultOpen}>
      <summary className="min-h-11 cursor-pointer py-3 text-center text-sq-muted underline underline-offset-4">{tr('Biometrics not available? See the other options.', 'La biométrie n’est pas disponible ? Découvrez les autres options.')}</summary>
      <div className="space-y-2 rounded-[10px] border border-sq-line bg-sq-surface p-3">
        {getLang() === 'en' ? (
          <p>
            Your passkey requires <b>user verification</b> by your device: Touch ID, Face ID <b>or the device PIN / password</b>. My Wall cannot tell which one was used — only that your device has verified it is you.
          </p>
        ) : (
          <p>
            Votre passkey demande une <b>vérification de l’utilisateur</b> par votre appareil : Touch ID, Face ID <b>ou le code / mot de passe de l’appareil</b>. My Wall ne peut pas savoir laquelle a été utilisée — seulement que votre appareil a vérifié que c’est vous.
          </p>
        )}
        <ul className="list-disc space-y-1 pl-5">
          <li>{tr('Use your device PIN if biometrics do not work.', 'Utilisez le code de votre appareil si la biométrie ne fonctionne pas.')}</li>
          <li>
            {tr('Use your', 'Utilisez votre')} <b>{tr('backup code', 'code de secours')}</b>{' '}
            {tr(
              '(12 characters), set up in advance in Security. It replaces the passkey to unlock and confirm an operation, but never to freeze co-signing, show your amounts or your secrets.',
              '(12 caractères), à configurer à l’avance dans Sécurité. Il remplace la passkey pour déverrouiller et confirmer une opération, mais jamais pour geler la co-signature, afficher vos montants ou vos secrets.',
            )}
          </li>
          <li>{tr('Use your other linked device, or the “I lost my device” procedure.', 'Utilisez votre autre appareil lié, ou la procédure « J’ai perdu mon appareil ».')}</li>
        </ul>
        {children}
      </div>
    </details>
  );
}
