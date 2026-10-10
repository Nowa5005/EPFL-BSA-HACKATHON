// Shows the FULL recipient address and how it compares with saved beneficiaries.
// A saved address is not a guarantee; a resemblance is never presented as a match.

import { checkRecipient, type RecipientCheck as RC } from '@sq/shared';
import { cx } from './ui';
import { getLang, tr } from '../lib/i18n';

export function AddressWithDiff({ address, diff = [] }: { address: string; diff?: number[] }) {
  const set = new Set(diff);
  return (
    <code className="block break-all font-mono text-[13px] leading-relaxed" aria-label={`${tr('Address', 'Adresse')} ${address}`}>
      {address.split('').map((ch, i) =>
        set.has(i) ? (
          <mark key={i} className="rounded-sm bg-sq-down-solid px-px text-white">
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
  const r: RC = checkRecipient(input, contacts, getLang());
  if (r.status === 'invalid') return <p className="text-[13px] text-sq-down">{r.reason}</p>;
  if (r.status === 'exact')
    return (
      <div className="rounded-[10px] border border-sq-line bg-sq-surface p-3 text-[13px]">
        <div className="font-medium text-sq-ink">
          {tr('Saved beneficiary:', 'Bénéficiaire enregistré :')} {r.name}
          <span className="ml-1 font-normal text-sq-muted">(Ethereum Sepolia)</span>
        </div>
        {!compact && <AddressWithDiff address={r.address} />}
        <p className="mt-1 text-[12px] text-sq-muted">
          {tr(
            'The address matches character for character. A saved beneficiary is not a guarantee of safety: always check where the request came from.',
            'L’adresse correspond caractère pour caractère. Un bénéficiaire enregistré n’est pas une garantie de sécurité : vérifiez toujours l’origine de la demande.',
          )}
        </p>
      </div>
    );
  if (r.status === 'lookalike')
    return (
      <div role="alert" className="mw-important rounded-[10px] border border-sq-down/30 bg-sq-bad-50 p-3 text-[13px]">
        <div className="font-semibold text-sq-down">
          {tr(`Warning: this address looks like the one saved for “${r.name}” but it is different.`, `Attention : cette adresse ressemble à celle de « ${r.name} » mais elle est différente.`)}
        </div>
        <div className="mt-1 text-sq-ink-2">{tr('Address entered (different characters in red):', 'Adresse saisie (caractères différents en rouge) :')}</div>
        <AddressWithDiff address={r.address} diff={r.diff} />
        <div className="mt-1 text-sq-ink-2">{tr(`Address saved for ${r.name}:`, `Adresse enregistrée pour ${r.name} :`)}</div>
        <AddressWithDiff address={r.saved} diff={r.diff} />
        <p className="mt-1 text-[12px] text-sq-ink-2">
          {tr(
            `${r.diff.length} character(s) differ. “Address poisoning” scams copy the beginning and end of a known address.`,
            `${r.diff.length} caractère(s) diffèrent. Les escroqueries par « adresse empoisonnée » copient le début et la fin d’une adresse connue.`,
          )}
        </p>
      </div>
    );
  return (
    <div className={cx('rounded-[10px] border border-sq-warn/30 bg-sq-warn-50 p-3 text-[13px]')}>
      <div className="font-semibold text-sq-warn">{tr('New recipient', 'Nouveau destinataire')}</div>
      {!compact && <AddressWithDiff address={r.address} />}
      <p className="mt-1 text-[12px] text-sq-ink-2">
        {tr(
          'This address is not among your beneficiaries. Check it in full with the person, through another channel.',
          'Cette adresse ne figure pas dans vos bénéficiaires. Vérifiez-la en entier avec la personne, par un autre canal.',
        )}
      </p>
    </div>
  );
}
