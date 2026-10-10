// Travel Rule / third-party transfer policy — authoritative server-side check at /tx/prepare AND again at /tx/submit,
// before any co-signature. Sources, decisions and limits: docs/COMPLIANCE.md (NOT legal advice; to be validated by
// compliance). What this is: local collection + configurable, auditable checks. What it is NOT: a Travel Rule
// transmission integration (no TRP / OpenVASP / Notabene connection) — so real third-party transfers subject to the
// transmission obligation are BLOCKED unless the explicitly labelled demo mode is on.
//
// Personal data: beneficiary details live only in the client record (client.travelRule.records — returned to that
// client and to the compliance console, never in activity texts, notifications, logs or on-chain). Audit entries
// (db.travelRuleAudit) carry the rule version, threshold, rate + asOf and decision, WITHOUT personal data.

import { getAddress } from 'ethers';
import {
  TRAVEL_RULE,
  beneficiaryKey,
  missingBeneficiaryFields,
  pick,
  type BeneficiaryInput,
  type Lang,
  type PolicyCheck,
  type PolicyResult,
  type TransferDeclaration,
} from '@sq/shared';
import { newId, nowIso, type ServerRate } from '@sq/shared/server';

export interface TravelRuleConfig {
  version: string;
  thresholdChf: number;
  rateMaxAgeSec: number;
  linkedWindowDays: number;
  /** Demo mode: third-party transfers proceed although nothing is transmitted — always labelled "not compliant". */
  demoMode: boolean;
  transmissionIntegration: string | null;
  retentionYears: number;
}

const num = (v: string | undefined, d: number) => (v !== undefined && v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);

/** Effective configuration: shared defaults + env overrides. Demo mode defaults to ON only outside production. */
export function travelRuleConfig(env: NodeJS.ProcessEnv = process.env): TravelRuleConfig {
  const demoEnv = env.TRAVEL_RULE_DEMO_MODE;
  const demoMode = demoEnv === undefined || demoEnv === '' ? env.NODE_ENV !== 'production' : ['1', 'true', 'on', 'yes'].includes(demoEnv.toLowerCase());
  return {
    version: TRAVEL_RULE.version,
    thresholdChf: num(env.TRAVEL_RULE_THRESHOLD_CHF, TRAVEL_RULE.enhancedThresholdChf),
    rateMaxAgeSec: num(env.TRAVEL_RULE_RATE_MAX_AGE_SEC, TRAVEL_RULE.rateMaxAgeSec),
    linkedWindowDays: num(env.TRAVEL_RULE_LINKED_WINDOW_DAYS, TRAVEL_RULE.linkedWindowDays),
    demoMode,
    transmissionIntegration: TRAVEL_RULE.transmissionIntegration,
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
}

export interface TravelRuleResult {
  category: 'own' | 'third-party' | 'undeclared';
  decision: 'allow' | 'reject';
  demo: boolean;
  ownWallet?: { label: string; kind: OwnWallet['kind']; method: string };
  chf: { value: number | null; rate: number | null; asOf: string | null; provider: string | null; issue: null | 'missing' | 'stale' };
  aggregateChf: number | null;
  linkedCount: number;
  thresholdChf: number;
  enhancedRequired: boolean;
  missing: string[];
  transmission: 'not-applicable' | 'required-not-available';
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
    demo: false,
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

  // Transmission obligation (no threshold in Switzerland, no exception for unhosted wallets — FINMA Guidance 02/2019).
  // Nothing can be transmitted or verified here, so a real transfer cannot be made compliant.
  res.transmission = 'required-not-available';
  if (config.demoMode) {
    res.demo = true;
    res.checks.push({
      id: 'travel-rule-transmission',
      label: t('Demo — Travel Rule data collected but not transmitted; not compliant', 'Démo — données Travel Rule collectées mais non transmises ; non conforme'),
      status: 'step-up',
      detail:
        b.walletType === 'unhosted'
          ? t('Personal wallet of a third party: its owner’s identity and control of the address are not verified.', 'Wallet personnel d’un tiers : l’identité de son détenteur et le contrôle de l’adresse ne sont pas vérifiés.')
          : t('No connection to a Travel Rule network: nothing is sent to the receiving institution.', 'Aucune connexion à un réseau Travel Rule : rien n’est transmis à l’établissement bénéficiaire.'),
    });
  } else {
    reject(
      'travel-rule-transmission',
      t('Third-party transfer blocked (Travel Rule)', 'Transfert à un tiers bloqué (Travel Rule)'),
      t(
        'Swissquote cannot yet transmit the required originator/beneficiary information, nor verify a third party’s wallet. Transfers to someone else’s wallet are blocked; you can send to your own verified wallets.',
        'Swissquote ne peut pas encore transmettre les informations requises sur le donneur d’ordre et le bénéficiaire, ni vérifier le wallet d’un tiers. Les transferts vers le wallet de quelqu’un d’autre sont bloqués ; vous pouvez envoyer vers vos propres wallets vérifiés.',
      ),
    );
  }
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
  demo: boolean;
}

export interface TravelRuleAudit {
  id: string;
  at: string;
  stage: 'prepare' | 'submit';
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
  demo: boolean;
  decision: TravelRuleResult['decision'];
}

export function auditEntry(stage: 'prepare' | 'submit', clientId: string, previewId: string, r: TravelRuleResult, config: TravelRuleConfig, declaration?: TransferDeclaration): TravelRuleAudit {
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
    demo: r.demo,
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
