// Terms of Use (spec N4): versioned texts, per-client acceptances, publication of new versions by compliance.
//
// - The full texts are the Markdown files of docs/legal/ (single source, English; the French annex stays in docs).
//   The 5-point summary and the change summary are stored here in both languages (`xFr` twins, folded by
//   localizeResponses according to the request language).
// - A client must accept the latest SUBSTANTIVE published version before using the wallet; a non-substantive
//   version is announced for information only (no new acceptance).
// - Acceptance record: version, timestamp, device label (sent by the app) and a truncated SHA-256 of the user
//   agent (never the raw user agent), plus the language the screen was shown in.
// - Routes live under /clients/:id/terms… (the shared guard only lets a client token reach its own id) and
//   /admin/terms… (compliance role only).

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Express, NextFunction, Request, Response } from 'express';
import { JsonStore, nowIso, t } from '@sq/shared/server';

export interface TermsVersion {
  version: string;
  /** Date printed on the document (DD.MM.YYYY). */
  docDate: string;
  file: string; // Markdown file in the texts directory
  title: string;
  titleFr: string;
  summary: string[];
  summaryFr: string[];
  /** What changed compared with the previous version (empty for the first one). */
  changeSummary: string[];
  changeSummaryFr: string[];
  substantive: boolean;
  /** Published from the start (the first version); later versions wait for a compliance officer. */
  initial?: boolean;
}

const SUMMARY_V1: Pick<TermsVersion, 'summary' | 'summaryFr'> = {
  summary: [
    'You stay in control of your funds: your wallet needs 2 keys out of 3, and Swissquote holds only one. Swissquote can never move your funds on its own.',
    'You look after your secrets: your device and password, your paper recovery code and your physical security key. Swissquote cannot read or reset them.',
    'Swissquote co-signs by published rules and explains every refusal. If it refuses or is unavailable, the protected exit lets you move your funds after a 48-hour on-chain delay.',
    'Clear fees: a commission only on exchanges (0.80 % on Free, less with Plus or Pro). Network fees are paid by Swissquote within a daily quota of 20 transactions.',
    'Crypto-assets carry risk: prices move and a confirmed transaction cannot be reversed. This prototype runs on the Sepolia test network: nothing has real value.',
  ],
  summaryFr: [
    'Vous gardez le contrôle de vos fonds : votre wallet exige 2 clés sur 3, et Swissquote n’en détient qu’une. Swissquote ne peut jamais déplacer vos fonds seul.',
    'Vous protégez vos secrets : votre appareil et votre mot de passe, votre code de récupération papier et votre clé de sécurité physique. Swissquote ne peut ni les lire ni les réinitialiser.',
    'Swissquote co-signe selon des règles publiées et motive chaque refus. S’il refuse ou est indisponible, la sortie protégée vous permet de déplacer vos fonds après un délai on-chain de 48 heures.',
    'Des frais clairs : une commission uniquement sur les échanges (0,80 % avec Free, moins avec Plus ou Pro). Les frais de réseau sont payés par Swissquote dans un quota de 20 transactions par jour.',
    'Les crypto-actifs comportent des risques : les cours varient et une transaction confirmée est irréversible. Ce prototype fonctionne sur le réseau de test Sepolia : rien n’a de valeur réelle.',
  ],
};

export const TERMS_CATALOG: TermsVersion[] = [
  {
    version: '1.0',
    docDate: '10.10.2026',
    file: 'TERMS_v1.0.md',
    title: 'My Wall Terms of Use',
    titleFr: 'Conditions d’utilisation de My Wall',
    ...SUMMARY_V1,
    changeSummary: [],
    changeSummaryFr: [],
    substantive: true,
    initial: true,
  },
  {
    // DEMO update, unpublished until a compliance officer publishes it from the console.
    version: '1.1',
    docDate: '10.10.2026',
    file: 'TERMS_v1.1.md',
    title: 'My Wall Terms of Use',
    titleFr: 'Conditions d’utilisation de My Wall',
    summary: SUMMARY_V1.summary.map((s, i) => (i === 3 ? 'Clear fees: a commission only on exchanges (0.80 % on Free, less with Plus or Pro). Network fees are paid by Swissquote within a daily quota: 10 transactions on Free, 20 on Plus and Pro (from 10.11.2026).' : s)),
    summaryFr: SUMMARY_V1.summaryFr.map((s, i) => (i === 3 ? 'Des frais clairs : une commission uniquement sur les échanges (0,80 % avec Free, moins avec Plus ou Pro). Les frais de réseau sont payés par Swissquote dans un quota journalier : 10 transactions avec Free, 20 avec Plus et Pro (dès le 10.11.2026).' : s)),
    changeSummary: [
      'Sponsored network fees (section 10.2): on the Free plan, Swissquote now pays the network fees of 10 transactions per day instead of 20. Plus and Pro keep 20 per day. Applies from 10.11.2026.',
      'The 5-point summary (point 4) is updated accordingly.',
      'Veto (section 5.2): wording clarified — you can cancel a pending operation at any time until the end of the delay. No change to your rights.',
    ],
    changeSummaryFr: [
      'Frais de réseau offerts (section 10.2) : avec l’offre Free, Swissquote paie désormais les frais de 10 transactions par jour au lieu de 20. Plus et Pro gardent 20 par jour. Dès le 10.11.2026.',
      'Le résumé en 5 points (point 4) est mis à jour en conséquence.',
      'Veto (section 5.2) : formulation précisée — vous pouvez annuler une opération en attente à tout moment jusqu’à la fin du délai. Aucun changement de vos droits.',
    ],
    substantive: true,
  },
];

export interface TermsAcceptance {
  version: string;
  acceptedAt: string;
  deviceLabel: string;
  userAgentHash: string | null;
  lang: 'en' | 'fr';
}
interface TermsDb {
  published: Record<string, { publishedAt: string; by: string }>;
  clients: Record<string, { acceptances: TermsAcceptance[] }>;
}
export type TermsState = TermsDb;

export const initialTermsState = (catalog: TermsVersion[], at = '2026-10-10T08:00:00.000Z'): TermsState => ({
  published: Object.fromEntries(catalog.filter((v) => v.initial).map((v) => [v.version, { publishedAt: at, by: 'initial' }])),
  clients: {},
});

const meta = (v: TermsVersion, s: TermsState) => {
  const { file: _f, initial: _i, ...rest } = v;
  return { ...rest, published: !!s.published[v.version], publishedAt: s.published[v.version]?.publishedAt ?? null };
};

/** Pure: what the client must see (current version, acceptance needed or not, updates to announce). */
export function termsStatus(catalog: TermsVersion[], s: TermsState, clientId: string) {
  const published = catalog.filter((v) => s.published[v.version]); // catalog order = version order
  const current = published[published.length - 1] ?? null;
  const idx = (ver: string) => catalog.findIndex((v) => v.version === ver);
  const requiredIdx = Math.max(-1, ...published.filter((v) => v.substantive).map((v) => idx(v.version)));
  const acceptances = s.clients[clientId]?.acceptances ?? [];
  const accepted = acceptances.length ? acceptances.reduce((a, b) => (idx(b.version) > idx(a.version) || (idx(b.version) === idx(a.version) && b.acceptedAt > a.acceptedAt) ? b : a)) : null;
  const acceptedIdx = accepted ? idx(accepted.version) : -1;
  const needsAcceptance = !!current && acceptedIdx < requiredIdx;
  return {
    current: current ? meta(current, s) : null,
    accepted,
    acceptances,
    needsAcceptance,
    reason: needsAcceptance ? (accepted ? ('updated' as const) : ('first' as const)) : null,
    // Newer than what the client accepted but not requiring acceptance (non-substantive): information only.
    infoOnly: !needsAcceptance && !!current && acceptedIdx >= 0 && idx(current.version) > acceptedIdx,
    // Every published version after the first, newest first: shown in Information → My Wall updates.
    updates: published
      .filter((v) => !v.initial)
      .reverse()
      .map((v) => ({ ...meta(v, s), acceptedByYou: acceptances.some((a) => a.version === v.version) })),
  };
}

export class TermsError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Pure: records an acceptance of the CURRENT version (throws a TermsError otherwise). */
export function acceptTerms(catalog: TermsVersion[], s: TermsState, clientId: string, body: { version?: unknown; accept?: unknown; deviceLabel?: unknown; lang?: unknown }, userAgent: string | undefined, now = nowIso()): TermsAcceptance {
  const st = termsStatus(catalog, s, clientId);
  if (body.accept !== true) throw new TermsError(400, t('Tick “I have read and accept” to continue.', 'Cochez « J’ai lu et j’accepte » pour continuer.'));
  if (!st.current || body.version !== st.current.version)
    throw new TermsError(409, t('These terms are no longer the current version. Please reload and read the current version.', 'Ces conditions ne sont plus la version en vigueur. Rechargez et lisez la version actuelle.'));
  const a: TermsAcceptance = {
    version: st.current.version,
    acceptedAt: now,
    deviceLabel: String(body.deviceLabel ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || t('Unknown device', 'Appareil inconnu'),
    userAgentHash: userAgent ? createHash('sha256').update(userAgent).digest('hex').slice(0, 16) : null,
    lang: body.lang === 'fr' ? 'fr' : 'en',
  };
  (s.clients[clientId] ??= { acceptances: [] }).acceptances.push(a);
  return a;
}

/** Pure: publishes a draft version (compliance). */
export function publishTerms(catalog: TermsVersion[], s: TermsState, version: unknown, by: string, now = nowIso()) {
  const v = catalog.find((x) => x.version === version);
  if (!v) throw new TermsError(404, t('Unknown terms version', 'Version des conditions inconnue'));
  if (s.published[v.version]) throw new TermsError(409, t(`Version ${v.version} is already published.`, `La version ${v.version} est déjà publiée.`));
  const idx = catalog.indexOf(v);
  if (catalog.slice(idx + 1).some((x) => s.published[x.version])) throw new TermsError(409, t('A newer version is already published.', 'Une version plus récente est déjà publiée.'));
  s.published[v.version] = { publishedAt: now, by };
  return meta(v, s);
}

/** Pure: demo replay — unpublishes the later versions and forgets their acceptances. */
export function resetTermsDemo(catalog: TermsVersion[], s: TermsState) {
  const keep = new Set(catalog.filter((v) => v.initial).map((v) => v.version));
  for (const ver of Object.keys(s.published)) if (!keep.has(ver)) delete s.published[ver];
  for (const c of Object.values(s.clients)) c.acceptances = c.acceptances.filter((a) => keep.has(a.version));
}

type Route = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => void;

export interface TermsServiceOptions {
  dataDir: string;
  catalog?: TermsVersion[];
  /** Directory of the Markdown texts (default: docs/legal of the repo). */
  textDir?: string;
  /** Maps a TermsError to the service's own HTTP error class (so its error handler answers the status). */
  httpError?: new (status: number, message: string) => Error;
}

export function createTermsService(opts: TermsServiceOptions) {
  const catalog = opts.catalog ?? TERMS_CATALOG;
  const textDir = opts.textDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'legal');
  const store = new JsonStore<TermsDb>(opts.dataDir, 'terms', () => initialTermsState(catalog));
  const texts = new Map<string, string>();
  const textOf = (v: TermsVersion) => {
    if (!texts.has(v.version)) texts.set(v.version, fs.readFileSync(path.join(textDir, v.file), 'utf8'));
    return texts.get(v.version)!;
  };
  const wrap = <R>(fn: () => R): R => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof TermsError && opts.httpError) throw new opts.httpError(e.status, e.message);
      throw e;
    }
  };
  const principalName = (req: Request) => String((req as any).principal?.sub ?? 'compliance');

  function register(app: Express, route: Route) {
    app.get(
      '/clients/:id/terms',
      route((req) => {
        const st = termsStatus(catalog, store.data, String(req.params.id));
        const cur = st.current && catalog.find((v) => v.version === st.current!.version)!;
        return { ...st, text: cur ? textOf(cur) : null, textLang: 'en' };
      }),
    );
    app.get(
      '/clients/:id/terms/versions/:version',
      route((req) => {
        const v = catalog.find((x) => x.version === String(req.params.version));
        if (!v || !store.data.published[v.version]) return wrap(() => { throw new TermsError(404, t('Unknown terms version', 'Version des conditions inconnue')); });
        return { ...meta(v, store.data), text: textOf(v), textLang: 'en' };
      }),
    );
    app.post(
      '/clients/:id/terms/accept',
      route((req) => {
        const id = String(req.params.id);
        const a = wrap(() => store.update((d) => acceptTerms(catalog, d, id, req.body ?? {}, req.header('user-agent'))));
        return { accepted: a, status: termsStatus(catalog, store.data, id) };
      }),
    );
    app.get(
      '/admin/terms',
      route(() => {
        const counts: Record<string, number> = {};
        for (const c of Object.values(store.data.clients)) for (const v of new Set(c.acceptances.map((a) => a.version))) counts[v] = (counts[v] ?? 0) + 1;
        return { versions: catalog.map((v) => ({ ...meta(v, store.data), acceptedBy: counts[v.version] ?? 0 })) };
      }),
    );
    app.post(
      '/admin/terms/publish',
      route((req) => wrap(() => store.update((d) => publishTerms(catalog, d, req.body?.version, principalName(req))))),
    );
    app.post(
      '/admin/terms/reset-demo',
      route(() => {
        store.update((d) => resetTermsDemo(catalog, d));
        return { reset: true };
      }),
    );
  }

  return {
    register,
    store,
    /** Global demo reset: back to the initial publication, no acceptances. */
    reset: () => store.update((d) => Object.assign(d, initialTermsState(catalog))),
    /** Per-client demo reset: forget this client's acceptances. */
    resetClient: (clientId: string) => store.update((d) => void delete d.clients[clientId]),
  };
}
