// Wiring of the Travel Rule policy (travelRule.ts) into the co-signer: /tx/prepare and /tx/submit hooks, records in
// the client record, audit trail without personal data, and the read endpoints (client + compliance console).

import type { Express, Request, RequestHandler } from 'express';
import { decodeSafeTx, TRAVEL_RULE, type DecodedAction, type PolicyResult, type SafeTx } from '@sq/shared';
import { fetchWalletRates, internalHeaders, newId, nowIso } from '@sq/shared/server';
import { db, getClient, type Client } from './db';
import {
  auditEntry,
  evaluateTravelRule,
  fetchOwnWallets,
  linkedOpsOf,
  mergeIntoPolicy,
  sanitizeDeclaration,
  travelRuleConfig,
  type TravelRuleAudit,
  type TravelRuleRecord,
  type TravelRuleResult,
} from './travelRule';
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
  demo?: boolean;
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
  const input = {
    config,
    now: new Date(),
    transfer,
    declaration,
    ownWallets,
    rate: rates[transfer.asset],
    linked: linkedOpsOf(recordsOf(c), (id) => db.data.txRequests[id]?.status),
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
      demo: result.demo,
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
    demo: r.result.demo,
  };
  db.update((d) => {
    const cl = d.clients[clientId];
    cl.travelRule ??= { records: [] };
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
      return { ...c, linkedAggregation: TRAVEL_RULE.linkedAggregation };
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
