// #19 — Unrecognised tokens (collapsed, never valued, no interaction) and look-alike address warnings.
// The only action on an unrecognised token is "Ignore", which hides it locally on the server list: nothing is signed.

import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { cosigner } from '../lib/api';
import { useLocal, usePoll, type WalletTxView } from '../lib/hooks';
import { tr } from '../lib/i18n';
import { Addr, cx, dateTime } from '../components/ui';

/** Rows that must never be treated as a normal payment (no receipt, no "send back", no animation). */
export const isSuspicious = (t: Pick<WalletTxView, 'flags'>) => !!t.flags?.some((f) => f === 'lookalike' || f === 'zero-value');

/** Small red label shown next to the counterparty in history lists. */
export function ScamFlag({ t }: { t: Pick<WalletTxView, 'flags'> }) {
  if (!t.flags?.length) return null;
  const label = t.flags.includes('lookalike')
    ? tr('Look-alike address — possible scam', 'Adresse sosie — arnaque possible')
    : t.flags.includes('zero-value')
      ? tr('Zero-value transfer — possible scam', 'Transfert de valeur nulle — arnaque possible')
      : tr('Tiny amount from an unknown address', 'Montant infime d’une adresse inconnue');
  return (
    <span className={cx('ml-1 inline-flex items-center gap-1 rounded-full px-2 py-px align-middle text-[11px] font-medium', isSuspicious(t) ? 'bg-sq-bad-50 text-sq-down' : 'bg-sq-warn-50 text-sq-warn')} data-testid="scam-flag">
      <ShieldAlert size={12} strokeWidth={2} aria-hidden /> {label}
    </span>
  );
}

/** Explanation on the transaction detail of a flagged row. */
export function ScamExplanation({ t }: { t: WalletTxView }) {
  if (!t.flags?.length) return null;
  const imitated = t.lookalikeOf ? t.lookalikeOf.name ?? `${t.lookalikeOf.address.slice(0, 6)}…${t.lookalikeOf.address.slice(-4)}` : null;
  return (
    <div role="alert" className="mw-important rounded-[10px] border border-sq-down/30 bg-sq-bad-50 p-3 text-[13px]" data-testid="scam-explanation">
      <div className="font-semibold text-sq-down">
        {t.flags.includes('lookalike') ? tr('Look-alike address — possible scam', 'Adresse sosie — arnaque possible') : tr('Suspicious transfer', 'Transfert suspect')}
      </div>
      <p className="mt-1 text-sq-ink-2">
        {imitated
          ? tr(
              `This address copies the first and last characters of ${imitated}, but it is a different address. Scammers send tiny or zero-value transfers so that it appears in your history and you copy it by mistake.`,
              `Cette adresse copie les premiers et derniers caractères de ${imitated}, mais c’est une autre adresse. Les escrocs envoient des transferts infimes ou nuls pour qu’elle apparaisse dans votre historique et que vous la copiiez par erreur.`,
            )
          : tr(
              'A zero-value or tiny transfer from an unknown address is a common way to slip a fake address into your history.',
              'Un transfert nul ou infime venant d’une adresse inconnue est une façon courante d’insérer une fausse adresse dans votre historique.',
            )}
      </p>
      <p className="mt-1 font-medium text-sq-ink">{tr('Never copy an address from your history: pick recipients from your contacts. Sending to a look-alike of a contact is refused.', 'Ne copiez jamais une adresse depuis l’historique : choisissez vos destinataires dans vos contacts. Un envoi vers le sosie d’un contact est refusé.')}</p>
    </div>
  );
}

interface Sighting {
  token: string;
  standard: 'erc20' | 'erc721';
  label?: string;
  firstSeen: string;
  lastSeen: string;
  transfers: { key: string; direction: 'in' | 'out'; from: string; to: string; amount?: string; lookalikeOf?: { name?: string; address: string } }[];
  warning: string;
}

/** Collapsed "Unrecognised tokens" section: never valued, no send / approve / swap; "Ignore" signs nothing. */
export function UnrecognisedTokens() {
  const { device } = useLocal();
  const clientId = device?.clientId;
  const { data, reload } = usePoll<Sighting[]>(async () => (clientId ? cosigner.get(`/clients/${clientId}/unrecognised-tokens`) : []), 30000, [clientId]);
  const [busy, setBusy] = useState<string | null>(null);
  const list = data ?? [];
  if (!list.length) return null;
  const ignore = async (token: string) => {
    setBusy(token);
    try {
      await cosigner.post(`/clients/${clientId}/unrecognised-tokens/hide`, { token });
      await reload();
    } finally {
      setBusy(null);
    }
  };
  return (
    <details className="mt-3 rounded-[10px] border border-sq-line" data-testid="unrecognised-tokens">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-[14px] font-medium">
        <ShieldAlert size={16} strokeWidth={1.75} className="text-sq-warn" aria-hidden />
        {tr(`Unrecognised tokens (${list.length})`, `Jetons non reconnus (${list.length})`)}
        <span className="ml-auto text-[12px] font-normal text-sq-muted">{tr('not valued', 'non valorisés')}</span>
      </summary>
      <div className="space-y-3 border-t border-sq-line p-3">
        <p className="rounded-[8px] bg-sq-bad-50 p-2.5 text-[13px] font-medium text-sq-down">{tr('Do not interact: unknown tokens are often scams.', 'N’interagissez pas : les jetons inconnus sont souvent des arnaques.')}</p>
        <p className="text-[12px] text-sq-muted">
          {tr(
            'Anyone can send any token to any address. These are not in Swissquote’s list: they are never valued, and Swissquote never co-signs a transfer, approval or any call on them. Do not visit websites named in a token, and never “claim” anything.',
            'N’importe qui peut envoyer n’importe quel jeton à n’importe quelle adresse. Ceux-ci ne sont pas dans la liste de Swissquote : ils ne sont jamais valorisés, et Swissquote ne co-signe jamais de transfert, d’autorisation ni d’appel sur eux. Ne visitez aucun site mentionné dans un jeton et ne « réclamez » jamais rien.',
          )}
        </p>
        <ul className="divide-y divide-sq-line">
          {list.map((s) => (
            <li key={s.token} className="flex flex-wrap items-start gap-2 py-2.5 text-[13px]">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {s.standard === 'erc721' ? tr('Unknown NFT', 'NFT inconnu') : tr('Unknown token', 'Jeton inconnu')}
                  {s.label && <span className="font-normal text-sq-muted"> · {tr('calls itself', 'se nomme')} “{s.label}”</span>}
                </span>
                <span className="block text-[12px] text-sq-muted">
                  {tr('Contract', 'Contrat')} <Addr a={s.token} /> · {s.transfers.length} {tr('transfer(s)', 'transfert(s)')} · {tr('last', 'dernier')} {dateTime(s.lastSeen)}
                </span>
                {s.transfers.some((x) => x.lookalikeOf) && (
                  <span className="mt-0.5 block text-[12px] font-medium text-sq-down">{tr('Sent from a look-alike address — possible scam', 'Envoyé depuis une adresse sosie — arnaque possible')}</span>
                )}
              </span>
              <button type="button" disabled={busy === s.token} onClick={() => void ignore(s.token)} className="min-h-10 rounded-full border border-sq-line px-3 text-[13px] hover:bg-sq-chip/60" title={tr('Hides it from this list. Nothing is signed or sent.', 'Le masque de cette liste. Rien n’est signé ni envoyé.')}>
                {tr('Ignore', 'Ignorer')}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
