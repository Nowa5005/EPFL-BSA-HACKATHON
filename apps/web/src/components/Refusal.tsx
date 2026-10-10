// #4 (part A) — Swissquote may refuse to co-sign, never silently: every refusal shows the precise reason, the rule,
// how to fix it, and the reminder that the client's funds are never locked (protected exit with the recovery key).
// Also: "Your guarantees" (Security) and the client-visible log of co-signer decisions (docs/COSIGNER_COMMITMENTS.md).

import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { cosigner } from '../lib/api';
import { usePoll } from '../lib/hooks';
import { tr } from '../lib/i18n';
import { Card, dateTime } from './ui';

export const fundsNeverLocked = () =>
  tr(
    'Your funds are never locked: you can always move them with your recovery key (protected exit, see Security).',
    'Vos fonds ne sont jamais bloqués : vous pouvez toujours les déplacer avec votre clé de secours (sortie protégée, voir Sécurité).',
  );

interface Check {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'step-up';
  detail?: string;
}

/** How the client can resolve a refusal, per rule (policy.ts / travelRule.ts / index.ts check ids). */
export function fixFor(id: string): string {
  const m: Record<string, [string, string]> = {
    operation: ['Use the standard send or app flows of My Wall: advanced operations (DELEGATECALL) are never co-signed.', 'Utilisez les parcours d’envoi ou d’app de My Wall : les opérations avancées (DELEGATECALL) ne sont jamais co-signées.'],
    'self-call': ['Key changes go through Security → recovery, which has its own checks and delay.', 'Les changements de clés passent par Sécurité → récupération, qui a ses propres contrôles et délai.'],
    sanctions: ['Swissquote cannot send to a sanctioned address. If you think the match is wrong, contest it with your advisor (reply within 24 h).', 'Swissquote ne peut pas envoyer vers une adresse sanctionnée. Si la correspondance vous semble erronée, contestez-la auprès de votre conseiller (réponse sous 24 h).'],
    funds: ['Lower the amount, or top up your wallet first (Receive, or transfer from your Swissquote account).', 'Réduisez le montant, ou alimentez d’abord votre wallet (Recevoir, ou virement depuis votre compte Swissquote).'],
    dapp: ['Only apps on Swissquote’s approved list can be used. Ask your advisor to review the app if you need it.', 'Seules les apps de la liste approuvée par Swissquote sont utilisables. Demandez à votre conseiller d’examiner l’app si vous en avez besoin.'],
    daily: ['Send a smaller amount today, or wait until tomorrow (the daily limit resets at midnight UTC).', 'Envoyez un montant plus petit aujourd’hui, ou attendez demain (la limite se réinitialise à minuit UTC).'],
    'gas-quota': ['Your daily quota of free network fees is used up: try again tomorrow.', 'Votre quota journalier de frais réseau offerts est épuisé : réessayez demain.'],
    simulation: ['The operation would fail on the blockchain: check the amount and the balance, then start again.', 'L’opération échouerait sur la blockchain : vérifiez le montant et le solde, puis recommencez.'],
    'unknown-token': ['Do nothing with this token: use “Ignore” in Unrecognised tokens. It has no value for Swissquote and is often a scam.', 'Ne faites rien avec ce jeton : utilisez « Ignorer » dans Jetons non reconnus. Il n’a aucune valeur pour Swissquote et c’est souvent une arnaque.'],
    lookalike: ['Choose the recipient from your contacts, or get the address again from the person through another channel. Never copy it from your history.', 'Choisissez le destinataire dans vos contacts, ou redemandez l’adresse à la personne par un autre canal. Ne la copiez jamais depuis l’historique.'],
    'token-contract': ['Ask the recipient for their own wallet address (the token contract is not a wallet).', 'Demandez au destinataire l’adresse de son propre wallet (le contrat du jeton n’est pas un wallet).'],
    'travel-rule': ['Complete the beneficiary information requested in the send form, then try again.', 'Complétez les informations sur le bénéficiaire demandées dans le formulaire d’envoi, puis réessayez.'],
    'travel-rule-beneficiary': ['Complete the beneficiary information requested in the send form, then try again.', 'Complétez les informations sur le bénéficiaire demandées dans le formulaire d’envoi, puis réessayez.'],
    'travel-rule-value': ['Wait a moment for a market price and try again, or send a smaller amount.', 'Attendez un cours de marché et réessayez, ou envoyez un montant plus petit.'],
    'travel-rule-transmission': ['Transfers to third parties need a Travel Rule connection that this prototype does not have: send to one of your own verified wallets.', 'Les transferts vers des tiers exigent une connexion Travel Rule absente de ce prototype : envoyez vers un de vos wallets vérifiés.'],
  };
  const t = m[id];
  return t ? tr(t[0], t[1]) : tr('Contact your advisor: they can explain the decision and review it (reply within 24 h).', 'Contactez votre conseiller : il peut expliquer la décision et la réexaminer (réponse sous 24 h).');
}

/** Each failed rule: precise reason, rule, how to fix it — then the "funds never locked" guarantee. */
export function RefusalExplained({ checks, reasons }: { checks?: Check[]; reasons?: string[] }) {
  const failed = (checks ?? []).filter((c) => c.status === 'fail');
  return (
    <div className="space-y-2" data-testid="refusal-explained">
      {failed.length ? (
        <ul className="space-y-2">
          {failed.map((c) => (
            <li key={c.id + (c.detail ?? '')} className="rounded-[10px] border border-sq-down/20 bg-sq-bad-50 p-3 text-[13px]">
              <div className="font-semibold text-sq-down">{c.detail ?? c.label}</div>
              <div className="mt-1 text-sq-ink-2">
                <span className="font-medium text-sq-ink">{tr('Rule: ', 'Règle : ')}</span>
                {c.label}
              </div>
              <div className="mt-0.5 text-sq-ink-2">
                <span className="font-medium text-sq-ink">{tr('How to fix it: ', 'Comment le résoudre : ')}</span>
                {fixFor(c.id)}
              </div>
            </li>
          ))}
        </ul>
      ) : reasons?.length ? (
        <p className="text-[14px]">{reasons.join(' · ')}</p>
      ) : null}
      <FundsNeverLocked />
    </div>
  );
}

export function FundsNeverLocked() {
  return (
    <p className="flex gap-2 rounded-[10px] bg-sq-surface p-3 text-[13px] font-medium text-sq-ink" data-testid="funds-never-locked">
      <ShieldCheck size={18} strokeWidth={1.75} className="mt-px shrink-0 text-sq-up" aria-hidden />
      <span>
        {fundsNeverLocked()}{' '}
        <Link to="/wallet/security#guarantees" className="underline underline-offset-2">
          {tr('Your guarantees', 'Vos garanties')}
        </Link>
      </span>
    </p>
  );
}

/** Refusal by the co-signer's validator (HTTP 400 "Transaction refused by the co-signer: …"). */
export const isCosignerRefusal = (message: string) => /refused by the co-signer|refusée par le co-signataire|refuses to co-sign|refuse de co-signer/i.test(message);

/** Security → "Your guarantees" (3 simple lines). */
export function YourGuarantees() {
  const lines: [string, string][] = [
    ['Swissquote cannot move your funds: it holds only 1 of the 3 keys, and every payment needs 2.', 'Swissquote ne peut pas déplacer vos fonds : elle ne détient qu’1 des 3 clés, et chaque paiement en exige 2.'],
    ['Swissquote cannot block you durably: with your recovery key you can always leave (protected exit).', 'Swissquote ne peut pas vous bloquer durablement : avec votre clé de secours, vous pouvez toujours partir (sortie protégée).'],
    ['Every decision is logged: each co-signature or refusal, with its reason, is in the log below.', 'Chaque décision est journalisée : chaque co-signature ou refus, avec son motif, figure dans le journal ci-dessous.'],
  ];
  return (
    <Card className="space-y-2" as="section">
      <h2 id="guarantees" className="scroll-mt-20 text-[16px] font-semibold">{tr('Your guarantees', 'Vos garanties')}</h2>
      <ul className="space-y-1.5">
        {lines.map(([en, fr]) => (
          <li key={en} className="flex gap-2 text-[14px]">
            <ShieldCheck size={18} strokeWidth={1.75} className="mt-px shrink-0 text-sq-up" aria-hidden /> {tr(en, fr)}
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-sq-muted">
        {tr('Response times and how to contest a decision: compliant payments co-signed in under 60 s, human review within 24 h.', 'Délais et contestation : paiements conformes co-signés en moins de 60 s, revue humaine sous 24 h.')}{' '}
        <a href="#cosigner-decisions" className="underline underline-offset-2">{tr('Co-signer decisions', 'Décisions du co-signataire')}</a>
      </p>
    </Card>
  );
}

interface TxReq {
  id: string;
  status: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  policy?: { decision: string; reasons: string[]; checks?: Check[] };
  approval?: { decision: 'approved' | 'rejected'; at: string; note?: string };
  txHash?: string;
}

/** Client-visible log of every co-signer decision (from the stored transaction requests). */
export function CosignerDecisions({ clientId }: { clientId: string }) {
  const { data, error } = usePoll<TxReq[]>(() => cosigner.get(`/clients/${clientId}/tx-requests`), 30000, [clientId]);
  const rows = (data ?? []).slice(0, 30);
  const label = (r: TxReq) =>
    r.status === 'rejected'
      ? r.approval?.decision === 'rejected'
        ? tr('Refused after human review', 'Refusée après revue humaine')
        : tr('Refused by the rules', 'Refusée par les règles')
      : r.status === 'executed'
        ? tr('Co-signed', 'Co-signée')
        : r.status === 'cancelled'
          ? tr('Cancelled', 'Annulée')
          : r.status === 'failed'
            ? tr('Co-signed, failed on-chain', 'Co-signée, échec sur la blockchain')
            : tr('Enhanced checks in progress', 'Contrôles renforcés en cours');
  return (
    <Card className="space-y-2" as="section">
      <h2 id="cosigner-decisions" className="scroll-mt-20 text-[16px] font-semibold">{tr('Co-signer decisions', 'Décisions du co-signataire')}</h2>
      <p className="text-[13px] text-sq-muted">
        {tr('Every request Swissquote received from this wallet, with its decision and reason. To contest a refusal, contact your advisor with the reference shown (reply within 24 h).', 'Chaque demande reçue par Swissquote depuis ce wallet, avec sa décision et son motif. Pour contester un refus, contactez votre conseiller avec la référence indiquée (réponse sous 24 h).')}
      </p>
      {error ? (
        <p className="text-[13px] text-sq-down">{error}</p>
      ) : !rows.length ? (
        <p className="text-[13px] text-sq-muted">{tr('No decision yet.', 'Aucune décision pour l’instant.')}</p>
      ) : (
        <ul className="divide-y divide-sq-line" data-testid="cosigner-decisions">
          {rows.map((r) => (
            <li key={r.id} className="py-2.5 text-[13px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{r.summary}</span>
                <span className={r.status === 'rejected' ? 'font-semibold text-sq-down' : r.status === 'executed' ? 'text-sq-up' : 'text-sq-ink-2'}>{label(r)}</span>
              </div>
              <div className="text-[12px] text-sq-muted">
                {dateTime(r.createdAt)} · {tr('ref.', 'réf.')} {r.id.slice(0, 8)}
              </div>
              {r.status === 'rejected' && (
                <div className="mt-0.5 text-[12px] text-sq-ink-2">{r.approval?.note ?? (r.policy?.reasons ?? []).join(' · ')}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
