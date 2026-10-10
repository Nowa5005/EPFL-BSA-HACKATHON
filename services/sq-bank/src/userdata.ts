// Per-client market user data (MOCK Swissquote back end): watchlist and alerts, persisted in data/userdata.json,
// plus the periodic alert evaluator. All routes live under /clients/:id/... so the shared auth middleware covers them.
//
// Alerts are evaluated by THIS server process every ALERT_EVAL_MS (default 60 s) while it runs, with prices from
// the market-data service (which caches provider responses, so we do not hit the providers more often than it allows).
// Notifications are in-app only: triggers are recorded here and shown in the Alerts tab. No e-mail / push / SMS.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express, NextFunction, Request, Response } from 'express';
import { internalHeaders, JsonStore, newId, nowIso } from '@sq/shared/server';
import { parseLang, pick } from '@sq/shared';
import { evaluateRule, initialState, INSTRUMENT_ID_RE, parseRule, zurichLocalToUtc, type AlertRule, type EvalState, type EvalTrigger } from './alertsEval';

const MARKET_URL = process.env.MARKET_URL ?? 'http://localhost:4004';
const DATA_DIR = process.env.BANK_DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const EVAL_MS = Math.max(5_000, Number(process.env.ALERT_EVAL_MS) || 60_000);
const WATCHLIST_MAX = 50;
const ALERTS_MAX = 30;
const TRIGGERS_KEPT = 50;

export interface WatchItem {
  instrumentId: string;
  addedAt: string;
  name?: string;
  symbol?: string;
}
export interface AlertTriggerRecord extends EvalTrigger {
  id: string;
  at: string;
  seen: boolean;
}
export interface AlertRecord {
  id: string;
  rule: AlertRule;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  fromExample?: string;
  state: EvalState;
  triggers: AlertTriggerRecord[]; // newest first, only real evaluations
}
interface UserDataDb {
  clients: Record<string, { watchlist: WatchItem[]; alerts: AlertRecord[] }>;
  evaluator: { lastRunAt?: string; lastError?: string };
}

const store = new JsonStore<UserDataDb>(DATA_DIR, 'userdata', () => ({ clients: {}, evaluator: {} }));

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Fetch from market-data. */
async function market<T>(p: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  try {
    // market-data GETs are public; the internal token identifies this service anyway (shared convention).
    const res = await fetch(MARKET_URL + p, { headers: internalHeaders(), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0 };
  }
}

const publicStatus = (a: AlertRecord) => (!a.enabled ? 'inactive' : a.state.armed ? 'active' : 'triggered');
const view = (a: AlertRecord) => ({
  ...a,
  status: publicStatus(a),
  lastTriggeredAt: a.triggers[0]?.at ?? null,
  unseen: a.triggers.filter((t) => !t.seen).length,
});

// ───────────── Evaluation ─────────────

let running = false;
/** Evaluates the enabled alerts of every client (or of one client) once. */
export async function evaluateAlerts(onlyClient?: string, now = new Date()) {
  if (running) return { skipped: true };
  running = true;
  try {
    const targets: { clientId: string; alert: AlertRecord }[] = [];
    for (const [clientId, c] of Object.entries(store.data.clients)) {
      if (onlyClient && clientId !== onlyClient) continue;
      for (const a of c.alerts) if (a.enabled) targets.push({ clientId, alert: structuredClone(a) });
    }
    if (!targets.length) {
      store.update((d) => (d.evaluator = { lastRunAt: now.toISOString() }));
      return { evaluated: 0, fired: 0 };
    }

    const ids = [...new Set(targets.map((t) => t.alert.rule).filter((r) => r.type !== 'reminder').map((r) => r.instrumentId!))];
    const quotes = new Map<string, { price: number; asOf: string }>();
    for (let i = 0; i < ids.length; i += 25) {
      const r = await market<{ quotes: { id: string; price: number; asOf: string }[] }>(`/quotes?ids=${encodeURIComponent(ids.slice(i, i + 25).join(','))}`);
      if (r.ok) for (const q of r.data.quotes) quotes.set(q.id, { price: q.price, asOf: q.asOf });
    }
    const histories = new Map<string, { points: { t: number; v: number }[] } | null>();
    for (const t of targets) {
      const r = t.alert.rule;
      if (r.type !== 'change-pct') continue;
      const key = `${r.instrumentId}|${r.period}`;
      if (histories.has(key)) continue;
      const h = await market<{ points: { t: number; v: number }[] }>(`/history/${encodeURIComponent(r.instrumentId)}?range=${r.period}`);
      histories.set(key, h.ok ? h.data : null);
    }

    let fired = 0;
    store.update((d) => {
      for (const { clientId, alert } of targets) {
        const live = d.clients[clientId]?.alerts.find((x) => x.id === alert.id);
        // edited, disabled or deleted while we were fetching: skip this round
        if (!live || !live.enabled || live.updatedAt !== alert.updatedAt) continue;
        const r = live.rule;
        const res = evaluateRule(
          r,
          {
            now,
            quote: r.type === 'reminder' ? undefined : (quotes.get(r.instrumentId) ?? null),
            history: r.type === 'change-pct' ? histories.get(`${r.instrumentId}|${r.period}`) : undefined,
          },
          live.state,
        );
        live.state = res.state;
        if (res.trigger) {
          fired++;
          live.triggers.unshift({ id: newId(), at: now.toISOString(), seen: false, ...res.trigger });
          live.triggers = live.triggers.slice(0, TRIGGERS_KEPT);
          console.log(`[bank] alert ${live.id} (${clientId}) triggered: ${res.trigger.detail.en}`);
        }
      }
      d.evaluator.lastRunAt = now.toISOString();
      d.evaluator.lastError = quotes.size || !ids.length ? undefined : 'market-data unavailable';
    });
    return { evaluated: targets.length, fired };
  } finally {
    running = false;
  }
}

// ───────────── Routes ─────────────

export function registerUserData(app: Express, clientExists: (id: string) => boolean) {
  const route = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve()
      .then(() => fn(req, res))
      .then((r) => !res.headersSent && res.json(r ?? { ok: true }))
      .catch((e) => (e instanceof HttpError ? res.status(e.status).json({ error: e.message }) : next(e)));
  const lang = (req: Request) => parseLang(req.header('x-lang'));
  const err = (req: Request, status: number, en: string, fr: string) => new HttpError(status, pick(lang(req), en, fr));

  const data = (req: Request) => {
    const id = String(req.params.id);
    if (!clientExists(id)) throw err(req, 404, 'Unknown client', 'Client inconnu');
    return store.data.clients[id] ?? { watchlist: [], alerts: [] };
  };
  const mutate = <R>(req: Request, fn: (c: { watchlist: WatchItem[]; alerts: AlertRecord[] }) => R): R => {
    data(req);
    const id = String(req.params.id);
    return store.update((d) => fn((d.clients[id] ??= { watchlist: [], alerts: [] })));
  };
  const instrumentId = (req: Request) => {
    const v = String(req.body?.instrumentId ?? '');
    if (!INSTRUMENT_ID_RE.test(v)) throw err(req, 400, 'Invalid instrument id (expected yf:… or cg:…)', 'Identifiant d’instrument invalide (attendu yf:… ou cg:…)');
    return v;
  };

  // ── Watchlist ──
  app.get('/clients/:id/watchlist', route((req) => ({ items: data(req).watchlist, max: WATCHLIST_MAX })));

  app.post(
    '/clients/:id/watchlist',
    route(async (req) => {
      const iid = instrumentId(req);
      const current = data(req).watchlist;
      if (current.some((w) => w.instrumentId === iid)) return { items: current, added: false };
      if (current.length >= WATCHLIST_MAX) throw err(req, 400, `Watchlist is full (${WATCHLIST_MAX} instruments max)`, `Watchlist pleine (${WATCHLIST_MAX} instruments max)`);
      // Check the instrument exists (best effort: if market-data is down we still accept a well-formed id).
      const q = await market<{ name: string; symbol: string }>(`/quote/${encodeURIComponent(iid)}`);
      if (!q.ok && q.status === 404) throw err(req, 400, 'Unknown instrument', 'Instrument inconnu');
      const items = mutate(req, (c) => {
        if (!c.watchlist.some((w) => w.instrumentId === iid)) c.watchlist.push({ instrumentId: iid, addedAt: nowIso(), ...(q.ok ? { name: q.data.name, symbol: q.data.symbol } : {}) });
        return c.watchlist;
      });
      return { items, added: true };
    }),
  );

  app.post(
    '/clients/:id/watchlist/remove',
    route((req) => {
      const iid = instrumentId(req);
      return { items: mutate(req, (c) => (c.watchlist = c.watchlist.filter((w) => w.instrumentId !== iid))), removed: true };
    }),
  );

  // ── Alerts ──
  const evaluator = () => ({ intervalMs: EVAL_MS, lastRunAt: store.data.evaluator.lastRunAt ?? null, lastError: store.data.evaluator.lastError ?? null, channel: 'in-app' as const });
  const list = (req: Request) => ({ alerts: data(req).alerts.map(view), evaluator: evaluator(), max: ALERTS_MAX });
  const rule = (req: Request) => {
    const r = parseRule(req.body?.rule);
    if (typeof r === 'string') throw err(req, 400, `Invalid alert: ${r}`, `Alerte invalide : ${r}`);
    if (r.type === 'reminder' && zurichLocalToUtc(r.at)!.getTime() < Date.now() - 60_000)
      throw err(req, 400, 'The reminder date and time are in the past', 'La date et l’heure du rappel sont passées');
    return r;
  };
  const find = (req: Request, c: { alerts: AlertRecord[] }) => {
    const a = c.alerts.find((x) => x.id === String(req.params.alertId));
    if (!a) throw err(req, 404, 'Alert not found', 'Alerte introuvable');
    return a;
  };

  app.get('/clients/:id/alerts', route(list));

  app.post(
    '/clients/:id/alerts',
    route((req) => {
      const r = rule(req);
      const fromExample = typeof req.body?.fromExample === 'string' ? req.body.fromExample.slice(0, 40) : undefined;
      const created = mutate(req, (c) => {
        if (c.alerts.length >= ALERTS_MAX) throw err(req, 400, `Too many alerts (${ALERTS_MAX} max)`, `Trop d’alertes (${ALERTS_MAX} max)`);
        const a: AlertRecord = { id: newId(), rule: r, enabled: req.body?.enabled !== false, createdAt: nowIso(), updatedAt: nowIso(), ...(fromExample ? { fromExample } : {}), state: initialState(), triggers: [] };
        c.alerts.unshift(a);
        return a;
      });
      return view(created);
    }),
  );

  app.post(
    '/clients/:id/alerts/:alertId/update',
    route((req) => {
      const r = rule(req);
      // A changed rule starts a fresh evaluation (re-armed); its past triggers stay as history.
      return view(mutate(req, (c) => Object.assign(find(req, c), { rule: r, state: initialState(), updatedAt: nowIso() })));
    }),
  );

  for (const [action, enabled] of [['enable', true], ['disable', false]] as const)
    app.post(
      `/clients/:id/alerts/:alertId/${action}`,
      route((req) => view(mutate(req, (c) => Object.assign(find(req, c), { enabled, updatedAt: nowIso(), ...(enabled ? { state: { ...find(req, c).state, status: 'never-evaluated' } } : {}) })))),
    );

  app.post(
    '/clients/:id/alerts/:alertId/delete',
    route((req) => {
      mutate(req, (c) => {
        find(req, c);
        c.alerts = c.alerts.filter((x) => x.id !== String(req.params.alertId));
      });
      return { deleted: true };
    }),
  );

  app.post(
    '/clients/:id/alerts/seen',
    route((req) => {
      mutate(req, (c) => c.alerts.forEach((a) => a.triggers.forEach((t) => (t.seen = true))));
      return list(req);
    }),
  );

  // Development / test helper: run this client's evaluation immediately (same code path as the timer).
  if (process.env.NODE_ENV !== 'production')
    app.post(
      '/clients/:id/alerts/evaluate-now',
      route(async (req) => {
        data(req);
        const r = await evaluateAlerts(String(req.params.id));
        return { ...r, ...list(req) };
      }),
    );

  const timer = setInterval(() => void evaluateAlerts().catch((e) => console.error('[bank] alert evaluation failed', e)), EVAL_MS);
  timer.unref();
  console.log(`[bank] alert evaluator: every ${EVAL_MS / 1000} s (in-app notifications only)`);
}
