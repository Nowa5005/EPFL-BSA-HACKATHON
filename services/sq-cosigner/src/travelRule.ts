// Travel Rule / third-party transfer policy — authoritative server-side check at /tx/prepare AND again at /tx/submit,
// before any co-signature. Sources, decisions and limits: docs/COMPLIANCE.md (NOT legal advice; to be validated by
// compliance). #9 — three routes for a third party's wallet:
//   • address managed by a VASP (Travel Rule directory) → IVMS101 sent over a TRP-like API BEFORE co-signing; K2 signs
//     only after a signed "approved" from that VASP (trpClient.ts, travelRuleGlue.ts). Network SIMULATED (vasp-mock);
//   • personal (unhosted) wallet → ownership proof signed by the beneficiary (EIP-191), or — below the threshold only
//     (linked operations included, unknown value ⇒ above) — the client's declaration;
//   • a hosted wallet the directory does not know → refused (nothing can be transmitted).
// The client's own verified wallets need no third-party data.
//
// Personal data: beneficiary details live only in the client record (client.travelRule.records — returned to that
// client and to the compliance console, never in activity texts, notifications, logs or on-chain). Audit entries
// (db.travelRuleAudit) carry the rule version, threshold, rate + asOf and decision, WITHOUT personal data.

import { getAddress, verifyMessage } from 'ethers';
import {
  TRAVEL_RULE,
  type VaspInfo,
  beneficiaryKey,
  missingBeneficiaryFields,
  pick,
  type BeneficiaryInput,
  type Lang,
  type PolicyCheck,
  type PolicyResult,
  type TransferDeclaration,
  addressFromLine,
  parseOwnershipProofMessage,
  personFromName,
  type Person,
} from '@sq/shared';
import { newId, nowIso, type ServerRate } from '@sq/shared/server';

export interface TravelRuleConfig {
  version: string;
  thresholdChf: number;
  rateMaxAgeSec: number;
  linkedWindowDays: number;
  transmissionIntegration: string | null;
  ownershipProofMaxAgeSec: number;
  retentionYears: number;
}

const num = (v: string | undefined, d: number) => (v !== undefined && v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);

/** Effective configuration: shared defaults + env overrides. (#9: the former "demo mode" is gone — see header.) */
export function travelRuleConfig(env: NodeJS.ProcessEnv = process.env): TravelRuleConfig {
  return {
    version: TRAVEL_RULE.version,
    thresholdChf: num(env.TRAVEL_RULE_THRESHOLD_CHF, TRAVEL_RULE.enhancedThresholdChf),
    rateMaxAgeSec: num(env.TRAVEL_RULE_RATE_MAX_AGE_SEC, TRAVEL_RULE.rateMaxAgeSec),
    linkedWindowDays: num(env.TRAVEL_RULE_LINKED_WINDOW_DAYS, TRAVEL_RULE.linkedWindowDays),
    transmissionIntegration: TRAVEL_RULE.transmissionIntegration,
    ownershipProofMaxAgeSec: TRAVEL_RULE.ownershipProofMaxAgeSec,
    retentionYears: TRAVEL_RULE.retentionYears,
  };
}

export interface OwnWallet {
  address: string;
  label: string;
  kind: 'swissquote-account' | 'external' | 'my-wall';
  method: string;
  verifiedAt?: string;
}

/** A previous outgoing third-party transfer of this client (for linked operations). chf null = could not be valued. */
export interface LinkedOp {
  at: string;
  chf: number | null;
  beneficiaryKey: string;
  address: string;
}

export interface TravelRuleInput {
  config: TravelRuleConfig;
  now: Date;
  transfer: { asset: 'ETH' | 'USDC'; amount: string; recipient: string };
  declaration?: TransferDeclaration;
  /** null = the verified-wallet registry (sq-bank) could not be reached. */
  ownWallets: OwnWallet[] | null;
  rate?: ServerRate;
  linked: LinkedOp[];
  lang: Lang;
  /** #9 — VASP that manages the recipient address according to the Travel Rule directory (null = none known). */
  vasp?: VaspInfo | null;
  /** #9 — Result of the ownership-proof verification (signature + challenge), done by the caller. */
  ownership?: { status: 'valid' | 'invalid' | 'absent'; detail?: [string, string] };
}

export type TravelRuleRoute = 'vasp' | 'self-hosted-proof' | 'self-hosted-declaration';
export type TransmissionStatus = 'not-applicable' | 'trp-required' | 'trp-unreachable' | 'ownership-proof' | 'client-declaration' | 'proof-required';

export interface TravelRuleResult {
  category: 'own' | 'third-party' | 'undeclared';
  decision: 'allow' | 'reject';
  route?: TravelRuleRoute;
  vasp?: { vaspId: string; name: string };
  ownWallet?: { label: string; kind: OwnWallet['kind']; method: string };
  chf: { value: number | null; rate: number | null; asOf: string | null; provider: string | null; issue: null | 'missing' | 'stale' };
  aggregateChf: number | null;
  linkedCount: number;
  thresholdChf: number;
  enhancedRequired: boolean;
  missing: string[];
  transmission: TransmissionStatus;
  checks: PolicyCheck[];
  reasons: string[];
  reasonsFr?: string[];
}

const FIELD_LABEL: Record<string, [string, string]> = {
  name: ['beneficiary full name', 'nom complet du bénéficiaire'],
  walletType: ['type of wallet (exchange/bank or personal)', 'type de wallet (plateforme/banque ou personnel)'],
  providerName: ['name of the exchange or institution', 'nom de la plateforme ou de l’établissement'],
  street: ['beneficiary street address', 'adresse (rue) du bénéficiaire'],
  city: ['beneficiary city', 'ville du bénéficiaire'],
  country: ['beneficiary country', 'pays du bénéficiaire'],
  relationship: ['your relationship with the beneficiary', 'votre lien avec le bénéficiaire'],
  purpose: ['purpose of the transfer', 'motif du transfert'],
  accuracyConfirmed: ['confirmation that the information is accurate', 'confirmation de l’exactitude des informations'],
};
export const fieldLabel = (f: string, lang: Lang) => pick(lang, ...(FIELD_LABEL[f] ?? [f, f]));

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const chfFmt = (n: number) => n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** CHF counter-value from a real timestamped rate. Missing or older than the limit → unknown (never assumed low). */
export function counterValue(amount: string, rate: ServerRate | undefined, now: Date, maxAgeSec: number): TravelRuleResult['chf'] {
  if (!rate || !(rate.chf > 0) || !Number.isFinite(rate.chf)) return { value: null, rate: null, asOf: null, provider: null, issue: 'missing' };
  const ageSec = (now.getTime() - new Date(rate.asOf).getTime()) / 1000;
  const base = { rate: rate.chf, asOf: rate.asOf, provider: rate.provider };
  if (rate.stale || !Number.isFinite(ageSec) || ageSec > maxAgeSec) return { ...base, value: null, issue: 'stale' };
  return { ...base, value: Math.round(Number(amount) * rate.chf * 100) / 100, issue: null };
}

/** Pure decision function (unit-tested). */
export function evaluateTravelRule(i: TravelRuleInput): TravelRuleResult {
  const { config, lang } = i;
  const t = (en: string, fr: string) => pick(lang, en, fr);
  const recipient = getAddress(i.transfer.recipient);
  const own = i.ownWallets?.find((w) => same(w.address, recipient));
  const res: TravelRuleResult = {
    category: 'undeclared',
    decision: 'allow',
    chf: { value: null, rate: null, asOf: null, provider: null, issue: null },
    aggregateChf: null,
    linkedCount: 0,
    thresholdChf: config.thresholdChf,
    enhancedRequired: false,
    missing: [],
    transmission: 'not-applicable',
    checks: [],
    reasons: [],
  };
  const reject = (id: string, label: string, detail: string) => {
    res.decision = 'reject';
    res.checks.push({ id, label, status: 'fail', detail });
    res.reasons.push(detail);
  };
  const ownOk = (w: OwnWallet) => {
    res.category = 'own';
    res.ownWallet = { label: w.label, kind: w.kind, method: w.method };
    res.checks.push({
      id: 'travel-rule',
      label: t('Recipient: your own verified wallet', 'Destinataire : votre propre wallet vérifié'),
      status: 'pass',
      detail: `${w.label} — ${w.method}`,
    });
    return res;
  };

  const d = i.declaration;
  if (!d) {
    if (own) return ownOk(own);
    reject(
      'travel-rule',
      t('Recipient information missing', 'Informations sur le destinataire manquantes'),
      t(
        'Tell us whether this is your own verified wallet or someone else’s wallet, and give the beneficiary’s details.',
        'Indiquez s’il s’agit de votre propre wallet vérifié ou du wallet de quelqu’un d’autre, et renseignez le bénéficiaire.',
      ),
    );
    return res;
  }

  if (d.kind === 'own') {
    res.category = 'own';
    if (i.ownWallets === null) {
      reject(
        'travel-rule',
        t('Own wallet could not be confirmed', 'Wallet personnel non confirmé'),
        t('The verified-wallet registry is unavailable right now: we cannot confirm this is your wallet. Try again later.', 'Le registre des wallets vérifiés est indisponible : impossible de confirmer que ce wallet est le vôtre. Réessayez plus tard.'),
      );
      return res;
    }
    if (!own) {
      reject(
        'travel-rule',
        t('Not one of your verified wallets', 'Pas un de vos wallets vérifiés'),
        t(
          'This address is not a wallet verified for you. Prove you control it first (Settings → External wallets), or choose “Someone else’s wallet”.',
          'Cette adresse n’est pas un wallet vérifié à votre nom. Prouvez d’abord que vous la contrôlez (Réglages → Wallets externes), ou choisissez « Le wallet de quelqu’un d’autre ».',
        ),
      );
      return res;
    }
    return ownOk(own);
  }

  // ── Someone else's wallet ──
  res.category = 'third-party';
  const b: Partial<BeneficiaryInput> = d.beneficiary ?? {};
  res.chf = counterValue(i.transfer.amount, i.rate, i.now, config.rateMaxAgeSec);
  const key = beneficiaryKey(String(b.name ?? ''));
  const since = i.now.getTime() - config.linkedWindowDays * 86400_000;
  const linked = i.linked.filter((o) => new Date(o.at).getTime() >= since && ((key && o.beneficiaryKey === key) || same(o.address, recipient)));
  res.linkedCount = linked.length;
  res.aggregateChf = res.chf.value === null || linked.some((o) => o.chf === null) ? null : Math.round((res.chf.value + linked.reduce((n, o) => n + (o.chf ?? 0), 0)) * 100) / 100;
  // Inclusive threshold; an unknown counter-value is treated as ≥ threshold (never assumed below).
  res.enhancedRequired = res.aggregateChf === null || res.aggregateChf >= config.thresholdChf;

  const valueDetail =
    res.chf.value === null
      ? res.chf.issue === 'stale'
        ? t(`CHF rate too old or stale (as of ${res.chf.asOf}) — treated as ≥ ${chfFmt(config.thresholdChf)} CHF`, `Cours CHF trop ancien (au ${res.chf.asOf}) — traité comme ≥ ${chfFmt(config.thresholdChf)} CHF`)
        : t(`No CHF rate available — treated as ≥ ${chfFmt(config.thresholdChf)} CHF`, `Aucun cours CHF disponible — traité comme ≥ ${chfFmt(config.thresholdChf)} CHF`)
      : t(
          `≈ ${chfFmt(res.chf.value)} CHF (${res.chf.provider}, rate ${res.chf.rate} as of ${res.chf.asOf})${linked.length ? `; with ${linked.length} linked transfer(s) in ${config.linkedWindowDays} days: ${res.aggregateChf === null ? 'unknown' : `${chfFmt(res.aggregateChf)} CHF`}` : ''}`,
          `≈ ${chfFmt(res.chf.value)} CHF (${res.chf.provider}, cours ${res.chf.rate} au ${res.chf.asOf})${linked.length ? ` ; avec ${linked.length} transfert(s) lié(s) sur ${config.linkedWindowDays} jours : ${res.aggregateChf === null ? 'inconnu' : `${chfFmt(res.aggregateChf)} CHF`}` : ''}`,
        );
  res.checks.push({
    id: 'travel-rule-value',
    label: res.enhancedRequired
      ? t(`Counter-value ≥ ${chfFmt(config.thresholdChf)} CHF: enhanced beneficiary information`, `Contre-valeur ≥ ${chfFmt(config.thresholdChf)} CHF : informations renforcées sur le bénéficiaire`)
      : t(`Counter-value below ${chfFmt(config.thresholdChf)} CHF`, `Contre-valeur inférieure à ${chfFmt(config.thresholdChf)} CHF`),
    status: res.enhancedRequired ? 'step-up' : 'pass',
    detail: valueDetail,
  });

  res.missing = missingBeneficiaryFields(b, res.enhancedRequired);
  if (res.missing.length) {
    reject(
      'travel-rule-beneficiary',
      t('Beneficiary information incomplete', 'Informations sur le bénéficiaire incomplètes'),
      t(`Missing: ${res.missing.map((f) => fieldLabel(f, lang)).join(', ')}.`, `Manquant : ${res.missing.map((f) => fieldLabel(f, lang)).join(', ')}.`),
    );
  } else {
    res.checks.push({ id: 'travel-rule-beneficiary', label: t('Beneficiary information provided', 'Informations sur le bénéficiaire fournies'), status: 'pass', detail: t('Collected by Swissquote — not verified, and not by itself proof of compliance.', 'Collectées par Swissquote — non vérifiées, et pas à elles seules une preuve de conformité.') });
  }

  if (res.decision === 'reject') return res;

  // Transmission obligation (no threshold in Switzerland, no exception for unhosted wallets — FINMA Guidance 02/2019).
  const vasp = i.vasp ?? null;
  if (vasp) {
    // Managed by a VASP of the (simulated) Travel Rule network: transmission BEFORE co-signing (done at /tx/submit).
    res.route = 'vasp';
    res.vasp = { vaspId: vasp.vaspId, name: vasp.name };
    res.transmission = 'trp-required';
    res.checks.push({
      id: 'travel-rule-transmission',
      label: t(`Travel Rule: data sent to ${vasp.name} before co-signing`, `Travel Rule : données transmises à ${vasp.name} avant la co-signature`),
      status: 'pass',
      detail: t(
        `This address is managed by ${vasp.name}. Your details and the beneficiary’s are sent to it (IVMS101, signed message); Swissquote co-signs only once ${vasp.name} has approved.${b.walletType === 'unhosted' ? ' (You described it as a personal wallet; the Travel Rule directory says it is an account at this institution.)' : ''}`,
        `Cette adresse est gérée par ${vasp.name}. Vos informations et celles du bénéficiaire lui sont transmises (IVMS101, message signé) ; Swissquote ne co-signe qu’après l’approbation de ${vasp.name}.${b.walletType === 'unhosted' ? ' (Vous l’avez décrite comme un wallet personnel ; l’annuaire Travel Rule indique un compte auprès de cet établissement.)' : ''}`,
      ),
    });
    return res;
  }
  if (b.walletType === 'hosted') {
    res.transmission = 'trp-unreachable';
    reject(
      'travel-rule-transmission',
      t('Receiving institution not reachable (Travel Rule)', 'Établissement bénéficiaire injoignable (Travel Rule)'),
      t(
        `${b.providerName ? `“${b.providerName}”` : 'This institution'} is not reachable on the Travel Rule network for this address, so the required information cannot be transmitted. Ask the beneficiary for a deposit address of a connected institution, or for their personal wallet.`,
        `${b.providerName ? `« ${b.providerName} »` : 'Cet établissement'} n’est pas joignable sur le réseau Travel Rule pour cette adresse : les informations requises ne peuvent pas être transmises. Demandez au bénéficiaire une adresse de dépôt d’un établissement connecté, ou son wallet personnel.`,
      ),
    );
    return res;
  }
  // Personal (unhosted) wallet of a third party.
  const proof = i.ownership ?? { status: 'absent' as const };
  if (proof.status === 'valid') {
    res.route = 'self-hosted-proof';
    res.transmission = 'ownership-proof';
    res.checks.push({
      id: 'travel-rule-ownership',
      label: t('Beneficiary proved control of this wallet', 'Le bénéficiaire a prouvé contrôler ce wallet'),
      status: 'pass',
      detail: t('Message signed with this address (EIP-191), verified by Swissquote. Not a proof of identity.', 'Message signé avec cette adresse (EIP-191), vérifié par Swissquote. Ce n’est pas une preuve d’identité.'),
    });
    return res;
  }
  if (proof.status === 'invalid') {
    res.transmission = 'proof-required';
    reject('travel-rule-ownership', t('Ownership proof not valid', 'Preuve de propriété non valable'), proof.detail ? t(proof.detail[0], proof.detail[1]) : t('The signed message could not be verified.', 'Le message signé n’a pas pu être vérifié.'));
    return res;
  }
  if (!res.enhancedRequired && b.declaresOwnership === true) {
    res.route = 'self-hosted-declaration';
    res.transmission = 'client-declaration';
    res.checks.push({
      id: 'travel-rule-ownership',
      label: t('Personal wallet — your declaration', 'Wallet personnel — votre déclaration'),
      status: 'pass',
      detail: t(
        `Below ${chfFmt(config.thresholdChf)} CHF (linked transfers included): you declared that this personal wallet belongs to the beneficiary. Not verified by Swissquote.`,
        `Sous ${chfFmt(config.thresholdChf)} CHF (transferts liés compris) : vous avez déclaré que ce wallet personnel appartient au bénéficiaire. Non vérifié par Swissquote.`,
      ),
    });
    return res;
  }
  res.transmission = 'proof-required';
  reject(
    'travel-rule-ownership',
    t('Proof of wallet ownership required', 'Preuve de propriété du wallet requise'),
    res.enhancedRequired
      ? t(
          `From ${chfFmt(config.thresholdChf)} CHF (alone, with linked transfers, or when the value is unknown) the beneficiary must prove they control this personal wallet by signing a message with it.`,
          `Dès ${chfFmt(config.thresholdChf)} CHF (seul, avec les transferts liés, ou si la valeur est inconnue), le bénéficiaire doit prouver qu’il contrôle ce wallet personnel en signant un message avec celui-ci.`,
        )
      : t(
          'Ask the beneficiary to prove they control this personal wallet (signed message), or declare that it belongs to them.',
          'Demandez au bénéficiaire de prouver qu’il contrôle ce wallet personnel (message signé), ou déclarez qu’il lui appartient.',
        ),
  );
  return res;
}

/** Applies a result to the co-signer's policy result (a reject is a hard refusal). */
export function mergeIntoPolicy(policy: PolicyResult, r: TravelRuleResult) {
  policy.checks.push(...r.checks);
  if (r.decision === 'reject') {
    policy.decision = 'reject';
    if (r.reasonsFr) policy.reasonsFr = [...(policy.reasonsFr ?? policy.reasons), ...r.reasonsFr];
    policy.reasons.push(...r.reasons);
  }
}

// ─────────────── Records (client record, personal data) and audit (no personal data) ───────────────

export type TravelRuleRecordStatus = 'prepared' | 'submitted';
export interface TravelRuleRecord {
  id: string;
  previewId: string;
  requestId?: string;
  createdAt: string;
  retainUntil: string;
  recipient: string;
  asset: 'ETH' | 'USDC';
  amount: string;
  chf: number | null;
  category: TravelRuleResult['category'];
  declaration?: TransferDeclaration;
  beneficiaryKey?: string;
  status: TravelRuleRecordStatus;
  ruleVersion: string;
  /** Legacy records (before #9): collected in demo mode, not transmitted. */
  demo?: boolean;
  /** #9 — how the Travel Rule was satisfied for a third party. */
  route?: TravelRuleRoute;
  vasp?: { vaspId: string; name: string };
  /** #9 — outcome of the TRP transmission (no personal data in this sub-object). */
  trp?: TrpOutcome;
  /** #9 — ownership proof of a personal wallet (method + time; the signed text stays in the declaration). */
  ownership?: { method: 'eip191-signature' | 'client-declaration'; at: string };
}

/** Outcome of a Travel Rule transmission to the beneficiary VASP (stored, shown to the client and the console). */
export interface TrpOutcome {
  status: 'approved' | 'rejected' | 'error';
  requestIdentifier: string;
  vaspId: string;
  vaspName: string;
  transmittedAt: string;
  decidedAt?: string;
  /** Reference given by the beneficiary VASP when it approved. */
  reference?: string;
  reasonCode?: string;
  /** The answer's Ed25519 signature was verified with the VASP's pinned key and bound to our inquiry. */
  responseVerified: boolean;
  /** sha256 of the exact IVMS101 inquiry sent (proof of what was transmitted, without the data itself). */
  inquiryDigest: string;
}

export interface TravelRuleAudit {
  id: string;
  at: string;
  stage: 'prepare' | 'submit' | 'transmit';
  clientId: string; // pseudonymous client number, no name
  previewId: string;
  requestId?: string;
  ruleVersion: string;
  thresholdChf: number;
  category: TravelRuleResult['category'];
  chfValue: number | null;
  rate: { chf: number; asOf: string; provider: string } | null;
  rateIssue: TravelRuleResult['chf']['issue'];
  aggregateChf: number | null;
  linkedCount: number;
  enhancedRequired: boolean;
  missingFields: string[];
  walletType?: string;
  transmission: TravelRuleResult['transmission'];
  /** Legacy entries only. */
  demo?: boolean;
  route?: TravelRuleRoute;
  vaspId?: string;
  /** #9 — TRP outcome (status, reference, reason code) — no personal data. */
  trp?: { status: TrpOutcome['status']; reference?: string; reasonCode?: string; requestIdentifier: string; responseVerified: boolean };
  decision: TravelRuleResult['decision'];
}

export function auditEntry(stage: 'prepare' | 'submit' | 'transmit', clientId: string, previewId: string, r: TravelRuleResult, config: TravelRuleConfig, declaration?: TransferDeclaration): TravelRuleAudit {
  return {
    id: newId(),
    at: nowIso(),
    stage,
    clientId,
    previewId,
    ruleVersion: config.version,
    thresholdChf: config.thresholdChf,
    category: r.category,
    chfValue: r.chf.value,
    rate: r.chf.rate === null ? null : { chf: r.chf.rate, asOf: r.chf.asOf!, provider: r.chf.provider! },
    rateIssue: r.chf.issue,
    aggregateChf: r.aggregateChf,
    linkedCount: r.linkedCount,
    enhancedRequired: r.enhancedRequired,
    missingFields: r.missing,
    walletType: declaration?.kind === 'third-party' ? declaration.beneficiary?.walletType : undefined,
    transmission: r.transmission,
    route: r.route,
    vaspId: r.vasp?.vaspId,
    decision: r.decision,
  };
}

/** Only the fields we accept — anything else sent by the client is dropped (no free-form blobs stored). */
export function sanitizeDeclaration(raw: unknown): TransferDeclaration | undefined {
  const d = raw as any;
  if (!d || typeof d !== 'object') return undefined;
  if (d.kind === 'own') return { kind: 'own' };
  if (d.kind !== 'third-party') return undefined;
  const s = (v: unknown, max = 140) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
  const b = d.beneficiary ?? {};
  return {
    kind: 'third-party',
    beneficiary: {
      name: s(b.name) ?? '',
      walletType: b.walletType === 'hosted' || b.walletType === 'unhosted' ? b.walletType : (undefined as any),
      providerName: s(b.providerName),
      street: s(b.street),
      postcode: s(b.postcode, 16),
      city: s(b.city),
      country: s(b.country, 2)?.toUpperCase(),
      relationship: s(b.relationship, 60),
      purpose: s(b.purpose, 200),
      accuracyConfirmed: b.accuracyConfirmed === true,
      ...(b.ownershipProof && typeof b.ownershipProof.message === 'string' && typeof b.ownershipProof.signature === 'string' && b.ownershipProof.message.length <= 1000 && /^0x[0-9a-fA-F]{130}$/.test(b.ownershipProof.signature)
        ? { ownershipProof: { message: b.ownershipProof.message, signature: b.ownershipProof.signature } }
        : {}),
      ...(b.declaresOwnership === true ? { declaresOwnership: true } : {}),
    },
  };
}

/** Linked operations from the client's records: submitted third-party transfers whose request did not fail. */
export function linkedOpsOf(records: TravelRuleRecord[], requestStatus: (id: string) => string | undefined): LinkedOp[] {
  return records
    .filter((r) => r.category === 'third-party' && r.status === 'submitted' && r.requestId && !['rejected', 'failed', 'cancelled'].includes(requestStatus(r.requestId) ?? ''))
    .map((r) => ({ at: r.createdAt, chf: r.chf, beneficiaryKey: r.beneficiaryKey ?? '', address: r.recipient }));
}

/** Own wallets from sq-bank (the KYC / verified-wallet registry), service-to-service call. 404 → none; unreachable/refused → null. */
export async function fetchOwnWallets(clientId: string, safeAddress: string | undefined, headers: Record<string, string>, bankUrl = process.env.BANK_URL ?? 'http://localhost:4003'): Promise<OwnWallet[] | null> {
  try {
    const res = await fetch(`${bankUrl}/clients/${encodeURIComponent(clientId)}`, { headers, signal: AbortSignal.timeout(6000) });
    if (res.status === 404) return [];
    if (!res.ok) return null;
    const j = (await res.json()) as { treasury?: string; verifiedWallets?: { address: string; label?: string; method?: string; verifiedAt?: string; kind?: string }[] };
    const out: OwnWallet[] = [];
    if (j.treasury) out.push({ address: getAddress(j.treasury), label: 'Swissquote account', kind: 'swissquote-account', method: 'Your Swissquote account (credited by Swissquote on receipt)' });
    for (const w of j.verifiedWallets ?? []) {
      if (safeAddress && same(w.address, safeAddress)) continue;
      out.push({ address: getAddress(w.address), label: w.label ?? 'External wallet', kind: w.kind === 'external' ? 'external' : 'my-wall', method: w.method ?? 'verified', verifiedAt: w.verifiedAt });
    }
    return out;
  } catch {
    return null;
  }
}

// ─────────────── #9 — Ownership proof of a third party's personal wallet (EIP-191) ───────────────

export interface OwnershipChallengeRecord {
  nonce: string;
  address: string;
  nameKey: string;
  issuedAt: string;
}

/**
 * Verifies the beneficiary's signed message: issued by us for THIS client (nonce), for THIS address and beneficiary
 * name, not older than the limit, and signed by the recipient address itself (EIP-191, ethers.verifyMessage).
 */
export function verifyOwnershipProof(
  proof: { message: string; signature: string } | undefined,
  recipient: string,
  beneficiaryName: string,
  challenges: OwnershipChallengeRecord[],
  now: Date,
  maxAgeSec: number,
): NonNullable<TravelRuleInput['ownership']> {
  if (!proof) return { status: 'absent' };
  const bad = (en: string, fr: string) => ({ status: 'invalid' as const, detail: [en, fr] as [string, string] });
  const c = parseOwnershipProofMessage(proof.message);
  if (!c) return bad('The signed text is not the message Swissquote issued (it was altered).', 'Le texte signé n’est pas le message émis par Swissquote (il a été modifié).');
  const ch = challenges.find((x) => x.nonce === c.nonce);
  if (!ch || ch.issuedAt !== c.issuedAt) return bad('This proof was not requested from your account. Request a new message to sign.', 'Cette preuve n’a pas été demandée depuis votre compte. Demandez un nouveau message à signer.');
  if (!same(ch.address, recipient) || !same(c.address, recipient)) return bad('The proof is for another address than the recipient.', 'La preuve concerne une autre adresse que le destinataire.');
  if (ch.nameKey !== beneficiaryKey(beneficiaryName) || beneficiaryKey(c.name) !== ch.nameKey) return bad('The proof names another beneficiary.', 'La preuve désigne un autre bénéficiaire.');
  if (now.getTime() - new Date(ch.issuedAt).getTime() > maxAgeSec * 1000) return bad('The proof has expired. Request a new message to sign.', 'La preuve a expiré. Demandez un nouveau message à signer.');
  let signer: string;
  try {
    signer = verifyMessage(proof.message, proof.signature);
  } catch {
    return bad('The signature is malformed.', 'La signature est mal formée.');
  }
  if (!same(signer, recipient)) return bad('The message was not signed by the recipient address.', 'Le message n’a pas été signé par l’adresse du destinataire.');
  return { status: 'valid' };
}

// ─────────────── #9 — Originator (our KYC'd client) as an IVMS101 person ───────────────

/**
 * Originator data from sq-bank (the KYC registry): legal name, address, customer number. Data minimisation: no ID
 * document number or date of birth (IVMS101 needs only one of address / customer id / national id / birth data).
 * Bank unreachable → null (fail safe: nothing is transmitted). A scripted (headless) demo client unknown to the bank
 * → name + customer number from the co-signer record. Prototype assumption: KYC addresses are in Switzerland.
 */
export async function fetchOriginator(
  client: { clientId: string; name: string; headless?: boolean },
  headers: Record<string, string>,
  bankUrl = process.env.BANK_URL ?? 'http://localhost:4003',
): Promise<Person | null> {
  try {
    const res = await fetch(`${bankUrl}/clients/${encodeURIComponent(client.clientId)}`, { headers, signal: AbortSignal.timeout(6000) });
    if (res.status === 404) return client.headless ? personFromName(client.name, { customerIdentification: client.clientId }) : null;
    if (!res.ok) return null;
    const j = (await res.json()) as { firstName?: string; lastName?: string; name?: string; kyc?: { address?: string; addressCountry?: string } };
    const name = j.firstName && j.lastName ? `${j.firstName} ${j.lastName}` : j.name;
    if (!name) return null;
    const p = personFromName(name, { customerIdentification: client.clientId, ...(j.kyc?.address ? { address: addressFromLine(j.kyc.address, j.kyc.addressCountry ?? 'CH') } : {}) });
    if ('naturalPerson' in p && j.firstName && j.lastName)
      p.naturalPerson.name.nameIdentifier = [{ primaryIdentifier: j.lastName, secondaryIdentifier: j.firstName, nameIdentifierType: 'LEGL' }];
    return p;
  } catch {
    return null;
  }
}
