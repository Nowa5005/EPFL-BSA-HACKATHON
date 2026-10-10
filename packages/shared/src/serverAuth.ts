// Service authentication, CORS allow-list and CSRF defences shared by every HTTP service (node only).
//
// Model (see docs/THREAT_MODEL.md, "Service authentication, CORS & CSRF"):
// - Browser → service: a short-lived session token issued by sq-bank at login, sent as `Authorization: Bearer …`.
//   It is HMAC-SHA256 signed (node:crypto, standard primitive) with SESSION_SIGNING_KEY, so the three services
//   verify it without a shared session store. Claims: sub (client id), role ('client' | 'compliance'), iat, exp,
//   jti and an optional `fresh` flag (password re-entered less than 5 minutes ago).
// - The token is NOT a cookie: browsers never attach it automatically to cross-site requests, so classic CSRF
//   (a hostile page making the victim's browser send an authenticated request) does not apply. Defence in depth
//   anyway: state-changing requests must be `application/json` (an HTML form cannot send that) and any request
//   whose Origin is not on the allow-list is refused before any handler runs.
// - Service → service (and the dev scripts): `x-internal-token: INTERNAL_API_TOKEN`. An Origin header is never
//   treated as an identity; a request carrying an Origin cannot use the internal token (browsers are not services).
// - Authorisation is DEFAULT-DENY: only the routes a service lists as public are reachable without a token; every
//   other route needs a session, and a client token may only touch its own client id (path /clients/:id/…, body
//   or query `clientId`, or the owner of the resource resolved by the service). /admin/* needs the compliance role.

import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { pick, parseLang, LANG_HEADER } from './i18n';
import { langOfReq, runWithLang } from './requestLang';

export const isProduction = () => process.env.NODE_ENV === 'production';

// ───────────────────────────── Secrets (generated in dev, required in production) ─────────────────────────────

/** Root .env of the repo (same file loadDotenv() reads when services run from their workspace). */
export const envFilePath = () => process.env.ENV_FILE ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env');

function firstValueInFile(file: string, name: string): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === name) {
      const v = m[2].replace(/^['"]|['"]$/g, '');
      if (v) return v;
    }
  }
  return undefined;
}

/**
 * Returns the secret `name` from the environment. In development, if it is missing it is generated (256 random
 * bits) and appended to the git-ignored root .env (mode 600); its value is never logged. Several services may start
 * at the same time: after appending we re-read the file and keep the FIRST value, so they all agree on one secret.
 * In production a missing secret is a start-up error (it must come from the secret store). Never overwrites a value.
 */
export function ensureSecret(name: string, purpose: string): string {
  const existing = process.env[name];
  if (existing && existing.length >= 32) return existing;
  if (existing) throw new Error(`${name} is too short (min 32 characters)`);
  if (isProduction()) throw new Error(`${name} must be provided by the secret store in production`);
  const file = envFilePath();
  let value = firstValueInFile(file, name);
  if (!value) {
    const generated = randomBytes(32).toString('base64url');
    fs.appendFileSync(file, `\n# Generated on ${new Date().toISOString()} — ${purpose}\n${name}=${generated}\n`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    value = firstValueInFile(file, name) ?? generated;
    console.log(`[auth] ${name} generated and stored in ${path.basename(file)} (git-ignored)`);
  }
  if (value.length < 32) throw new Error(`${name} is too short (min 32 characters)`);
  process.env[name] = value;
  return value;
}

const signingKey = () => ensureSecret('SESSION_SIGNING_KEY', 'HMAC key of the session tokens (sq-bank issues, all services verify).');
const internalToken = () => ensureSecret('INTERNAL_API_TOKEN', 'service-to-service token (x-internal-token) for the services and dev scripts.');

/** Fails fast at start-up (production: missing secrets; dev: generates them before the first request). */
export function initAuthSecrets() {
  signingKey();
  internalToken();
  allowedOrigins();
}

// ───────────────────────────── Session tokens ─────────────────────────────

export type Role = 'client' | 'compliance';
export interface SessionClaims {
  v: 1;
  sub: string; // client id (or 'compliance:<user>' for the console)
  role: Role;
  iat: number; // seconds
  exp: number; // seconds
  jti: string;
  fresh?: boolean; // password re-entered recently (short-lived token)
}

export const SESSION_TTL_SEC = { client: 12 * 3600, compliance: 8 * 3600, fresh: 5 * 60 } as const;

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const mac = (payload: string) => createHmac('sha256', signingKey()).update(`sqsess.v1.${payload}`).digest();

export function issueToken(c: { sub: string; role: Role; fresh?: boolean }, ttlSec?: number): string {
  const now = Math.floor(Date.now() / 1000);
  const ttl = ttlSec ?? (c.fresh ? SESSION_TTL_SEC.fresh : SESSION_TTL_SEC[c.role]);
  const claims: SessionClaims = { v: 1, sub: c.sub, role: c.role, iat: now, exp: now + ttl, jti: randomUUID(), ...(c.fresh ? { fresh: true } : {}) };
  const payload = b64(JSON.stringify(claims));
  return `${payload}.${b64(mac(payload))}`;
}

/** Returns the claims of a valid, unexpired token signed with our key — otherwise null. */
export function verifyToken(token: string | undefined | null): SessionClaims | null {
  if (!token || typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  const expected = mac(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let c: SessionClaims;
  try {
    c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (c?.v !== 1 || typeof c.sub !== 'string' || !c.sub || (c.role !== 'client' && c.role !== 'compliance')) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof c.exp !== 'number' || c.exp <= now || typeof c.iat !== 'number' || c.iat > now + 60) return null;
  return c;
}

// ───────────────────────────── Internal (service-to-service) token ─────────────────────────────

export const INTERNAL_HEADER = 'x-internal-token';

/** Headers for a call from one of our services (or a dev script) to another one. */
export const internalHeaders = (): Record<string, string> => ({ 'content-type': 'application/json', [INTERNAL_HEADER]: internalToken() });

const digest = (s: string) => createHash('sha256').update(s).digest();
const isInternalToken = (v: unknown) => typeof v === 'string' && v.length > 0 && timingSafeEqual(digest(v), digest(internalToken()));

// ───────────────────────────── CORS allow-list ─────────────────────────────

/** Web app (Vite dev) + Capacitor app origins (iOS: capacitor://localhost, Android: http(s)://localhost). */
export const DEFAULT_DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'capacitor://localhost', 'http://localhost', 'https://localhost'];

export function allowedOrigins(): Set<string> {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw?.trim()) {
    if (isProduction()) throw new Error('ALLOWED_ORIGINS must be set explicitly in production');
    return new Set(DEFAULT_DEV_ORIGINS);
  }
  const list = raw.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  if (list.some((o) => o === '*' || o === 'null')) throw new Error('ALLOWED_ORIGINS must list explicit origins (no "*" or "null")');
  return new Set(list);
}

const ALLOWED_METHODS = 'GET, POST, OPTIONS';
const ALLOWED_HEADERS = `content-type, authorization, ${LANG_HEADER}`;

// ───────────────────────────── Route rules ─────────────────────────────

/** [method or '*', pattern]. Pattern segments: literal, ':param', or a final '*' (any suffix). Case-insensitive. */
export type RouteRule = [string, string];

export const segmentsOf = (p: string) =>
  p
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });

export function matchRoute(rule: RouteRule, method: string, p: string): Record<string, string> | null {
  const [m, pattern] = rule;
  const meth = method === 'HEAD' ? 'GET' : method;
  if (m !== '*' && m.toUpperCase() !== meth) return null;
  const want = segmentsOf(pattern);
  const got = segmentsOf(p);
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i] === '*') return params;
    if (i >= got.length) return null;
    if (want[i].startsWith(':')) params[want[i].slice(1)] = got[i];
    else if (want[i].toLowerCase() !== got[i].toLowerCase()) return null;
  }
  return got.length === want.length ? params : null;
}
const matchAny = (rules: RouteRule[], method: string, p: string) => rules.some((r) => matchRoute(r, method, p));

/** Demo-only routes: POST only, and they do not exist at all when NODE_ENV=production. */
export const DEMO_RESET_ROUTES = { global: '/admin/reset', client: '/admin/clients/:id/reset', testSession: '/admin/test-session' } as const;

// ───────────────────────────── Middleware ─────────────────────────────

export interface Principal {
  kind: 'client' | 'compliance' | 'internal' | 'anonymous';
  sub?: string;
  fresh?: boolean;
  claims?: SessionClaims;
}

export interface SecurityOptions {
  service: string;
  /** Reachable without any credential (health, public config, catalogues, login…). Keep this list short. */
  publicRoutes?: RouteRule[];
  /** Any valid session, no client-id check (e.g. bank /reauth acts on the token's own subject). */
  sessionRoutes?: RouteRule[];
  /** Only other services / dev scripts (x-internal-token). */
  internalRoutes?: RouteRule[];
  /**
   * Owner of the resource addressed by routes that do not carry the client id themselves (e.g. /tx/:id).
   * Return the owner's client id, `null` if the resource does not exist (→ 404), or `undefined` if not applicable.
   */
  owner?: (req: Request) => string | null | undefined;
}

export const principalOf = (req: Request): Principal => (req as any).principal ?? { kind: 'anonymous' };

function fail(req: Request, res: Response, status: number, code: string, en: string, fr: string) {
  res.status(status).json({ error: pick(parseLang(req.header(LANG_HEADER)), en, fr), code });
}

/**
 * Returns the two middlewares to install, in this order, BEFORE any route:
 *   app.use(sec.edge); app.use(express.json(...)); app.use(sec.guard);
 * `edge` = Origin allow-list, CORS + preflight, method and Content-Type checks (no body needed).
 * `guard` = authentication + default-deny authorisation (needs the parsed body for `clientId`).
 */
export function createSecurity(opts: SecurityOptions): { edge: RequestHandler; guard: RequestHandler } {
  initAuthSecrets();
  const origins = allowedOrigins();
  const publicRoutes = opts.publicRoutes ?? [];
  const sessionRoutes = opts.sessionRoutes ?? [];
  const internalRoutes = opts.internalRoutes ?? [];

  const edge: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!origins.has(origin)) return fail(req, res, 403, 'origin-not-allowed', 'Origin not allowed.', 'Origine non autorisée.');
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      if (origin !== undefined) {
        res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
        res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
        res.setHeader('Access-Control-Max-Age', '600');
      }
      return res.status(204).end();
    }
    if (!['GET', 'HEAD', 'POST'].includes(req.method)) return fail(req, res, 405, 'method-not-allowed', 'Method not allowed.', 'Méthode non autorisée.');
    if (req.method === 'POST') {
      const ct = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (ct !== 'application/json')
        return fail(req, res, 415, 'json-required', 'Requests that change state must be sent as application/json.', 'Les requêtes qui modifient des données doivent être envoyées en application/json.');
    }
    next();
  };

  // Every route handler runs inside the request language (x-lang) so t(en, fr) works anywhere below.
  // Installed in the guard (after express.json): body parsing is stream-based and would lose the context.
  const guard: RequestHandler = (req: Request, res: Response, next: NextFunction) => runWithLang(langOfReq(req), () => guardInner(req, res, next));

  const guardInner = (req: Request, res: Response, next: NextFunction) => {
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const p = req.path;
    const deny = (status: number, code: string, en: string, fr: string) => fail(req, res, status, code, en, fr);

    // 1. Demo reset routes: never in production, never via GET.
    const isGlobalReset = !!matchRoute(['*', DEMO_RESET_ROUTES.global], method, p);
    const clientReset = matchRoute(['*', DEMO_RESET_ROUTES.client], method, p);
    const isTestSession = !!matchRoute(['*', DEMO_RESET_ROUTES.testSession], method, p);
    if (isGlobalReset || clientReset || isTestSession) {
      if (isProduction()) return deny(404, 'not-found', 'Not found.', 'Introuvable.');
      if (method !== 'POST') return deny(405, 'method-not-allowed', 'Use POST.', 'Utilisez POST.');
    }

    // 2. Public routes: no credential considered at all.
    if (matchAny(publicRoutes, method, p)) return next();

    // 3. Authentication.
    let principal: Principal = { kind: 'anonymous' };
    const internal = req.headers[INTERNAL_HEADER];
    if (internal !== undefined) {
      if (req.headers.origin !== undefined || !isInternalToken(internal)) return deny(401, 'invalid-token', 'Invalid service credential.', 'Identifiant de service invalide.');
      principal = { kind: 'internal' };
    } else {
      const h = String(req.headers.authorization ?? '');
      const m = h.match(/^Bearer\s+(\S+)$/i);
      if (!m) return deny(401, 'auth-required', 'Sign in required.', 'Connexion requise.');
      const claims = verifyToken(m[1]);
      if (!claims) return deny(401, 'invalid-token', 'Your session has expired. Please sign in again.', 'Votre session a expiré. Reconnectez-vous.');
      principal = { kind: claims.role, sub: claims.sub, fresh: !!claims.fresh, claims };
    }
    (req as any).principal = principal;
    if (principal.kind === 'internal') return next(); // trusted service / dev script

    const forbidden = () => deny(403, 'forbidden', 'You are not allowed to do this.', 'Vous n’êtes pas autorisé à effectuer cette action.');

    // 4. Authorisation (default deny).
    if (matchAny(internalRoutes, method, p) || isTestSession) return forbidden();
    if (isGlobalReset) return principal.kind === 'compliance' ? next() : forbidden();
    if (clientReset) {
      if (principal.kind !== 'client' || principal.sub !== clientReset.id) return forbidden();
      if (!principal.fresh) return deny(403, 'reauth-required', 'Please confirm your password again to reset.', 'Confirmez à nouveau votre mot de passe pour réinitialiser.');
      return next();
    }
    if (matchRoute(['*', '/admin/*'], method, p)) return principal.kind === 'compliance' ? next() : forbidden();
    if (matchAny(sessionRoutes, method, p)) return next();
    if (principal.kind !== 'client') return forbidden();

    // Every client id the request refers to must be the token's own.
    const ids: string[] = [];
    const seg = segmentsOf(p);
    if (seg[0]?.toLowerCase() === 'clients' && seg[1]) ids.push(seg[1]);
    for (const src of [req.body, req.query] as Record<string, unknown>[]) {
      if (!src || typeof src !== 'object' || !('clientId' in src) || src.clientId === undefined) continue;
      if (typeof src.clientId !== 'string') return deny(400, 'bad-client-id', 'Invalid clientId.', 'clientId invalide.');
      ids.push(src.clientId);
    }
    const owner = opts.owner?.(req);
    if (owner === null) return deny(404, 'not-found', 'Not found.', 'Introuvable.');
    if (owner !== undefined) ids.push(owner);
    if (!ids.length || ids.some((id) => id !== principal.sub)) return forbidden();
    next();
  };

  return { edge, guard };
}
