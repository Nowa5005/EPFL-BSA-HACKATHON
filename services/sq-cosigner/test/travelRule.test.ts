import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { evaluateTravelRule, linkedOpsOf, sanitizeDeclaration, travelRuleConfig, type TravelRuleInput } from '../src/travelRule';

const now = new Date('2026-10-10T12:00:00Z');
const bob = Wallet.createRandom().address;
const ext = Wallet.createRandom().address;
const rate = (chf: number, asOf = '2026-10-10T11:59:00Z', stale = false) => ({ chf, asOf, fetchedAt: asOf, stale, provider: 'CoinGecko' });
const cfg = (over: Partial<ReturnType<typeof travelRuleConfig>> = {}) => ({ ...travelRuleConfig({ NODE_ENV: 'development' } as any), ...over });
const base = (over: Partial<TravelRuleInput> = {}): TravelRuleInput => ({
  config: cfg(),
  now,
  transfer: { asset: 'USDC', amount: '100', recipient: bob },
  declaration: { kind: 'third-party', beneficiary: { name: 'Bob Example', walletType: 'unhosted' } },
  ownWallets: [],
  rate: rate(0.8),
  linked: [],
  lang: 'en',
  ...over,
});
const enhanced = { name: 'Bob Example', walletType: 'unhosted' as const, street: 'Rue 1', city: 'Lausanne', country: 'CH', relationship: 'friend', purpose: 'gift', accuracyConfirmed: true };

test('config: no demo mode any more (#9), env overrides of the threshold', () => {
  assert.equal('demoMode' in travelRuleConfig({ NODE_ENV: 'development' } as any), false);
  assert.ok(travelRuleConfig({} as any).transmissionIntegration);
  assert.equal(travelRuleConfig({ TRAVEL_RULE_THRESHOLD_CHF: '500' } as any).thresholdChf, 500);
  assert.equal(travelRuleConfig({ TRAVEL_RULE_THRESHOLD_CHF: 'abc' } as any).thresholdChf, 1000);
});

test('third party below threshold: name required even for tiny amounts; personal wallet → proof or declaration', () => {
  const noName = evaluateTravelRule(base({ declaration: { kind: 'third-party', beneficiary: { name: '', walletType: 'unhosted', declaresOwnership: true } } }));
  assert.equal(noName.decision, 'reject');
  assert.ok(noName.missing.includes('name'));
  // neither a proof nor a declaration → refused
  const bare = evaluateTravelRule(base());
  assert.equal(bare.decision, 'reject');
  assert.equal(bare.transmission, 'proof-required');
  const r = evaluateTravelRule(base({ declaration: { kind: 'third-party', beneficiary: { name: 'Bob Example', walletType: 'unhosted', declaresOwnership: true } } }));
  assert.equal(r.decision, 'allow');
  assert.equal(r.enhancedRequired, false);
  assert.equal(r.chf.value, 80);
  assert.equal(r.route, 'self-hosted-declaration');
  assert.equal(r.transmission, 'client-declaration');
  // a valid ownership proof also works
  const p = evaluateTravelRule(base({ ownership: { status: 'valid' } }));
  assert.equal(p.decision, 'allow');
  assert.equal(p.route, 'self-hosted-proof');
});

test('threshold is inclusive: exactly 1000 CHF requires the enhanced fields', () => {
  const r = evaluateTravelRule(base({ transfer: { asset: 'USDC', amount: '1250', recipient: bob } })); // 1250 × 0.8 = 1000
  assert.equal(r.chf.value, 1000);
  assert.equal(r.enhancedRequired, true);
  assert.equal(r.decision, 'reject');
  for (const f of ['street', 'city', 'country', 'relationship', 'purpose', 'accuracyConfirmed']) assert.ok(r.missing.includes(f), f);
  const ok = evaluateTravelRule(base({ transfer: { asset: 'USDC', amount: '1250', recipient: bob }, declaration: { kind: 'third-party', beneficiary: enhanced }, ownership: { status: 'valid' } }));
  assert.equal(ok.decision, 'allow');
  // ≥ threshold: the client's declaration is NOT enough for a personal wallet — the beneficiary must prove ownership
  const decl = evaluateTravelRule(base({ transfer: { asset: 'USDC', amount: '1250', recipient: bob }, declaration: { kind: 'third-party', beneficiary: { ...enhanced, declaresOwnership: true } } }));
  assert.equal(decl.decision, 'reject');
  assert.equal(decl.transmission, 'proof-required');
  const below = evaluateTravelRule(base({ transfer: { asset: 'USDC', amount: '1249.98', recipient: bob } }));
  assert.equal(below.enhancedRequired, false);
});

test('missing or stale rate → treated as ≥ threshold (never assumed below)', () => {
  const missing = evaluateTravelRule(base({ rate: undefined, transfer: { asset: 'ETH', amount: '0.0001', recipient: bob } }));
  assert.equal(missing.chf.value, null);
  assert.equal(missing.chf.issue, 'missing');
  assert.equal(missing.enhancedRequired, true);
  assert.equal(missing.decision, 'reject');
  const old = evaluateTravelRule(base({ rate: rate(0.8, '2026-10-10T10:00:00Z') }));
  assert.equal(old.chf.issue, 'stale');
  assert.equal(old.enhancedRequired, true);
  const flagged = evaluateTravelRule(base({ rate: rate(0.8, '2026-10-10T11:59:00Z', true) }));
  assert.equal(flagged.chf.issue, 'stale');
});

test('linked operations: same beneficiary (name or address) within 30 days are summed; older ones ignored', () => {
  const linked = [
    { at: '2026-09-20T10:00:00Z', chf: 600, beneficiaryKey: 'bob example', address: Wallet.createRandom().address }, // same name, other address
    { at: '2026-10-01T10:00:00Z', chf: 300, beneficiaryKey: 'someone else', address: bob }, // same address
    { at: '2026-08-01T10:00:00Z', chf: 5000, beneficiaryKey: 'bob example', address: bob }, // outside window
    { at: '2026-10-05T10:00:00Z', chf: 9000, beneficiaryKey: 'carla', address: Wallet.createRandom().address }, // unrelated
  ];
  const r = evaluateTravelRule(base({ linked })); // 80 + 600 + 300 = 980
  assert.equal(r.linkedCount, 2);
  assert.equal(r.aggregateChf, 980);
  assert.equal(r.enhancedRequired, false);
  const r2 = evaluateTravelRule(base({ linked, transfer: { asset: 'USDC', amount: '125', recipient: bob } })); // 100 + 900
  assert.equal(r2.aggregateChf, 1000);
  assert.equal(r2.enhancedRequired, true);
  // a linked transfer that could not be valued makes the aggregate unknown → enhanced
  const r3 = evaluateTravelRule(base({ linked: [{ at: '2026-10-01T10:00:00Z', chf: null, beneficiaryKey: 'bob example', address: bob }] }));
  assert.equal(r3.aggregateChf, null);
  assert.equal(r3.enhancedRequired, true);
});

test('#9 routes: VASP in the directory → TRP before co-signing; unknown hosted institution → refused; invalid proof → refused', () => {
  const vasp = { vaspId: 'demo-exchange-ag', name: 'Demo Exchange AG', lei: 'DEMO00DEMOEXCHG00166', country: 'CH', endpoint: 'http://x' };
  const v = evaluateTravelRule(base({ vasp, declaration: { kind: 'third-party', beneficiary: { name: 'Dana Example', walletType: 'hosted', providerName: 'Demo Exchange AG' } } }));
  assert.equal(v.decision, 'allow');
  assert.equal(v.route, 'vasp');
  assert.equal(v.transmission, 'trp-required');
  assert.deepEqual(v.vasp, { vaspId: 'demo-exchange-ag', name: 'Demo Exchange AG' });
  assert.ok(v.checks.some((c) => c.id === 'travel-rule-transmission' && /before co-signing/.test(c.label)));
  // the directory wins over a "personal wallet" declaration
  assert.equal(evaluateTravelRule(base({ vasp, declaration: { kind: 'third-party', beneficiary: { name: 'Dana Example', walletType: 'unhosted' } } })).route, 'vasp');
  // still subject to the beneficiary fields (≥ threshold → enhanced)
  assert.equal(evaluateTravelRule(base({ vasp, rate: undefined, declaration: { kind: 'third-party', beneficiary: { name: 'Dana Example', walletType: 'hosted', providerName: 'X' } } })).decision, 'reject');
  const h = evaluateTravelRule(base({ declaration: { kind: 'third-party', beneficiary: { ...enhanced, walletType: 'hosted', providerName: 'Unknown Bank' } } }));
  assert.equal(h.decision, 'reject');
  assert.equal(h.transmission, 'trp-unreachable');
  const bad = evaluateTravelRule(base({ ownership: { status: 'invalid', detail: ['wrong signer', 'mauvais signataire'] }, declaration: { kind: 'third-party', beneficiary: { name: 'Bob Example', walletType: 'unhosted', declaresOwnership: true } } }));
  assert.equal(bad.decision, 'reject');
  assert.ok(bad.reasons.includes('wrong signer'));
});

test('own wallet: must be a wallet verified for this client; registry outage refuses', () => {
  const own = [{ address: ext, label: 'MetaMask', kind: 'external' as const, method: 'SIWE (EIP-4361) personal_sign' }];
  assert.equal(evaluateTravelRule(base({ declaration: { kind: 'own' }, ownWallets: own, transfer: { asset: 'USDC', amount: '5000', recipient: ext } })).decision, 'allow');
  assert.equal(evaluateTravelRule(base({ declaration: { kind: 'own' }, ownWallets: own })).decision, 'reject'); // bob is not verified
  assert.equal(evaluateTravelRule(base({ declaration: { kind: 'own' }, ownWallets: null, transfer: { asset: 'USDC', amount: '1', recipient: ext } })).decision, 'reject');
  // undeclared: allowed only when the recipient is a verified own wallet
  assert.equal(evaluateTravelRule(base({ declaration: undefined, ownWallets: own, transfer: { asset: 'USDC', amount: '1', recipient: ext } })).category, 'own');
  assert.equal(evaluateTravelRule(base({ declaration: undefined })).decision, 'reject');
});

test('hosted wallet needs the institution name; declaration sanitising drops unknown fields', () => {
  const r = evaluateTravelRule(base({ declaration: { kind: 'third-party', beneficiary: { name: 'Bob Example', walletType: 'hosted' } } }));
  assert.ok(r.missing.includes('providerName'));
  const d = sanitizeDeclaration({ kind: 'third-party', beneficiary: { name: '  Bob Example ', walletType: 'x', secret: 'k', country: 'ch' }, extra: 1 }) as any;
  assert.equal(d.beneficiary.name, 'Bob Example');
  assert.equal(d.beneficiary.walletType, undefined);
  assert.equal(d.beneficiary.country, 'CH');
  assert.equal('secret' in d.beneficiary, false);
  assert.equal(sanitizeDeclaration({ kind: 'nope' }), undefined);
});

test('linked ops exclude unsubmitted previews and failed/cancelled/rejected requests', () => {
  const rec = (status: any, requestId?: string) => ({ id: 'x', previewId: 'p', requestId, createdAt: '2026-10-01T00:00:00Z', retainUntil: '', recipient: bob, asset: 'USDC' as const, amount: '1', chf: 1, category: 'third-party' as const, status, ruleVersion: 'v', demo: true });
  const st: Record<string, string> = { a: 'executed', b: 'failed', c: 'awaiting-otp', d: 'cancelled' };
  const ops = linkedOpsOf([rec('prepared'), rec('submitted', 'a'), rec('submitted', 'b'), rec('submitted', 'c'), rec('submitted', 'd')], (id) => st[id]);
  assert.equal(ops.length, 2);
});
