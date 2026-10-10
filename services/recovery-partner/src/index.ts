// recovery-partner — MOCK independent Swiss recovery partner (e.g. notary / trustee).
// Separate process, own data/ directory. Holds ONLY share ③ of the recovery key (1 of 3 → useless alone).
// Releases it only after strong identity verification + risk scoring.

import { loadDotenv, JsonStore, newId, nowIso } from '@sq/shared/server';
loadDotenv();

import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { hexlify, randomBytes, scryptSync, toUtf8Bytes } from 'ethers';
import { PORTS, SERVICE_URLS, normalizeAnswer } from '@sq/shared';

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
  cloudCommitment?: string; // sha256 of the cloud share (encrypted backup) — never the share itself
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
  proofKind?: 'paper' | 'cloud';
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

// Answers are normalised (case, accents, spaces, final punctuation) then hashed with scrypt (ethers) and a random salt
// per answer. Clear-text answers are never stored nor logged.
const hashAnswer = (answer: string, salt: string) => hexlify(scryptSync(toUtf8Bytes(normalizeAnswer(answer)), salt, 1 << 14, 8, 1, 32)).slice(2);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', route(() => ({ service: 'recovery-partner', shares: Object.keys(store.data.shares).length })));

/** Enrolment at wallet creation: stores share ③ + KYC reference + hashed security answers. */
app.post(
  '/shares',
  route((req) => {
    const { clientId, safeAddress, share, kyc, questions, paperCommitment, cloudCommitment } = req.body as {
      clientId: string;
      safeAddress: string;
      share: string;
      kyc: ShareRecord['kyc'];
      questions: { question: string; answer: string }[];
      paperCommitment: string;
      cloudCommitment?: string;
    };
    if (!clientId || !share || !safeAddress || !paperCommitment) throw new HttpError(400, 'Champs manquants');
    if (!Array.isArray(questions) || questions.length !== 3) throw new HttpError(400, 'Exactement 3 questions de sécurité sont requises');
    if (new Set(questions.map((q) => q.question)).size !== 3) throw new HttpError(400, 'Les 3 questions doivent être différentes');
    if (questions.some((q) => normalizeAnswer(q.answer ?? '').length < 1)) throw new HttpError(400, 'Les 3 réponses sont obligatoires');
    const rec: ShareRecord = {
      clientId,
      safeAddress,
      share,
      kyc,
      paperCommitment,
      cloudCommitment,
      questions: questions.map((q) => {
        const salt = hexlify(randomBytes(16));
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
    if (!r) throw new HttpError(404, 'Aucune inscription de récupération pour ce client');
    return { clientId: r.clientId, safeAddress: r.safeAddress, questions: r.questions.map((q) => q.question), enrolledAt: r.createdAt };
  }),
);

app.post(
  '/sessions',
  route((req) => {
    const { clientId, context } = req.body as { clientId: string; context?: Partial<Session['context']> };
    const r = store.data.shares[clientId];
    if (!r) throw new HttpError(404, 'Aucune inscription de récupération pour ce client');
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
  if (!s) throw new HttpError(404, 'Session inconnue');
  if (s.decision) throw new HttpError(409, 'Session déjà décidée');
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
    // Proof of possession of one of the client's own parts: paper code (①) or decrypted cloud backup (②).
    const rec = store.data.shares[s.clientId];
    const c = String(req.body.commitment ?? '').toLowerCase();
    const kind: 'paper' | 'cloud' = req.body.kind === 'cloud' ? 'cloud' : 'paper';
    const ok = kind === 'paper' ? c === rec.paperCommitment.toLowerCase() : !!rec.cloudCommitment && c === rec.cloudCommitment.toLowerCase();
    store.update((d) => Object.assign(d.sessions[s.id], { paperProof: ok, proofKind: kind }));
    return { paperProof: ok, kind };
  }),
);

/** Risk-based decision. Hard requirements: Swissquote login + liveness match. Security questions only carry low weight. */
app.post(
  '/sessions/:id/decide',
  route(async (req) => {
    const s = session(String(req.params.id));
    const rec = store.data.shares[s.clientId];
    const factors: NonNullable<Session['factors']> = [];
    factors.push({ factor: 'Connexion au compte Swissquote (authentification séparée)', points: 0, hard: true, ok: s.context.swissquoteLogin });
    factors.push({ factor: 'Selfie vidéo conforme à la photo KYC', points: 0, hard: true, ok: s.liveness === 'match' });
    factors.push({ factor: s.proofKind === 'cloud' ? 'Sauvegarde cloud déchiffrée présentée' : 'Code de récupération papier présenté', points: s.paperProof ? 0 : 40, ok: !!s.paperProof });
    factors.push({ factor: 'Appareil nouveau ou inconnu', points: s.context.newDevice ? 15 : 0, ok: !s.context.newDevice });
    factors.push({ factor: 'Adresse IP ou pays inhabituel', points: s.context.unusualIp ? 20 : 0, ok: !s.context.unusualIp });
    factors.push({ factor: 'Changement de carte SIM récent signalé par l’opérateur', points: s.context.simSwapRecent ? 35 : 0, ok: !s.context.simSwapRecent });
    const a = s.answers ?? { correct: 0, total: 3 };
    factors.push({ factor: `Questions de sécurité (${a.correct}/${a.total} correctes — poids faible)`, points: (a.total - a.correct) * 10 - a.correct * 5, ok: a.correct === a.total });
    const riskScore = Math.max(0, factors.reduce((n, f) => n + f.points, 0));
    const hardFail = factors.filter((f) => f.hard && !f.ok);
    const released = hardFail.length === 0 && riskScore < RISK_THRESHOLD;

    if (!released) {
      store.update((d) => Object.assign(d.sessions[s.id], { decision: 'refused', riskScore, factors }));
      const why = hardFail.length ? 'échec : ' + hardFail.map((f) => f.factor).join(', ') : `score de risque ${riskScore} ≥ ${RISK_THRESHOLD}`;
      console.log(`[partner] REFUSED recovery for ${s.clientId}: ${why}`);
      await fetch(`${COSIGNER_URL}/recovery/alerts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: s.clientId, riskScore, message: `Le partenaire de récupération a refusé une tentative (${why}).` }),
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
    if (!a) throw new HttpError(404, 'Attestation inconnue');
    return a;
  }),
);

app.get('/admin/sessions', route(() => Object.values(store.data.sessions).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)));

app.post('/admin/clients/:id/reset', route((req) => {
  const id = String(req.params.id);
  store.update((d) => {
    delete d.shares[id];
    for (const k of Object.keys(d.sessions)) if (d.sessions[k].clientId === id) delete d.sessions[k];
  });
  return { reset: true };
}));

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
