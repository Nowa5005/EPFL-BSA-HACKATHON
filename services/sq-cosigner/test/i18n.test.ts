// Server messages: English by default, French with `x-lang: fr`. Stored texts (activity, notifications, policy
// checks) keep both languages and are localised when read; legacy French-only records are shown as-is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { both, localizeDeep } from '@sq/shared';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywall-i18n-'));
process.env.COSIGNER_DATA_DIR = dir;
process.env.ENV_FILE = path.join(dir, '.env');
process.env.SERVICE_MASTER_KEY = 'test-master-key-0123456789abcdefghijklmnop';

async function startApp() {
  const { createSecurity, localizeResponses } = await import('@sq/shared/server');
  const { db, getClient, HttpError, logActivity, notify } = await import('../src/db');
  const sec = createSecurity({ service: 'i18n-test', publicRoutes: [['*', '/t/*']] });
  const app = express();
  app.use(sec.edge);
  app.use(express.json());
  app.use(sec.guard);
  app.use(localizeResponses);
  const route = (fn: (req: Request) => unknown) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve()
      .then(() => fn(req)) // async boundary on purpose: the request language must survive it
      .then((r) => res.json(r))
      .catch(next);
  app.get('/t/unknown-client', route(() => getClient('CH-DOES-NOT-EXIST')));
  app.post('/t/log', route((req) => {
    db.update((d) => (d.clients['CH-I18N'] ??= { clientId: 'CH-I18N', name: 'I', email: 'i@x', devices: [], contacts: [], usage: { day: '', spentUsdc: 0, sponsoredTx: 0 }, privacy: 'full' } as any));
    logActivity({ clientId: 'CH-I18N', actor: 'client', type: 'test.event', message: both(`Passkey registered on ${req.body.label}`, `Passkey enregistrée sur ${req.body.label}`) });
    notify({ clientId: 'CH-I18N', channel: 'app', subject: both('Hello', 'Bonjour'), body: 'same text', action: { label: both('Cancel', 'Annuler'), kind: 'cancel-tx', id: 'x' } });
    return { ok: true };
  }));
  app.get('/t/activity', route(() => db.data.activity.filter((e) => e.clientId === 'CH-I18N')));
  app.get('/t/inbox', route(() => db.data.inbox.filter((m) => m.clientId === 'CH-I18N')));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => res.status(err.status ?? 500).json({ error: err.message }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, db, close: () => server.close() };
}

test('HTTP error: English without x-lang, French with x-lang: fr', async () => {
  const { base, close } = await startApp();
  try {
    const en = await fetch(`${base}/t/unknown-client`);
    assert.equal(en.status, 404);
    assert.equal((await en.json()).error, 'Unknown client');
    const fr = await fetch(`${base}/t/unknown-client`, { headers: { 'x-lang': 'fr' } });
    assert.equal((await fr.json()).error, 'Client inconnu');
    const other = await fetch(`${base}/t/unknown-client`, { headers: { 'x-lang': 'de' } });
    assert.equal((await other.json()).error, 'Unknown client', 'unsupported language → English');
  } finally {
    close();
  }
});

test('stored activity / notification: both languages kept, read in the reader’s language; legacy French kept as-is', async () => {
  const { base, db, close } = await startApp();
  try {
    // created by a French-speaking client…
    const r = await fetch(`${base}/t/log`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lang': 'fr' }, body: JSON.stringify({ label: 'Mac' }) });
    assert.equal(r.status, 200);
    const stored = db.data.activity.find((e) => e.type === 'test.event')!;
    assert.equal(stored.message, 'Passkey registered on Mac');
    assert.equal(stored.messageFr, 'Passkey enregistrée sur Mac');
    // a legacy record (before the sweep) only has a French message
    db.update((d) => d.activity.push({ id: 'legacy', ts: new Date().toISOString(), clientId: 'CH-I18N', actor: 'system', type: 'legacy', message: 'Ancien message en français' }));

    // …read in English by default
    const en = (await (await fetch(`${base}/t/activity`)).json()) as any[];
    assert.equal(en.find((e) => e.type === 'test.event').message, 'Passkey registered on Mac');
    assert.ok(!('messageFr' in en[0]), 'the twin field is folded, not sent');
    assert.equal(en.find((e) => e.id === 'legacy').message, 'Ancien message en français');
    // …and in French on request
    const fr = (await (await fetch(`${base}/t/activity`, { headers: { 'x-lang': 'fr' } })).json()) as any[];
    assert.equal(fr.find((e) => e.type === 'test.event').message, 'Passkey enregistrée sur Mac');
    assert.equal(fr.find((e) => e.id === 'legacy').message, 'Ancien message en français');

    const inboxFr = (await (await fetch(`${base}/t/inbox`, { headers: { 'x-lang': 'fr' } })).json()) as any[];
    assert.equal(inboxFr[0].subject, 'Bonjour');
    assert.equal(inboxFr[0].body, 'same text');
    assert.equal(inboxFr[0].action.label, 'Annuler');
    const inboxEn = (await (await fetch(`${base}/t/inbox`)).json()) as any[];
    assert.equal(inboxEn[0].subject, 'Hello');
    assert.equal(inboxEn[0].action.label, 'Cancel');
  } finally {
    close();
  }
});

test('policy checks carry French twins; localizeDeep folds them (arrays too) and leaves {en, fr} objects alone', async () => {
  const { evaluatePolicy, decodeBilingual } = await import('../src/policy');
  const { buildSafeTx } = await import('@sq/shared');
  const SAFE = '0x1111111111111111111111111111111111111111';
  const tx = buildSafeTx({ to: '0x098b716b8aaf21512996dc57eb0615e2383e2f96', value: '1', nonce: 0 });
  const decoded = decodeBilingual(tx, SAFE);
  assert.match(decoded.summary, /^Send /);
  assert.match(decoded.summaryFr!, /^Envoyer /);
  const p = evaluatePolicy({ tx, decoded, safeAddress: SAFE, contacts: [], spentTodayUsdc: 0, sponsoredToday: 0, rates: { ETH: 3000, USDC: 1 }, balances: { eth: 10n, usdc: 0n } });
  assert.equal(p.decision, 'reject');
  const san = p.checks.find((c) => c.id === 'sanctions')!;
  assert.equal(san.label, 'Sanctions screening');
  assert.equal(san.labelFr, 'Filtrage des sanctions');
  assert.match(p.reasons[0], /is on a sanctions list/);
  assert.match(p.reasonsFr![0], /figure sur une liste de sanctions/);
  const fr = localizeDeep({ policy: p, decoded, alert: { detail: { en: 'a', fr: 'b' } } }, 'fr');
  assert.equal(fr.policy.checks.find((c) => c.id === 'sanctions')!.label, 'Filtrage des sanctions');
  assert.match(fr.policy.reasons[0], /figure sur une liste/);
  assert.equal((fr.policy as any).reasonsFr, undefined);
  assert.match(fr.decoded.summary, /^Envoyer /);
  assert.deepEqual(fr.alert.detail, { en: 'a', fr: 'b' });
  const en = localizeDeep({ policy: p }, 'en');
  assert.equal(en.policy.checks.find((c) => c.id === 'sanctions')!.label, 'Sanctions screening');
  assert.equal((en.policy.checks[0] as any).labelFr, undefined);
});
