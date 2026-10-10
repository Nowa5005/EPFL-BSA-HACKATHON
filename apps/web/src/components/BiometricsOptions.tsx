import type { ReactNode } from 'react';

/** Discreet entry point: "La biométrie n'est pas disponible ? Découvrez les autres options." */
export function BiometricsOptions({ children, defaultOpen }: { children?: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="rounded-[10px] text-[13px] text-sq-ink-2" open={defaultOpen}>
      <summary className="min-h-11 cursor-pointer py-3 text-center text-sq-muted underline underline-offset-4">La biométrie n’est pas disponible ? Découvrez les autres options.</summary>
      <div className="space-y-2 rounded-[10px] border border-sq-line bg-white p-3">
        <p>
          Votre passkey demande une <b>vérification de l’utilisateur</b> par votre appareil : Touch ID, Face ID <b>ou le code / mot de passe de l’appareil</b>. My Wall ne peut pas savoir laquelle a été utilisée — seulement que votre appareil a vérifié que c’est vous.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Utilisez le code de votre appareil si la biométrie ne fonctionne pas.</li>
          <li>
            Utilisez votre <b>code de secours</b> (12 caractères), à configurer à l’avance dans Sécurité. Il remplace la passkey pour déverrouiller et confirmer une opération, mais jamais pour geler la co-signature, afficher vos montants ou vos secrets.
          </li>
          <li>Utilisez votre autre appareil lié, ou la procédure « J’ai perdu mon appareil ».</li>
        </ul>
        {children}
      </div>
    </details>
  );
}
