// Shows the FULL recipient address and how it compares with saved beneficiaries.
// A saved address is not a guarantee; a resemblance is never presented as a match.

import { checkRecipient, type RecipientCheck as RC } from '@sq/shared';
import { cx } from './ui';

export function AddressWithDiff({ address, diff = [] }: { address: string; diff?: number[] }) {
  const set = new Set(diff);
  return (
    <code className="block break-all font-mono text-[13px] leading-relaxed" aria-label={`Adresse ${address}`}>
      {address.split('').map((ch, i) =>
        set.has(i) ? (
          <mark key={i} className="rounded-sm bg-sq-down px-px text-white">
            {ch}
          </mark>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </code>
  );
}

export function RecipientCheckView({ input, contacts, compact }: { input: string; contacts: { name: string; address: string }[]; compact?: boolean }) {
  if (!input) return null;
  const r: RC = checkRecipient(input, contacts);
  if (r.status === 'invalid') return <p className="text-[13px] text-sq-down">{r.reason}</p>;
  if (r.status === 'exact')
    return (
      <div className="rounded-[10px] border border-sq-line bg-white p-3 text-[13px]">
        <div className="font-medium text-sq-ink">
          Bénéficiaire enregistré : {r.name}
          <span className="ml-1 font-normal text-sq-muted">(Ethereum Sepolia)</span>
        </div>
        {!compact && <AddressWithDiff address={r.address} />}
        <p className="mt-1 text-[12px] text-sq-muted">L’adresse correspond caractère pour caractère. Un bénéficiaire enregistré n’est pas une garantie de sécurité : vérifiez toujours l’origine de la demande.</p>
      </div>
    );
  if (r.status === 'lookalike')
    return (
      <div role="alert" className="mw-important rounded-[10px] border border-sq-down/30 bg-sq-bad-50 p-3 text-[13px]">
        <div className="font-semibold text-sq-down">Attention : cette adresse ressemble à celle de « {r.name} » mais elle est différente.</div>
        <div className="mt-1 text-sq-ink-2">Adresse saisie (caractères différents en rouge) :</div>
        <AddressWithDiff address={r.address} diff={r.diff} />
        <div className="mt-1 text-sq-ink-2">Adresse enregistrée pour {r.name} :</div>
        <AddressWithDiff address={r.saved} diff={r.diff} />
        <p className="mt-1 text-[12px] text-sq-ink-2">{r.diff.length} caractère(s) diffèrent. Les escroqueries par « adresse empoisonnée » copient le début et la fin d’une adresse connue.</p>
      </div>
    );
  return (
    <div className={cx('rounded-[10px] border border-sq-warn/30 bg-sq-warn-50 p-3 text-[13px]')}>
      <div className="font-semibold text-sq-warn">Nouveau destinataire</div>
      {!compact && <AddressWithDiff address={r.address} />}
      <p className="mt-1 text-[12px] text-sq-ink-2">Cette adresse ne figure pas dans vos bénéficiaires. Vérifiez-la en entier avec la personne, par un autre canal.</p>
    </div>
  );
}
