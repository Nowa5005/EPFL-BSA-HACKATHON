// recovery-partner — MOCK independent Swiss recovery partner (e.g. notary / trustee).
// Separate process, own data/ directory. Holds ONLY share ③ of the recovery key (1 of 3 → useless alone).
// Releases it only after strong identity verification + risk scoring.

import { loadDotenv, JsonStore, newId, nowIso } from '@sq/shared/server';
loadDotenv();

import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { PORTS, SERVICE_URLS } from '@sq/shared';

const DATA_DIR = process.env.PARTNER_DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const COSIGNER_URL = process.env.COSIGNER_URL ?? SERVICE_URLS.cosigner;
const RISK_THRESHOLD = 50;

interface ShareRecord {
  clientId: string;
  safeAddress: string;
  share: string;
  kyc: { name: string; dob: string; idNumber: string };
  questions: { question: string; salt: string; hash: string }[];
  paperCommitment: string; // sha256 of the paper share — the partner never holds the paper share itself
  createdAt: string;
}

interface Session {
  id: string;
  clientId: string;
  createdAt: string;
  context: { swissquoteLogin: boolean; newDevice: boolean; unusualIp: boolean; simSwapRecent: boolean; actor?: string };
  liveness?: 'match' | 'no-match';
  answers?: { correct: number; total: number };
  paperProof?: boolean;
  decision?: 'released' | 'refused';
  riskScore?: number;
  factors?: { factor: string; points: number; hard?: boolean; ok: boolean }[];
  attestationId?: string;
}

interface Attestation {
  id: string;
  clientId: string;
  safeAddress: string;
  sessionId: string;
  decision: 'released';
  riskScore: number;
  createdAt: string;
  expiresAt: string;
}

const store = new JsonStore<{ shares: Record<string, ShareRecord>; sessions: Record<string, Session>; attestations: Record<string, Attestation> }>(
  DATA_DIR,
  'partner',
  () => ({ shares: {}, sessions: {}, attestations: {} }),
);

class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}
const route = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).then((r) => !res.headersSent && res.json(r ?? { ok: true })).catch(next);

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const hashAnswer = (answer: string, salt: string) => scryptSync(norm(answer), Buffer.from(salt, 'hex'), 32).toString('hex');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', route(() => ({ service: 'recovery-partner', shares: Object.keys(store.data.shares).length })));

/** Enrolment at wallet creation: stores share ③ + KYC reference + hashed security answers. */
app.post(
  '/shares',
  route((req) => {
    const { clientId, safeAddress, share, kyc, questions, paperCommitment } = req.body as {
      clientId: string;
      safeAddress: string;
      share: string;
      kyc: ShareRecord['kyc'];
      questions: { question: string; answer: string }[];
      paperCommitment: string;
    };
    if (!clientId || !share || !safeAddress || !paperCommitment) throw new HttpError(400, 'Missing fields');
    if (!Array.isArray(questions) || questions.length !== 3) throw new HttpError(400, 'Exactly 3 security questions required');
    const rec: ShareRecord = {
      clientId,
      safeAddress,
      share,
      kyc,
      paperCommitment,
      questions: questions.map((q) => {
        const salt = randomBytes(16).toString('hex');
        return { question: q.question, salt, hash: hashAnswer(q.answer, salt) };
      }),
      createdAt: nowIso(),
    };
    store.update((d) => (d.shares[clientId] = rec));
    console.log(`[partner] share ③ stored for ${clientId} (${safeAddress})`);
    return { stored: true, partner: 'Helvetia Trust & Recovery AG (MOCK)' };
  }),
);

app.get(
  '/shares/:clientId/meta',
  route((req) => {
    const r = store.data.shares[String(req.params.clientId)];
    if (!r) throw new HttpError(404, 'No recovery enrolment for this client');
    return { clientId: r.clientId, safeAddress: r.safeAddress, questions: r.questions.map((q) => q.question), enrolledAt: r.createdAt };
  }),
);

app.post(
  '/sessions',
  route((req) => {
    const { clientId, context } = req.body as { clientId: string; context?: Partial<Session['context']> };
    const r = store.data.shares[clientId];
    if (!r) throw new HttpError(404, 'No recovery enrolment for this client');
    const s: Session = {
      id: newId(),
      clientId,
      createdAt: nowIso(),
      context: { swissquoteLogin: false, newDevice: true, unusualIp: false, simSwapRecent: false, ...context },
    };
    store.update((d) => (d.sessions[s.id] = s));
    return { sessionId: s.id, questions: r.questions.map((q) => q.question) };
  }),
);

const session = (id: string) => {
  const s = store.data.sessions[id];
  if (!s) throw new HttpError(404, 'Unknown session');
  if (s.decision) throw new HttpError(409, 'Session already decided');
  return s;
};

/** MOCK video-ident / liveness: in production a certified provider compares a live selfie with the KYC photo. */
app.post(
  '/sessions/:id/liveness',
  route((req) => {
    const s = session(String(req.params.id));
    const result = req.body.result === 'match' ? 'match' : 'no-match';
    store.update((d) => (d.sessions[s.id].liveness = result));
    return { liveness: result };
  }),
);

app.post(
  '/sessions/:id/answers',
  route((req) => {
    const s = session(String(req.params.id));
    const rec = store.data.shares[s.clientId];
    const answers = (req.body.answers ?? []) as string[];
    let correct = 0;
    rec.questions.forEach((q, i) => {
      const a = answers[i] ?? '';
      if (timingSafeEqual(Buffer.from(hashAnswer(a, q.salt), 'hex'), Buffer.from(q.hash, 'hex'))) correct++;
    });
    store.update((d) => (d.sessions[s.id].answers = { correct, total: rec.questions.length }));
    return { correct, total: rec.questions.length };
  }),
);

app.post(
  '/sessions/:id/paper-proof',
  route((req) => {
    const s = session(String(req.params.id));
    const ok = String(req.body.commitment ?? '').toLowerCase() === store.data.shares[s.clientId].paperCommitment.toLowerCase();
    store.update((d) => (d.sessions[s.id].paperProof = ok));
    return { paperProof: ok };
  }),
);

/** Risk-based decision. Hard requirements: Swissquote login + liveness match. Security questions only carry low weight. */
app.post(
  '/sessions/:id/decide',
  route(async (req) => {
    const s = session(String(req.params.id));
    const rec = store.data.shares[s.clientId];
    const factors: NonNullable<Session['factors']> = [];
    factors.push({ factor: 'Swissquote account login (separate authentication)', points: 0, hard: true, ok: s.context.swissquoteLogin });
    factors.push({ factor: 'Liveness selfie matches KYC photo', points: 0, hard: true, ok: s.liveness === 'match' });
    factors.push({ factor: 'Paper recovery kit presented', points: s.paperProof ? 0 : 40, ok: !!s.paperProof });
    factors.push({ factor: 'New / unknown device', points: s.context.newDevice ? 15 : 0, ok: !s.context.newDevice });
    factors.push({ factor: 'Unusual IP / country', points: s.context.unusualIp ? 20 : 0, ok: !s.context.unusualIp });
    factors.push({ factor: 'Recent SIM swap reported by carrier', points: s.context.simSwapRecent ? 35 : 0, ok: !s.context.simSwapRecent });
    const a = s.answers ?? { correct: 0, total: 3 };
    factors.push({ factor: `Security questions (${a.correct}/${a.total} correct — low weight)`, points: (a.total - a.correct) * 10 - a.correct * 5, ok: a.correct === a.total });
    const riskScore = Math.max(0, factors.reduce((n, f) => n + f.points, 0));
    const hardFail = factors.filter((f) => f.hard && !f.ok);
    const released = hardFail.length === 0 && riskScore < RISK_THRESHOLD;

    if (!released) {
      store.update((d) => Object.assign(d.sessions[s.id], { decision: 'refused', riskScore, factors }));
      const why = hardFail.length ? hardFail.map((f) => f.factor).join(', ') + ' failed' : `risk score ${riskScore} ≥ ${RISK_THRESHOLD}`;
      console.log(`[partner] REFUSED recovery for ${s.clientId}: ${why}`);
      await fetch(`${COSIGNER_URL}/recovery/alerts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: s.clientId, riskScore, message: `Recovery partner refused a recovery attempt (${why}).` }),
      }).catch(() => undefined);
      return { decision: 'refused', riskScore, threshold: RISK_THRESHOLD, factors };
    }

    const att: Attestation = {
      id: newId(),
      clientId: s.clientId,
      safeAddress: rec.safeAddress,
      sessionId: s.id,
      decision: 'released',
      riskScore,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
    store.update((d) => {
      Object.assign(d.sessions[s.id], { decision: 'released', riskScore, factors, attestationId: att.id });
      d.attestations[att.id] = att;
    });
    console.log(`[partner] share ③ released to ${s.clientId} (risk ${riskScore})`);
    return { decision: 'released', riskScore, threshold: RISK_THRESHOLD, factors, share: rec.share, attestationId: att.id, safeAddress: rec.safeAddress };
  }),
);

/** Server-to-server: lets Swissquote's co-signer check that the partner approved a recovery. */
app.get(
  '/attestations/:id',
  route((req) => {
    const a = store.data.attestations[String(req.params.id)];
    if (!a) throw new HttpError(404, 'Unknown attestation');
    return a;
  }),
);

app.get('/admin/sessions', route(() => Object.values(store.data.sessions).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)));

app.post('/admin/reset', route(() => {
  store.update((d) => {
    d.shares = {};
    d.sessions = {};
    d.attestations = {};
  });
  return { reset: true };
}));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  console.error(err);
  res.status(500).json({ error: String((err as Error)?.message ?? err) });
});

app.listen(PORTS.partner, () => console.log(`recovery-partner (MOCK trustee) listening on http://localhost:${PORTS.partner}`));
