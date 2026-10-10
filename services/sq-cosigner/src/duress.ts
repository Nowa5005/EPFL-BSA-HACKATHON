// #16 — Client under threat (extortion).
//
// 1. DURESS CODE (optional, set in Security with the passkey). Typed INSTEAD of the wallet password at unlock, it opens
//    a decoy view on the device and silently (a) freezes co-signing — the same freeze as a compliance freeze, so the
//    client cannot lift it under pressure and every real operation gets 423 — and (b) raises a "duress" alert in the
//    Swissquote console. Nothing is written in the client's activity, inbox or notifications (an attacker may watch them).
//    Storage: never the code. The device derives proof = scrypt(code, "mywall-duress-v1:<clientId>") and the server
//    keeps only scrypt(proof, random salt) — like the backup code (backupCode.ts). Check: every unlock calls
//    /unlock/check (with a random value when the password was right), the server always runs the same scrypt (a dummy
//    record when no code is set) and compares in constant time → same latency and same answer shape whichever code
//    was typed.
// 2. PROTECTIVE LIMITS: the client chooses the daily limit. Lowering is immediate; raising takes effect only after
//    POLICY.limitRaiseDelaySec (demo 60 s, prod 24 h), with notifications and a cancel button — so a client forced
//    to raise it has time to react (or Swissquote does).

import type { Express, Request } from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { POLICY, both } from '@sq/shared';
import { newId, nowIso, t } from '@sq/shared/server';
import { db, getClient, HttpError, logActivity, notify, type Client } from './db';
import { authOptionsForAction, verifyAssertion } from './webauthn';

type Route = (fn: (req: Request) => unknown) => any;

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const DURESS_PROOF_RE = /^0x[0-9a-f]{64}$/;
const hashProof = (proof: string, salt: string) => scryptSync(Buffer.from(DURESS_PROOF_RE.test(proof) ? proof.slice(2) : '00', 'hex'), Buffer.from(salt, 'hex'), 32, SCRYPT);
// Compared against when the client has no duress code: same work, never matches (random hash).
const DUMMY = { salt: randomBytes(16).toString('hex'), hash: randomBytes(32).toString('hex') };

export interface DuressAlert {
  id: string;
  clientId: string;
  at: string;
  lastAt: string;
  count: number;
  status: 'open' | 'resolved';
  resolvedAt?: string;
  resolvedBy?: string;
  note?: string;
}

export function setDuressCode(clientId: string, proof: string) {
  if (!DURESS_PROOF_RE.test(proof)) throw new HttpError(400, t('Invalid duress code.', 'Code de contrainte invalide.'));
  const salt = randomBytes(16).toString('hex');
  db.update((d) => (d.clients[clientId].duress = { salt, hash: hashProof(proof, salt).toString('hex'), createdAt: nowIso() }));
}

export function removeDuressCode(clientId: string) {
  db.update((d) => delete d.clients[clientId].duress);
}

/** Constant-time check. Returns true only when the proof matches the client's duress code (and then triggers it). */
export function checkDuress(clientId: string, proof: unknown): boolean {
  const rec = getClient(clientId).duress ?? DUMMY;
  const p = typeof proof === 'string' ? proof.toLowerCase() : '';
  const got = hashProof(p, rec.salt);
  const match = timingSafeEqual(got, Buffer.from(rec.hash, 'hex')) && rec !== DUMMY && DURESS_PROOF_RE.test(p);
  if (match) triggerDuress(clientId);
  return match;
}

/** Silent: freeze co-signing (as a compliance freeze) + console alert. Nothing visible to the client. */
export function triggerDuress(clientId: string) {
  const at = nowIso();
  db.update((d) => {
    const c = d.clients[clientId];
    c.frozen = true;
    c.frozenBy = 'compliance'; // the client cannot lift it under pressure; shown as a compliance freeze
    d.duressAlerts ??= [];
    const open = d.duressAlerts.find((a) => a.clientId === clientId && a.status === 'open');
    if (open) {
      open.count += 1;
      open.lastAt = at;
    } else d.duressAlerts.push({ id: newId(), clientId, at, lastAt: at, count: 1, status: 'open' });
    // Pending operations waiting for approval are blocked too (the freeze stops any co-signature).
  });
  console.log(`[cosigner] security alert raised for ${clientId} (see console)`); // no detail in logs
}

// ───────────────────────────── Protective limits ─────────────────────────────

export interface ClientLimits {
  dailyUsdc: number;
  updatedAt: string;
  pending?: { dailyUsdc: number; requestedAt: string; effectiveAt: string };
}

const raiseDelaySec = () => Number(process.env.LIMIT_RAISE_DELAY_SEC ?? POLICY.limitRaiseDelaySec);

/** Applies a pending raise whose delay is over (with a notification). Returns the effective limits. */
export function settleLimits(clientId: string, now = new Date()): ClientLimits {
  const c = getClient(clientId);
  const l = c.limits;
  if (l?.pending && new Date(l.pending.effectiveAt).getTime() <= now.getTime()) {
    const v = l.pending.dailyUsdc;
    db.update((d) => {
      const x = d.clients[clientId].limits!;
      x.dailyUsdc = v;
      x.updatedAt = now.toISOString();
      delete x.pending;
    });
    logActivity({ clientId, actor: 'swissquote', type: 'limits.raised', message: both(`Daily limit raised to ${v} USDC (after the security delay)`, `Limite journalière relevée à ${v} USDC (après le délai de sécurité)`) });
    notify({ clientId, channel: 'app', subject: both('Daily limit raised', 'Limite journalière relevée'), body: both(`Your daily limit is now ${v} USDC.`, `Votre limite journalière est désormais de ${v} USDC.`) });
  }
  return getClient(clientId).limits ?? { dailyUsdc: POLICY.dailyLimitUsdc, updatedAt: '' };
}

/** Daily limit the policy engine applies now. */
export const effectiveDailyLimit = (c: Client) => settleLimits(c.clientId).dailyUsdc;

/**
 * Pure decision for a change of the daily limit: lowering (or equal) → immediate (and cancels a pending raise);
 * raising → pending until now + delay.
 */
export function planLimitChange(current: ClientLimits, requested: number, now: Date, delaySec: number): { kind: 'lowered' | 'pending'; next: ClientLimits } {
  if (requested <= current.dailyUsdc) return { kind: 'lowered', next: { dailyUsdc: requested, updatedAt: now.toISOString() } };
  return { kind: 'pending', next: { ...current, pending: { dailyUsdc: requested, requestedAt: now.toISOString(), effectiveAt: new Date(now.getTime() + delaySec * 1000).toISOString() } } };
}

const limitsView = (c: Client) => {
  const l = settleLimits(c.clientId);
  return { dailyUsdc: l.dailyUsdc, pending: l.pending ?? null, defaultUsdc: POLICY.dailyLimitUsdc, maxUsdc: POLICY.dailyLimitMaxUsdc, raiseDelaySec: raiseDelaySec() };
};

export function registerDuressRoutes(app: Express, route: Route) {
  // ── Duress code ──
  app.get('/clients/:id/duress-code', route((req) => {
    const c = getClient(String(req.params.id));
    return { configured: !!c.duress, createdAt: c.duress?.createdAt ?? null };
  }));
  app.post('/clients/:id/duress-code', route(async (req) => {
    const c = getClient(String(req.params.id));
    await verifyAssertion(c.clientId, req.body.webauthn, { purpose: 'duress-code' });
    setDuressCode(c.clientId, String(req.body.proof ?? '').toLowerCase());
    // Deliberately generic: the activity feed must not reveal that a duress code exists.
    logActivity({ clientId: c.clientId, actor: 'client', type: 'security.settings', message: both('Security settings updated', 'Paramètres de sécurité mis à jour') });
    return { configured: true, createdAt: getClient(c.clientId).duress!.createdAt };
  }));
  app.post('/clients/:id/duress-code/remove', route(async (req) => {
    const c = getClient(String(req.params.id));
    await verifyAssertion(c.clientId, req.body.webauthn, { purpose: 'duress-code' });
    removeDuressCode(c.clientId);
    logActivity({ clientId: c.clientId, actor: 'client', type: 'security.settings', message: both('Security settings updated', 'Paramètres de sécurité mis à jour') });
    return { configured: false, createdAt: null };
  }));
  /** Called at EVERY unlock (random value when the password was right): same work, same answer shape. */
  app.post('/clients/:id/unlock/check', route((req) => {
    const c = getClient(String(req.params.id));
    return { verified: checkDuress(c.clientId, req.body?.proof) };
  }));

  // ── Protective limits ──
  app.get('/clients/:id/limits', route((req) => limitsView(getClient(String(req.params.id)))));
  app.post('/clients/:id/limits/options', route(async (req) => authOptionsForAction(getClient(String(req.params.id)), `limits:${Number(req.body?.dailyUsdc)}`)));
  app.post('/clients/:id/limits', route(async (req) => {
    const c = getClient(String(req.params.id));
    const v = Number(req.body?.dailyUsdc);
    if (!Number.isFinite(v) || v < 0 || v > POLICY.dailyLimitMaxUsdc || Math.round(v * 100) !== v * 100)
      throw new HttpError(400, t(`Choose a daily limit between 0 and ${POLICY.dailyLimitMaxUsdc} USDC.`, `Choisissez une limite journalière entre 0 et ${POLICY.dailyLimitMaxUsdc} USDC.`));
    const cur = settleLimits(c.clientId);
    const now = new Date();
    const plan = planLimitChange(cur, v, now, raiseDelaySec());
    // Raising needs the passkey (and then waits); lowering only reduces risk and is never blocked.
    if (plan.kind === 'pending') await verifyAssertion(c.clientId, req.body.webauthn, { purpose: `limits:${v}` });
    db.update((d) => (d.clients[c.clientId].limits = plan.next));
    if (plan.kind === 'lowered') {
      logActivity({ clientId: c.clientId, actor: 'client', type: 'limits.lowered', message: both(`Daily limit lowered to ${v} USDC (immediate)`, `Limite journalière abaissée à ${v} USDC (immédiat)`) });
    } else {
      const when = plan.next.pending!.effectiveAt;
      logActivity({ clientId: c.clientId, actor: 'client', type: 'limits.raise-requested', message: both(`Daily limit raise to ${v} USDC requested — effective ${when}`, `Relèvement de la limite journalière à ${v} USDC demandé — effectif le ${when}`) });
      for (const channel of ['email', 'app'] as const)
        notify({
          clientId: c.clientId,
          channel,
          subject: both('Daily limit raise requested', 'Relèvement de limite demandé'),
          body: both(
            `Your daily limit will rise from ${cur.dailyUsdc} to ${v} USDC after a security delay (${raiseDelaySec()} s in this demo, 24 h in production). If this wasn't you, or if you are being pressured, cancel it in Security or contact Swissquote.`,
            `Votre limite journalière passera de ${cur.dailyUsdc} à ${v} USDC après un délai de sécurité (${raiseDelaySec()} s dans cette démo, 24 h en production). Si ce n'est pas vous, ou si l'on fait pression sur vous, annulez-le dans Sécurité ou contactez Swissquote.`,
          ),
        });
    }
    return { ...limitsView(getClient(c.clientId)), applied: plan.kind };
  }));
  app.post('/clients/:id/limits/cancel', route((req) => {
    const c = getClient(String(req.params.id));
    if (c.limits?.pending) {
      db.update((d) => delete d.clients[c.clientId].limits!.pending);
      logActivity({ clientId: c.clientId, actor: 'client', type: 'limits.raise-cancelled', message: both('Pending daily limit raise cancelled', 'Relèvement de limite en attente annulé') });
    }
    return limitsView(getClient(c.clientId));
  }));

  // ── Compliance console ──
  app.get('/admin/duress', route(() => (db.data.duressAlerts ?? []).slice().reverse().map((a) => ({ ...a, clientName: db.data.clients[a.clientId]?.name ?? null, frozen: !!db.data.clients[a.clientId]?.frozen }))));
  app.post('/admin/duress/:id/resolve', route((req) => {
    const a = db.data.duressAlerts?.find((x) => x.id === String(req.params.id));
    if (!a) throw new HttpError(404, t('Unknown alert', 'Alerte inconnue'));
    db.update(() => Object.assign(a, { status: 'resolved', resolvedAt: nowIso(), resolvedBy: String(req.body?.agent ?? 'compliance.officer@swissquote (mock)'), note: typeof req.body?.note === 'string' ? req.body.note.slice(0, 200) : undefined }));
    return a;
  }));

  // Apply due limit raises in the background (notification when they take effect).
  setInterval(() => {
    for (const c of Object.values(db.data.clients)) if (c.limits?.pending) settleLimits(c.clientId);
  }, 5000).unref();
}
