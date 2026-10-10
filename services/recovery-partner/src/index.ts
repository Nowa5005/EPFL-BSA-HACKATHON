// recovery-partner — MOCK independent Swiss recovery partner (e.g. notary / trustee).
// Separate process, own data/ directory. Holds ONLY share ③ of the recovery key (1 of 3 → useless alone).
// It never holds share ② (the security-key part), not even encrypted: that ciphertext is stored by Swissquote, so
// no single party ever keeps two of the three parts.
// Releases it only after strong identity verification + risk scoring.

import { createSecurity, internalHeaders, listenService, localizeResponses, principalOf, segmentsOf, loadDotenv, JsonStore, newId, nowIso, t } from '@sq/shared/server';
loadDotenv();

import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { hexlify, randomBytes, scryptSync, toUtf8Bytes } from 'ethers';
import { PORTS, SERVICE_URLS, biField, normalizeAnswer } from '@sq/shared';

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
  share2Commitment?: string; // sha256 of share ② (security key / offline file) — never the share itself
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
  proofKind?: 'paper' | 'key';
  decision?: 'released' | 'refused';
  riskScore?: number;
  // factor: English, factorFr: French twin (folded on read by localizeResponses); legacy sessions are French-only
  factors?: { factor: string; factorFr?: string; points: number; hard?: boolean; ok: boolean }[];
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

// Records enrolled before part ② moved to a physical security key carry a legacy commitment of the former
// password-encrypted backup file: it is dropped (that part is retired; the client replaces it from Security).
store.update((d) => {
  for (const r of Object.values(d.shares)) delete (r as unknown as Record<string, unknown>).cloudCommitment;
});

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
// Origin allow-list + CORS + JSON-only writes, then DEFAULT-DENY authorisation (shared with the other services).
// A recovery session belongs to the client who opened it: the client's bank session token must match it.
const security = createSecurity({
  service: 'recovery-partner',
  publicRoutes: [['GET', '/health']],
  internalRoutes: [['GET', '/attestations/:id']], // read by the co-signer only
  owner: (req) => {
    const seg = segmentsOf(req.path);
    if (seg[0]?.toLowerCase() === 'shares' && seg.length === 3) return seg[1];
    if (seg[0]?.toLowerCase() === 'sessions' && seg.length >= 2) return store.data.sessions[seg[1]]?.clientId ?? null;
    return undefined;
  },
});
app.use(security.edge);
app.use(express.json());
app.use(security.guard);
app.use(localizeResponses); // stored bilingual texts (`xFr` twins) answered in the request language

app.get('/health', route(() => ({ service: 'recovery-partner', shares: Object.keys(store.data.shares).length })));

/** Enrolment at wallet creation: stores share ③ + KYC reference + hashed security answers. */
app.post(
  '/shares',
  route((req) => {
    const { clientId, safeAddress, share, kyc, questions, paperCommitment, share2Commitment } = req.body as {
      clientId: string;
      safeAddress: string;
      share: string;
      kyc: ShareRecord['kyc'];
      questions: { question: string; answer: string }[];
      paperCommitment: string;
      share2Commitment?: string;
    };
    if (!clientId || !share || !safeAddress || !paperCommitment) throw new HttpError(400, t('Missing fields', 'Champs manquants'));
    if (!Array.isArray(questions) || questions.length !== 3) throw new HttpError(400, t('Exactly 3 security questions are required', 'Exactement 3 questions de sécurité sont requises'));
    if (new Set(questions.map((q) => q.question)).size !== 3) throw new HttpError(400, t('The 3 questions must be different', 'Les 3 questions doivent être différentes'));
    if (questions.some((q) => normalizeAnswer(q.answer ?? '').length < 1)) throw new HttpError(400, t('All 3 answers are required', 'Les 3 réponses sont obligatoires'));
    const rec: ShareRecord = {
      clientId,
      safeAddress,
      share,
      kyc,
      paperCommitment,
      share2Commitment,
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
    if (!r) throw new HttpError(404, t('No recovery enrolment for this client', 'Aucune inscription de récupération pour ce client'));
    return { clientId: r.clientId, safeAddress: r.safeAddress, questions: r.questions.map((q) => q.question), enrolledAt: r.createdAt };
  }),
);

app.post(
  '/sessions',
  route((req) => {
    const { clientId, context } = req.body as { clientId: string; context?: Partial<Session['context']> };
    const r = store.data.shares[clientId];
    if (!r) throw new HttpError(404, t('No recovery enrolment for this client', 'Aucune inscription de récupération pour ce client'));
    const s: Session = {
      id: newId(),
      clientId,
      createdAt: nowIso(),
      // The "Swissquote login" factor is now PROVEN by the verified bank session token (the guard checked that it
      // belongs to this client), not declared by the caller.
      context: { newDevice: true, unusualIp: false, simSwapRecent: false, ...context, swissquoteLogin: principalOf(req).kind === 'client' && principalOf(req).sub === clientId },
    };
    store.update((d) => (d.sessions[s.id] = s));
    return { sessionId: s.id, questions: r.questions.map((q) => q.question) };
  }),
);

const session = (id: string) => {
  const s = store.data.sessions[id];
  if (!s) throw new HttpError(404, t('Unknown session', 'Session inconnue'));
  if (s.decision) throw new HttpError(409, t('Session already decided', 'Session déjà décidée'));
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
    // Proof of possession of one of the client's own parts: paper code (①) or part ② opened with the security key
    // (or the offline file). Only a hash is compared — the partner never receives the client's parts.
    const rec = store.data.shares[s.clientId];
    const c = String(req.body.commitment ?? '').toLowerCase();
    const kind: 'paper' | 'key' = req.body.kind === 'key' ? 'key' : 'paper';
    const ok = kind === 'paper' ? c === rec.paperCommitment.toLowerCase() : !!rec.share2Commitment && c === rec.share2Commitment.toLowerCase();
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
    factors.push({ ...biField('factor', 'Signed in to the Swissquote account (separate authentication)', 'Connexion au compte Swissquote (authentification séparée)'), points: 0, hard: true, ok: s.context.swissquoteLogin });
    factors.push({ ...biField('factor', 'Video selfie matches the KYC photo', 'Selfie vidéo conforme à la photo KYC'), points: 0, hard: true, ok: s.liveness === 'match' });
    factors.push({
      ...(s.proofKind === 'key'
        ? biField('factor', 'Recovery part ② opened with the security key (or offline file)', 'Partie ② ouverte avec la clé de sécurité (ou le fichier hors ligne)')
        : biField('factor', 'Paper recovery code presented', 'Code de récupération papier présenté')),
      points: s.paperProof ? 0 : 40,
      ok: !!s.paperProof,
    });
    factors.push({ ...biField('factor', 'New or unknown device', 'Appareil nouveau ou inconnu'), points: s.context.newDevice ? 15 : 0, ok: !s.context.newDevice });
    factors.push({ ...biField('factor', 'Unusual IP address or country', 'Adresse IP ou pays inhabituel'), points: s.context.unusualIp ? 20 : 0, ok: !s.context.unusualIp });
    factors.push({ ...biField('factor', 'Recent SIM card change reported by the carrier', 'Changement de carte SIM récent signalé par l’opérateur'), points: s.context.simSwapRecent ? 35 : 0, ok: !s.context.simSwapRecent });
    const a = s.answers ?? { correct: 0, total: 3 };
    factors.push({
      ...biField('factor', `Security questions (${a.correct}/${a.total} correct — low weight)`, `Questions de sécurité (${a.correct}/${a.total} correctes — poids faible)`),
      points: (a.total - a.correct) * 10 - a.correct * 5,
      ok: a.correct === a.total,
    });
    const riskScore = Math.max(0, factors.reduce((n, f) => n + f.points, 0));
    const hardFail = factors.filter((f) => f.hard && !f.ok);
    const released = hardFail.length === 0 && riskScore < RISK_THRESHOLD;

    if (!released) {
      store.update((d) => Object.assign(d.sessions[s.id], { decision: 'refused', riskScore, factors }));
      const why = hardFail.length ? 'failed: ' + hardFail.map((f) => f.factor).join(', ') : `risk score ${riskScore} ≥ ${RISK_THRESHOLD}`;
      const whyFr = hardFail.length ? 'échec : ' + hardFail.map((f) => f.factorFr ?? f.factor).join(', ') : `score de risque ${riskScore} ≥ ${RISK_THRESHOLD}`;
      console.log(`[partner] REFUSED recovery for ${s.clientId}: ${why}`);
      await fetch(`${COSIGNER_URL}/recovery/alerts`, {
        method: 'POST',
        headers: internalHeaders(),
        // Stored by the co-signer in the client's activity log: both languages, picked when read.
        body: JSON.stringify({
          clientId: s.clientId,
          riskScore,
          message: `The recovery partner refused an attempt (${why}).`,
          messageFr: `Le partenaire de récupération a refusé une tentative (${whyFr}).`,
        }),
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
    if (!a) throw new HttpError(404, t('Unknown attestation', 'Attestation inconnue'));
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

listenService(app, PORTS.partner, 'recovery-partner (MOCK trustee)');
