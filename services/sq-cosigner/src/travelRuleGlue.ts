// Wiring of the Travel Rule policy (travelRule.ts) into the co-signer: /tx/prepare and /tx/submit hooks, the TRP
// transmission before co-signing (#9), the co-signature gate, records in the client record, audit trail without
// personal data, and the read endpoints (client + compliance console).

import type { Express, Request, RequestHandler } from 'express';
import { getAddress, hexlify, randomBytes } from 'ethers';
import { decodeSafeTx, ownershipProofMessage, SWISSQUOTE_VASP, TRAVEL_RULE, TRP, VASP_DIRECTORY, VASPS, vaspForAddress, type DecodedAction, type PolicyResult, type SafeTx } from '@sq/shared';
import { fetchWalletRates, internalHeaders, newId, nowIso, t } from '@sq/shared/server';
import { db, getClient, HttpError, type Client, type TxRequest } from './db';
import {
  auditEntry,
  evaluateTravelRule,
  fetchOriginator,
  fetchOwnWallets,
  linkedOpsOf,
  mergeIntoPolicy,
  sanitizeDeclaration,
  travelRuleConfig,
  verifyOwnershipProof,
  type OwnershipChallengeRecord,
  type TravelRuleAudit,
  type TravelRuleRecord,
  type TravelRuleResult,
  type TrpOutcome,
} from './travelRule';
import { buildInquiry, buildIvms101, swissquoteVaspKey, transmitInquiry, type TransmitDeps } from './trpClient';
import { beneficiaryKey } from '@sq/shared';

type Route = (fn: (req: Request) => unknown) => RequestHandler;

const transferOf = (safeTx: SafeTx, safeAddress: string): { asset: 'ETH' | 'USDC'; amount: string; recipient: string } | null => {
  const d: DecodedAction = decodeSafeTx(safeTx, safeAddress);
  if (d.kind === 'erc20-transfer' && d.token === 'USDC' && d.recipient) return { asset: 'USDC', amount: d.amount ?? '0', recipient: d.recipient };
  if (d.kind === 'eth-transfer' && d.recipient) return { asset: 'ETH', amount: d.amount ?? '0', recipient: d.recipient };
  return null;
};

const recordsOf = (c: Client): TravelRuleRecord[] => c.travelRule?.records ?? [];

function audit(e: TravelRuleAudit) {
  db.update((d) => {
    d.travelRuleAudit ??= [];
    d.travelRuleAudit.push(e);
    if (d.travelRuleAudit.length > 5000) d.travelRuleAudit.splice(0, d.travelRuleAudit.length - 5000);
  });
}

export interface TravelRuleView {
  applies: boolean;
  category?: TravelRuleResult['category'];
  decision?: TravelRuleResult['decision'];
  route?: TravelRuleResult['route'];
  vasp?: TravelRuleResult['vasp'];
  chf?: TravelRuleResult['chf'];
  aggregateChf?: number | null;
  thresholdChf?: number;
  enhancedRequired?: boolean;
  missing?: string[];
  transmission?: TravelRuleResult['transmission'];
  ownWallet?: TravelRuleResult['ownWallet'];
  ruleVersion: string;
}

/**
 * Evaluates the Travel Rule for a transfer and merges it into the policy result.
 * stage 'prepare': the declaration comes from the request body and is stored (bound to the preview).
 * stage 'submit': the declaration is the one bound to the preview — the request body cannot change it — and
 * everything (rate, counter-value, linked operations, own-wallet registry) is recomputed before co-signing.
 */
export async function applyTravelRule(opts: { req: Request; c: Client; safeTx: SafeTx; policy: PolicyResult; stage: 'prepare' | 'submit'; previewId?: string; rawDeclaration?: unknown }): Promise<{ view: TravelRuleView; result?: TravelRuleResult; declaration?: ReturnType<typeof sanitizeDeclaration> }> {
  const { c, safeTx, policy, stage } = opts;
  const config = travelRuleConfig();
  const transfer = transferOf(safeTx, c.safeAddress!);
  if (!transfer) return { view: { applies: false, ruleVersion: config.version } };
  const declaration =
    stage === 'prepare' ? sanitizeDeclaration(opts.rawDeclaration) : recordsOf(c).find((r) => r.previewId === opts.previewId)?.declaration;
  const [ownWallets, rates] = await Promise.all([fetchOwnWallets(c.clientId, c.safeAddress, internalHeaders()), fetchWalletRates()]);
  const now = new Date();
  const ben = declaration?.kind === 'third-party' ? declaration.beneficiary : undefined;
  const input = {
    config,
    now,
    transfer,
    declaration,
    ownWallets,
    rate: rates[transfer.asset],
    linked: linkedOpsOf(recordsOf(c), (id) => db.data.txRequests[id]?.status),
    vasp: vaspForAddress(transfer.recipient), // #9 Travel Rule directory (simulated)
    ownership: verifyOwnershipProof(ben?.ownershipProof, transfer.recipient, ben?.name ?? '', c.travelRule?.challenges ?? [], now, config.ownershipProofMaxAgeSec),
  };
  // Checks are stored with the request: English text + French twin (localised when read, see localizeDeep).
  const result = withFrenchTwins(evaluateTravelRule({ ...input, lang: 'en' }), evaluateTravelRule({ ...input, lang: 'fr' }));
  mergeIntoPolicy(policy, result);
  if (opts.previewId) audit(auditEntry(stage, c.clientId, opts.previewId, result, config, declaration));
  return {
    result,
    declaration,
    view: {
      applies: true,
      category: result.category,
      decision: result.decision,
      route: result.route,
      vasp: result.vasp,
      chf: result.chf,
      aggregateChf: result.aggregateChf,
      thresholdChf: result.thresholdChf,
      enhancedRequired: result.enhancedRequired,
      missing: result.missing,
      transmission: result.transmission,
      ownWallet: result.ownWallet,
      ruleVersion: config.version,
    },
  };
}

/** English result whose checks/reasons carry the French twins of the same evaluation in French. */
function withFrenchTwins(en: TravelRuleResult, fr: TravelRuleResult): TravelRuleResult {
  return {
    ...en,
    checks: en.checks.map((c, i) => ({ ...c, labelFr: fr.checks[i]?.label ?? c.label, ...(c.detail !== undefined ? { detailFr: fr.checks[i]?.detail ?? c.detail } : {}) })),
    reasonsFr: en.reasons.map((r, i) => fr.reasons[i] ?? r),
  };
}

/** After /tx/prepare created the preview: keep the declaration (client record only) bound to that preview. */
export function recordPrepared(clientId: string, previewId: string, safeTx: SafeTx, r: Awaited<ReturnType<typeof applyTravelRule>>) {
  if (!r.result) return;
  const c = getClient(clientId);
  const transfer = transferOf(safeTx, c.safeAddress!)!;
  const config = travelRuleConfig();
  const retain = new Date();
  retain.setUTCFullYear(retain.getUTCFullYear() + config.retentionYears);
  const rec: TravelRuleRecord = {
    id: newId(),
    previewId,
    createdAt: nowIso(),
    retainUntil: retain.toISOString(),
    recipient: transfer.recipient,
    asset: transfer.asset,
    amount: transfer.amount,
    chf: r.result.chf.value,
    category: r.result.category,
    declaration: r.declaration,
    beneficiaryKey: r.declaration?.kind === 'third-party' ? beneficiaryKey(r.declaration.beneficiary.name ?? '') : undefined,
    status: 'prepared',
    ruleVersion: config.version,
    route: r.result.route,
    vasp: r.result.vasp,
    ...(r.result.route === 'self-hosted-proof' ? { ownership: { method: 'eip191-signature' as const, at: nowIso() } } : r.result.route === 'self-hosted-declaration' ? { ownership: { method: 'client-declaration' as const, at: nowIso() } } : {}),
  };
  db.update((d) => {
    const cl = d.clients[clientId];
    cl.travelRule ??= { records: [] };
    cl.travelRule.records ??= [];
    // unused previews' records are pruned after a day (they never led to a transfer)
    cl.travelRule.records = cl.travelRule.records.filter((x) => x.status !== 'prepared' || Date.now() - new Date(x.createdAt).getTime() < 86400_000);
    cl.travelRule.records.push(rec);
  });
  audit(auditEntry('prepare', clientId, previewId, r.result, config, r.declaration));
}

/** After /tx/submit accepted the operation (executed or step-up): it now counts for linked operations. */
export function recordSubmitted(clientId: string, previewId: string, requestId: string, chf: number | null | undefined) {
  db.update((d) => {
    const rec = d.clients[clientId]?.travelRule?.records.find((x) => x.previewId === previewId);
    if (!rec) return;
    rec.status = 'submitted';
    rec.requestId = requestId;
    if (chf !== undefined) rec.chf = chf;
  });
  const a = db.data.travelRuleAudit?.slice().reverse().find((x) => x.previewId === previewId && x.stage === 'submit');
  if (a) db.update(() => (a.requestId = requestId));
}

export function registerTravelRuleRoutes(app: Express, route: Route) {
  /** Public policy parameters (no personal data) — the send form uses them. */
  app.get(
    '/clients/:id/travel-rule/config',
    route(() => {
      const c = travelRuleConfig();
      // #9: public Travel Rule directory (deposit address → VASP name). No customer names.
      const directory = Object.fromEntries(Object.entries(VASP_DIRECTORY).map(([a, id]) => [getAddress(a), { vaspId: id, name: VASPS[id]?.name ?? id }]));
      return { ...c, linkedAggregation: TRAVEL_RULE.linkedAggregation, directory };
    }),
  );

  /** #9 — Message the beneficiary of a personal wallet signs to prove control of the address (EIP-191). */
  app.post(
    '/clients/:id/travel-rule/ownership-challenge',
    route((req) => {
      const c = getClient(String(req.params.id));
      const { address, name } = req.body as { address?: string; name?: string };
      let addr: string;
      try {
        addr = getAddress(String(address ?? ''));
      } catch {
        throw new HttpError(400, t('Enter the recipient address first.', 'Saisissez d’abord l’adresse du destinataire.'));
      }
      const clean = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 140);
      if (clean.length < 2 || !/\s/.test(clean)) throw new HttpError(400, t('Enter the beneficiary’s full name first.', 'Saisissez d’abord le nom complet du bénéficiaire.'));
      if (/[\n\r]/.test(String(name))) throw new HttpError(400, t('Invalid name.', 'Nom invalide.'));
      const ch: OwnershipChallengeRecord = { nonce: hexlify(randomBytes(16)).slice(2), address: addr, nameKey: beneficiaryKey(clean), issuedAt: nowIso() };
      const maxAge = travelRuleConfig().ownershipProofMaxAgeSec * 1000;
      db.update((d) => {
        const cl = d.clients[c.clientId];
        cl.travelRule ??= { records: [] };
        cl.travelRule.challenges = [...(cl.travelRule.challenges ?? []).filter((x) => Date.now() - new Date(x.issuedAt).getTime() < maxAge), ch].slice(-20);
      });
      return { message: ownershipProofMessage({ address: addr, name: clean, nonce: ch.nonce, issuedAt: ch.issuedAt }), expiresAt: new Date(Date.parse(ch.issuedAt) + maxAge).toISOString() };
    }),
  );

  /** The client's own beneficiary records (personal data: only for this authenticated client). */
  app.get(
    '/clients/:id/travel-rule/records',
    route((req) => {
      const c = getClient(String(req.params.id));
      return recordsOf(c).filter((r) => r.status === 'submitted').map((r) => ({ ...r, requestStatus: r.requestId ? db.data.txRequests[r.requestId]?.status : undefined }));
    }),
  );

  /** Compliance console (MOCK back-office): beneficiary records of submitted third-party transfers + audit trail. */
  app.get(
    '/admin/travel-rule',
    route(() => {
      const records = Object.values(db.data.clients).flatMap((c) =>
        recordsOf(c)
          .filter((r) => r.status === 'submitted' && r.category === 'third-party')
          .map((r) => ({ clientId: c.clientId, clientName: c.name, ...r, requestStatus: r.requestId ? db.data.txRequests[r.requestId]?.status : undefined })),
      );
      return { config: travelRuleConfig(), records: records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200), audit: (db.data.travelRuleAudit ?? []).slice(-300).reverse() };
    }),
  );

}

// ─────────────── #9 — TRP transmission before co-signing, and the co-signature gate ───────────────

/**
 * At /tx/submit, once the client's verification and device signature are checked and before any co-signature:
 * a transfer to an address managed by a VASP is transmitted (signed IVMS101). Only a verified "approved" keeps the
 * operation going; rejected / unreachable / unverifiable → hard refusal. Nothing is sent when the policy already
 * refuses the operation. The outcome (no personal data) is stored on the record and in the audit trail.
 */
export async function transmitTravelRule(opts: { c: Client; previewId: string; tr: Awaited<ReturnType<typeof applyTravelRule>>; policy: PolicyResult; deps?: TransmitDeps & { originator?: Awaited<ReturnType<typeof fetchOriginator>> } }): Promise<TrpOutcome | null> {
  const { c, tr, policy } = opts;
  const r = tr.result;
  if (!r || r.route !== 'vasp' || policy.decision === 'reject' || tr.declaration?.kind !== 'third-party') return null;
  const vasp = VASPS[r.vasp!.vaspId];
  const transfer = recordsOf(c).find((x) => x.previewId === opts.previewId);
  const fail = (id: string, en: [string, string], detail: [string, string]) => {
    const i = policy.checks.findIndex((x) => x.id === 'travel-rule-transmission');
    const check = { id, label: en[0], labelFr: en[1], status: 'fail' as const, detail: detail[0], detailFr: detail[1] };
    if (i >= 0) policy.checks[i] = check;
    else policy.checks.push(check);
    policy.decision = 'reject';
    policy.reasons.push(detail[0]);
    policy.reasonsFr = [...(policy.reasonsFr ?? []), detail[1]];
  };
  if (!vasp || !transfer) {
    fail('travel-rule-transmission', ['Travel Rule transmission impossible', 'Transmission Travel Rule impossible'], ['The receiving institution is not configured.', 'L’établissement bénéficiaire n’est pas configuré.']);
    return null;
  }
  const originator = opts.deps && 'originator' in opts.deps ? opts.deps.originator : await fetchOriginator(c, internalHeaders());
  if (!originator) {
    fail('travel-rule-transmission', ['Travel Rule: your details are unavailable', 'Travel Rule : vos informations sont indisponibles'], [
      'Your verified identity could not be read from Swissquote’s records right now, so nothing was transmitted. Try again later.',
      'Votre identité vérifiée n’a pas pu être lue dans les registres Swissquote : rien n’a été transmis. Réessayez plus tard.',
    ]);
    return null;
  }
  const ivms101 = buildIvms101({ originator, safeAddress: c.safeAddress!, beneficiary: tr.declaration.beneficiary, recipient: transfer.recipient, vasp });
  const inquiry = buildInquiry({ ivms101, vasp, asset: transfer.asset, amount: transfer.amount, recipient: transfer.recipient });
  const outcome = await transmitInquiry(inquiry, vasp, opts.deps);
  db.update((d) => {
    const rec = d.clients[c.clientId]?.travelRule?.records.find((x) => x.previewId === opts.previewId);
    if (rec) rec.trp = outcome;
  });
  const config = travelRuleConfig();
  audit({
    ...auditEntry('transmit', c.clientId, opts.previewId, r, config, tr.declaration),
    decision: outcome.status === 'approved' ? 'allow' : 'reject',
    trp: { status: outcome.status, reference: outcome.reference, reasonCode: outcome.reasonCode, requestIdentifier: outcome.requestIdentifier, responseVerified: outcome.responseVerified },
  });
  if (outcome.status === 'approved') {
    const i = policy.checks.findIndex((x) => x.id === 'travel-rule-transmission');
    const check = {
      id: 'travel-rule-transmission',
      label: `Travel Rule: transmitted to ${vasp.name} — approved`,
      labelFr: `Travel Rule : transmis à ${vasp.name} — approuvé`,
      status: 'pass' as const,
      detail: `Reference ${outcome.reference}. The answer is signed by ${vasp.name} and was verified.`,
      detailFr: `Référence ${outcome.reference}. La réponse est signée par ${vasp.name} et a été vérifiée.`,
    };
    if (i >= 0) policy.checks[i] = check;
    else policy.checks.push(check);
  } else if (outcome.status === 'rejected') {
    const nameMismatch = outcome.reasonCode === 'beneficiary-name-mismatch';
    fail('travel-rule-transmission', [`Travel Rule: refused by ${vasp.name}`, `Travel Rule : refusé par ${vasp.name}`], nameMismatch
      ? [`${vasp.name} says the beneficiary’s name does not match the holder of this account. Check the name (as on their ID) and try again.`, `${vasp.name} indique que le nom du bénéficiaire ne correspond pas au titulaire de ce compte. Vérifiez le nom (comme sur sa pièce d’identité) et réessayez.`]
      : [`${vasp.name} refused the transfer (${outcome.reasonCode}). Nothing was co-signed.`, `${vasp.name} a refusé le transfert (${outcome.reasonCode}). Rien n’a été co-signé.`]);
  } else {
    fail('travel-rule-transmission', ['Travel Rule: no valid answer', 'Travel Rule : pas de réponse valable'], [
      `${vasp.name} could not be reached or its answer could not be verified (${outcome.reasonCode}). Nothing was co-signed; try again later.`,
      `${vasp.name} n’a pas pu être joint ou sa réponse n’a pas pu être vérifiée (${outcome.reasonCode}). Rien n’a été co-signé ; réessayez plus tard.`,
    ]);
  }
  return outcome;
}

/**
 * Gate right before K2 signs (execute): a transfer routed to a VASP needs a verified "approved" on its record.
 * Defence in depth — /tx/submit already refused otherwise.
 */
export function assertTravelRuleCleared(r: Pick<TxRequest, 'clientId' | 'id'>) {
  const rec = db.data.clients[r.clientId]?.travelRule?.records.find((x) => x.requestId === r.id);
  if (rec?.route === 'vasp' && !(rec.trp?.status === 'approved' && rec.trp.responseVerified))
    throw new HttpError(403, t('Travel Rule: the receiving institution has not approved this transfer — Swissquote does not co-sign.', 'Travel Rule : l’établissement bénéficiaire n’a pas approuvé ce transfert — Swissquote ne co-signe pas.'));
}

/** Travel Rule status of a transfer for its receipt and history (no personal data). */
export function travelRuleSummary(clientId: string, requestId: string | undefined) {
  if (!requestId) return undefined;
  const rec = db.data.clients[clientId]?.travelRule?.records.find((x) => x.requestId === requestId);
  if (!rec) return undefined;
  return {
    category: rec.category,
    route: rec.route,
    vaspName: rec.vasp?.name,
    status: rec.trp?.status,
    reference: rec.trp?.reference,
    transmittedAt: rec.trp?.transmittedAt,
    ownership: rec.ownership?.method,
    legacyDemo: rec.demo || undefined,
  };
}

/** Public: Swissquote's Travel Rule identity (what a network directory would publish) — counterparties pin it. */
export function registerTrpRoutes(app: Express, route: Route) {
  app.get(
    TRP.identityPath,
    route(() => {
      const k = swissquoteVaspKey();
      return { vaspId: SWISSQUOTE_VASP.vaspId, name: SWISSQUOTE_VASP.name, lei: SWISSQUOTE_VASP.lei, country: SWISSQUOTE_VASP.country, publicKeyPem: k.publicKeyPem, keyId: k.keyId, alg: 'Ed25519' };
    }),
  );
}
