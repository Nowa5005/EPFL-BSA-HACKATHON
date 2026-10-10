// Alerts: price above/below, % change over 1D/1W, dated reminders (Europe/Zurich).
// Stored and evaluated by sq-bank (every minute while the demo server runs). In-app notifications only.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bell, BellOff, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Card, cx, Field, fmt, ICON, inputCls, MockBadge, Notice, Skeleton, Spinner } from '../../components/ui';
import { usePoll, useLocal } from '../../lib/hooks';
import { getLang, tr } from '../../lib/i18n';
import { ageLabel, instrumentPath, useQuotes, type Quote } from '../../lib/market';
import { InstrumentSearch } from './InstrumentSearch';
import { zurichDateTime } from './common';
import { alertsApi, type AlertRule, type AlertView, type AlertsPayload } from './userdata';

const fr = () => getLang() === 'fr';
const L = (x: { en: string; fr: string }) => (fr() ? x.fr : x.en);
const num = (n: number) => fmt(n, n < 1 ? 4 : 2);

function describe(rule: AlertRule, q?: Quote) {
  const cur = q ? ` ${q.currency}` : '';
  switch (rule.type) {
    case 'price-above':
      return tr(`Price rises above ${num(rule.threshold)}${cur}`, `Le cours dépasse ${num(rule.threshold)}${cur}`);
    case 'price-below':
      return tr(`Price falls below ${num(rule.threshold)}${cur}`, `Le cours passe sous ${num(rule.threshold)}${cur}`);
    case 'change-pct': {
      const dir = { up: tr('rises by', 'monte de'), down: tr('falls by', 'baisse de'), either: tr('moves by', 'varie de') }[rule.direction];
      const per = rule.period === '1D' ? tr('over 1 day', 'sur 1 jour') : tr('over 1 week', 'sur 1 semaine');
      return tr(`Price ${dir} ${rule.pct} % or more ${per}`, `Le cours ${dir} ${rule.pct} % ou plus ${per}`);
    }
    case 'reminder':
      return tr(`Reminder on ${fmtLocal(rule.at)} (Zurich time)`, `Rappel le ${fmtLocal(rule.at)} (heure de Zurich)`) + (rule.note ? ` — “${rule.note}”` : '');
  }
}
const fmtLocal = (at: string) => {
  const [d, t] = at.split('T');
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y} ${t}`;
};

function StatusBadge({ a }: { a: AlertView }) {
  const s = {
    active: { cls: 'bg-sq-ok-50 text-sq-up', label: tr('Active', 'Active') },
    inactive: { cls: 'bg-sq-chip text-sq-ink-2', label: tr('Inactive', 'Inactive') },
    triggered: { cls: 'bg-sq-warn-50 text-sq-warn', label: tr('Triggered', 'Déclenchée') },
  }[a.status];
  return <span className={cx('inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium', s.cls)}>{s.label}</span>;
}

export default function AlertsTab() {
  const { session } = useLocal();
  const clientId = session?.clientId ?? '';
  const [params, setParams] = useSearchParams();
  const prefill = params.get('new');
  const { data, error, reload } = usePoll(() => alertsApi.list(clientId), 30_000, [clientId]);
  const [view, setView] = useState<{ mode: 'list' } | { mode: 'form'; edit?: AlertView; instrumentId?: string } | { mode: 'detail'; id: string }>(prefill ? { mode: 'form', instrumentId: prefill } : { mode: 'list' });
  const lastCard = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (prefill) setView({ mode: 'form', instrumentId: prefill });
  }, [prefill]);

  const clearPrefill = () => {
    if (!params.has('new')) return;
    const p = new URLSearchParams(params);
    p.delete('new');
    setParams(p, { replace: true });
  };
  const toList = (msg?: string) => {
    clearPrefill();
    setNotice(msg ?? null);
    setView({ mode: 'list' });
    void reload();
  };

  useEffect(() => {
    if (view.mode !== 'list' || !lastCard.current) return;
    document.querySelector<HTMLElement>(`[data-alert-id="${CSS.escape(lastCard.current)}"]`)?.focus();
    lastCard.current = null;
  }, [view.mode]);

  const ids = useMemo(() => [...new Set((data?.alerts ?? []).flatMap((a) => (a.rule.instrumentId ? [a.rule.instrumentId] : [])))], [data]);
  const quotes = useQuotes(ids);
  const quoteOf = (id?: string) => (id ? quotes.data?.quotes.find((q) => q.id === id) : undefined);

  if (!clientId) return null;
  if (error && !data)
    return (
      <Notice tone="bad" className="mt-4" title={tr('Alerts unavailable', 'Alertes indisponibles')}>
        {tr('Your alerts could not be loaded from the server.', 'Vos alertes n’ont pas pu être chargées depuis le serveur.')}{' '}
        <button type="button" className="font-semibold underline" onClick={() => void reload()}>
          {tr('Try again', 'Réessayer')}
        </button>
      </Notice>
    );
  if (!data)
    return (
      <Card className="mt-4 space-y-3">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-14 w-full" />
      </Card>
    );

  if (view.mode === 'form')
    return <AlertForm clientId={clientId} edit={view.edit} instrumentId={view.instrumentId} onCancel={() => toList()} onDone={(m) => toList(m)} />;

  if (view.mode === 'detail') {
    const a = data.alerts.find((x) => x.id === view.id);
    if (!a) return renderList();
    return (
      <AlertDetail
        a={a}
        q={quoteOf(a.rule.instrumentId)}
        clientId={clientId}
        onBack={() => {
          lastCard.current = a.id;
          toList();
        }}
        onEdit={() => setView({ mode: 'form', edit: a })}
        onChanged={() => void reload()}
        onDeleted={() => toList(tr('Alert deleted.', 'Alerte supprimée.'))}
      />
    );
  }
  return renderList();

  function renderList() {
    const unseen = data!.alerts.reduce((n, a) => n + a.unseen, 0);
    return (
      <section aria-label={tr('Alerts', 'Alertes')} className="mt-4 space-y-4">
        <Monitoring ev={data!.evaluator} />
        {notice && (
          <Notice tone="ok" className="mw-toast">
            {notice}
          </Notice>
        )}
        {unseen > 0 && (
          <Notice tone="warn" title={tr(`${unseen} new alert trigger${unseen > 1 ? 's' : ''}`, `${unseen} nouveau${unseen > 1 ? 'x' : ''} déclenchement${unseen > 1 ? 's' : ''}`)}>
            {tr('Open an alert to see when and why it fired.', 'Ouvrez une alerte pour voir quand et pourquoi elle s’est déclenchée.')}{' '}
            <button type="button" className="font-semibold underline" onClick={() => void alertsApi.seen(clientId).then(reload)}>
              {tr('Mark all as seen', 'Tout marquer comme vu')}
            </button>
          </Notice>
        )}
        <Card className="px-0 pb-1 pt-4">
          <div className="flex items-center justify-between gap-2 px-5">
            <h2 className="text-[17px] font-semibold">{tr('My alerts', 'Mes alertes')}</h2>
            <Button className="w-auto min-h-10 px-3 py-1.5 text-[14px]" onClick={() => setView({ mode: 'form' })} disabled={data!.alerts.length >= data!.max}>
              <Plus size={16} aria-hidden /> {tr('Create alert', 'Créer une alerte')}
            </Button>
          </div>
          {data!.alerts.length === 0 ? (
            <p className="px-5 py-4 text-[14px] text-sq-muted">{tr('You have no alert yet.', 'Vous n’avez encore aucune alerte.')}</p>
          ) : (
            <ul className="mt-2">
              {data!.alerts.map((a) => {
                const q = quoteOf(a.rule.instrumentId);
                return (
                  <li key={a.id} className="border-t border-sq-line/60 first:border-t-0">
                    <button type="button" data-alert-id={a.id} onClick={() => setView({ mode: 'detail', id: a.id })} className="flex min-h-[68px] w-full items-center gap-3 px-5 py-3 text-left hover:bg-sq-bg/60">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-[15px] text-sq-ink">
                          <span className="truncate font-medium">{a.rule.type === 'reminder' && !a.rule.instrumentId ? tr('Reminder', 'Rappel') : (q?.name ?? a.rule.instrumentId)}</span>
                          {a.unseen > 0 && <span className="size-2 shrink-0 rounded-full bg-sq-orange" aria-label={tr('new trigger', 'nouveau déclenchement')} />}
                        </span>
                        <span className="block text-[13px] text-sq-ink-2">{describe(a.rule, q)}</span>
                        <span className="block text-[12px] text-sq-muted">
                          {a.lastTriggeredAt ? tr(`Last triggered ${zurichDateTime(a.lastTriggeredAt)}`, `Dernier déclenchement ${zurichDateTime(a.lastTriggeredAt)}`) : tr('Never triggered', 'Jamais déclenchée')}
                          {a.enabled && a.state.status === 'data-unavailable' && ` · ${tr('data unavailable', 'données indisponibles')}`}
                        </span>
                      </span>
                      <StatusBadge a={a} />
                      <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-sq-muted" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        {data!.alerts.length === 0 && <Examples clientId={clientId} onCreated={() => toList(tr('Example activated: it is now a real alert.', 'Exemple activé : c’est maintenant une vraie alerte.'))} />}
      </section>
    );
  }
}

function Monitoring({ ev }: { ev: AlertsPayload['evaluator'] }) {
  const mins = Math.round(ev.intervalMs / 60_000);
  return (
    <Notice tone="info">
      {tr(
        `Alerts are checked by the Swissquote demo server ${mins <= 1 ? 'every minute' : `every ${mins} minutes`} while it runs (also when this app is closed), using the same market data as Trade. Triggers are shown here only: there is no push notification, e-mail or SMS in this prototype.`,
        `Les alertes sont vérifiées par le serveur de démonstration Swissquote ${mins <= 1 ? 'chaque minute' : `toutes les ${mins} minutes`} tant qu’il tourne (même application fermée), avec les mêmes données de marché que Trade. Les déclenchements s’affichent uniquement ici : pas de notification push, d’e-mail ni de SMS dans ce prototype.`,
      )}{' '}
      <span className="text-sq-muted">
        {ev.lastRunAt ? tr(`Last check ${ageLabel(ev.lastRunAt)}.`, `Dernière vérification ${ageLabel(ev.lastRunAt, Date.now(), 'fr')}.`) : tr('No check has run yet.', 'Aucune vérification encore effectuée.')}
        {ev.lastError && ` ${tr('Market data was unavailable at the last check.', 'Les données de marché étaient indisponibles lors de la dernière vérification.')}`}
      </span>
    </Notice>
  );
}

// ───────────── Examples (empty state) ─────────────
function nextMondayNine() {
  // Next Monday 09:00, Zurich wall clock (date computed in Zurich).
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' });
  const d = new Date(today + 'T12:00:00Z');
  const add = ((8 - d.getUTCDay()) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return `${d.toISOString().slice(0, 10)}T09:00`;
}

function Examples({ clientId, onCreated }: { clientId: string; onCreated: () => void }) {
  const quotes = useQuotes(['yf:^SSMI', 'cg:bitcoin', 'yf:NESN.SW']);
  const q = (id: string) => quotes.data?.quotes.find((x) => x.id === id);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const round = (n: number) => (n > 1000 ? Math.round(n / 10) * 10 : Math.round(n * 10) / 10);
  const ex: { key: string; title: string; text: string; rule: () => AlertRule | null }[] = [
    {
      key: 'smi-drop',
      title: 'SMI',
      text: tr('Price falls 5 % below its current level (threshold set from the live price when you activate it)', 'Le cours baisse de 5 % sous son niveau actuel (seuil fixé à partir du cours en direct à l’activation)'),
      rule: () => (q('yf:^SSMI') ? { type: 'price-below', instrumentId: 'yf:^SSMI', threshold: round(q('yf:^SSMI')!.price * 0.95) } : null),
    },
    {
      key: 'btc-move',
      title: 'Bitcoin',
      text: tr('Price moves by 5 % or more over 1 day', 'Le cours varie de 5 % ou plus sur 1 jour'),
      rule: () => ({ type: 'change-pct', instrumentId: 'cg:bitcoin', period: '1D', direction: 'either', pct: 5 }),
    },
    {
      key: 'nesn-up',
      title: 'Nestlé',
      text: tr('Price rises 5 % above its current level', 'Le cours monte de 5 % au-dessus de son niveau actuel'),
      rule: () => (q('yf:NESN.SW') ? { type: 'price-above', instrumentId: 'yf:NESN.SW', threshold: round(q('yf:NESN.SW')!.price * 1.05) } : null),
    },
    {
      key: 'review',
      title: tr('Reminder', 'Rappel'),
      text: tr(`Review my portfolio — next Monday at 09:00 (Zurich)`, `Revoir mon portefeuille — lundi prochain à 09:00 (Zurich)`),
      rule: () => ({ type: 'reminder', at: nextMondayNine(), note: tr('Review my portfolio', 'Revoir mon portefeuille') }),
    },
  ];
  const activate = async (key: string, rule: AlertRule | null) => {
    if (!rule) return;
    setBusy(key);
    setErr(null);
    try {
      await alertsApi.create(clientId, rule, key);
      onCreated();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="px-0 pb-2 pt-4">
      <div className="px-5">
        <h2 className="text-[17px] font-semibold">{tr('Examples', 'Exemples')}</h2>
        <p className="mt-1 text-[13px] text-sq-muted">{tr('Ideas to get started. They do nothing until you activate one, which creates a real alert.', 'Des idées pour démarrer. Elles ne font rien tant que vous n’en activez pas une, ce qui crée une vraie alerte.')}</p>
      </div>
      {err && <Notice tone="bad" className="mx-5 mt-2">{err}</Notice>}
      <ul className="mt-2">
        {ex.map((e) => {
          const r = e.rule();
          return (
            <li key={e.key} className="flex items-center gap-3 border-t border-sq-line/60 px-5 py-3 first:border-t-0">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-sq-ink">
                  {e.title} <MockBadge label={tr('Example — inactive', 'Exemple — inactive')} />
                </span>
                <span className="block text-[13px] text-sq-ink-2">{e.text}</span>
                {r && r.type !== 'change-pct' && r.type !== 'reminder' && <span className="block text-[12px] text-sq-muted">{describe(r, q(r.instrumentId))}</span>}
              </span>
              <Button variant="secondary" className="w-auto min-h-10 px-3 py-1.5 text-[14px]" disabled={!r || busy !== null} onClick={() => void activate(e.key, r)}>
                {busy === e.key ? <Spinner /> : tr('Activate', 'Activer')}
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ───────────── Detail ─────────────
function AlertDetail({ a, q, clientId, onBack, onEdit, onChanged, onDeleted }: { a: AlertView; q?: Quote; clientId: string; onBack: () => void; onEdit: () => void; onChanged: () => void; onDeleted: () => void }) {
  const h = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => {
    h.current?.focus();
    window.scrollTo({ top: 0 });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onBack();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (a.unseen) void alertsApi.seen(clientId).then(onChanged);
  }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>, after = onChanged) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      after();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const name = a.rule.type === 'reminder' && !a.rule.instrumentId ? tr('Reminder', 'Rappel') : (q?.name ?? a.rule.instrumentId!);
  const current =
    a.rule.type === 'reminder' ? null : a.rule.type === 'change-pct' ? (a.state.lastValue !== undefined ? `${a.state.lastValue >= 0 ? '+' : '−'}${Math.abs(a.state.lastValue).toFixed(2)} %` : null) : a.state.lastValue !== undefined ? `${num(a.state.lastValue)}${q ? ' ' + q.currency : ''}` : null;

  return (
    <section className="mt-4 space-y-4" aria-labelledby="alert-detail-h">
      <button type="button" onClick={onBack} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 pr-3 text-[15px] font-medium text-sq-ink hover:bg-sq-chip/60">
        <ChevronLeft {...ICON} aria-hidden /> {tr('Back to alerts', 'Retour aux alertes')}
      </button>
      <Card>
        <div className="flex items-start gap-3">
          <h2 id="alert-detail-h" ref={h} tabIndex={-1} className="flex-1 text-[20px] font-semibold tracking-tight outline-none">
            {name}
          </h2>
          <StatusBadge a={a} />
        </div>
        {a.rule.instrumentId && (
          <Link to={instrumentPath(a.rule.instrumentId)} className="mt-1 inline-flex min-h-9 items-center text-[14px] font-medium text-sq-ink underline decoration-sq-line underline-offset-2">
            {tr('Open the instrument page', 'Ouvrir la fiche de l’instrument')}
          </Link>
        )}
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
          <dt className="text-sq-muted">{tr('Rule', 'Règle')}</dt>
          <dd>{describe(a.rule, q)}</dd>
          {a.rule.type === 'change-pct' && (
            <>
              <dt className="text-sq-muted">{tr('Method', 'Méthode')}</dt>
              <dd className="text-sq-ink-2">{tr(`Latest price vs the first price of the ${a.rule.period} chart (market-data history).`, `Dernier cours comparé au premier cours du graphique ${a.rule.period} (historique market-data).`)}</dd>
            </>
          )}
          <dt className="text-sq-muted">{tr('Created', 'Créée')}</dt>
          <dd>{zurichDateTime(a.createdAt)}</dd>
          <dt className="text-sq-muted">{tr('Last check', 'Dernière vérification')}</dt>
          <dd>
            {a.state.lastCheckedAt ? zurichDateTime(a.state.lastCheckedAt) : tr('Not checked yet', 'Pas encore vérifiée')}
            {a.state.status === 'data-unavailable' && <span className="text-sq-warn"> · {tr('data unavailable — no trigger possible', 'données indisponibles — aucun déclenchement possible')}</span>}
          </dd>
          {current && (
            <>
              <dt className="text-sq-muted">{tr('Value at last check', 'Valeur à la dernière vérification')}</dt>
              <dd className="num">{current}</dd>
            </>
          )}
          {a.status === 'triggered' && a.rule.type !== 'reminder' && (
            <>
              <dt className="text-sq-muted">{tr('Re-arming', 'Réarmement')}</dt>
              <dd className="text-sq-ink-2">{tr('Fires again only after the condition has been false at a check.', 'Se redéclenche seulement après que la condition est redevenue fausse lors d’une vérification.')}</dd>
            </>
          )}
        </dl>
        {err && <Notice tone="bad" className="mt-3">{err}</Notice>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" className="w-auto" onClick={onEdit} disabled={busy}>
            <Pencil size={16} aria-hidden /> {tr('Edit', 'Modifier')}
          </Button>
          {a.enabled ? (
            <Button variant="secondary" className="w-auto" disabled={busy} onClick={() => void run(() => alertsApi.disable(clientId, a.id))}>
              <BellOff size={16} aria-hidden /> {tr('Disable', 'Désactiver')}
            </Button>
          ) : (
            <Button variant="secondary" className="w-auto" disabled={busy} onClick={() => void run(() => alertsApi.enable(clientId, a.id))}>
              <Bell size={16} aria-hidden /> {tr('Enable', 'Activer')}
            </Button>
          )}
          {confirmDel ? (
            <>
              <Button variant="danger" className="w-auto" disabled={busy} onClick={() => void run(() => alertsApi.remove(clientId, a.id), onDeleted)}>
                {tr('Confirm delete', 'Confirmer la suppression')}
              </Button>
              <Button variant="ghost" className="w-auto" onClick={() => setConfirmDel(false)}>
                {tr('Cancel', 'Annuler')}
              </Button>
            </>
          ) : (
            <Button variant="danger" className="w-auto" disabled={busy} onClick={() => setConfirmDel(true)}>
              <Trash2 size={16} aria-hidden /> {tr('Delete', 'Supprimer')}
            </Button>
          )}
        </div>
      </Card>
      <Card>
        <h3 className="text-[17px] font-semibold">{tr('Trigger history', 'Historique des déclenchements')}</h3>
        <p className="mt-1 text-[12px] text-sq-muted">{tr('Only real evaluations by the server are listed.', 'Seules les évaluations réelles du serveur sont listées.')}</p>
        {a.triggers.length === 0 ? (
          <p className="mt-3 text-[14px] text-sq-muted">{tr('This alert has not been triggered yet.', 'Cette alerte ne s’est pas encore déclenchée.')}</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {a.triggers.map((t) => (
              <li key={t.id} className="rounded-[10px] bg-sq-surface p-3 text-[14px]">
                <div className="font-medium text-sq-ink">{zurichDateTime(t.at)}</div>
                <div className="text-sq-ink-2">{L(t.detail)}</div>
                {t.dataAsOf && <div className="text-[12px] text-sq-muted">{tr(`Market data as of ${zurichDateTime(t.dataAsOf)}`, `Données de marché du ${zurichDateTime(t.dataAsOf)}`)}</div>}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </section>
  );
}

// ───────────── Create / edit form ─────────────
type FormType = AlertRule['type'];

function AlertForm({ clientId, edit, instrumentId: initialId, onCancel, onDone }: { clientId: string; edit?: AlertView; instrumentId?: string; onCancel: () => void; onDone: (msg: string) => void }) {
  const r0 = edit?.rule;
  const [type, setType] = useState<FormType>(r0?.type ?? 'price-above');
  const [instrumentId, setInstrumentId] = useState<string | undefined>(r0?.instrumentId ?? initialId);
  const [picking, setPicking] = useState(!instrumentId);
  const [threshold, setThreshold] = useState(r0 && 'threshold' in r0 ? String(r0.threshold) : '');
  const [period, setPeriod] = useState<'1D' | '1W'>(r0?.type === 'change-pct' ? r0.period : '1D');
  const [direction, setDirection] = useState<'up' | 'down' | 'either'>(r0?.type === 'change-pct' ? r0.direction : 'either');
  const [pct, setPct] = useState(r0?.type === 'change-pct' ? String(r0.pct) : '5');
  const [date, setDate] = useState(r0?.type === 'reminder' ? r0.at.slice(0, 10) : '');
  const [time, setTime] = useState(r0?.type === 'reminder' ? r0.at.slice(11) : '09:00');
  const [note, setNote] = useState(r0?.type === 'reminder' ? r0.note : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const h = useRef<HTMLHeadingElement>(null);
  const quotes = useQuotes(instrumentId ? [instrumentId] : []);
  const q = instrumentId ? quotes.data?.quotes.find((x) => x.id === instrumentId) : undefined;
  const needsInstrument = type !== 'reminder';

  useEffect(() => {
    h.current?.focus();
    window.scrollTo({ top: 0 });
  }, []);

  const parseNum = (s: string) => Number(s.replace(/['’\s]/g, '').replace(',', '.'));
  const build = (): AlertRule | string => {
    if (needsInstrument && !instrumentId) return tr('Choose an instrument.', 'Choisissez un instrument.');
    if (type === 'price-above' || type === 'price-below') {
      const t = parseNum(threshold);
      if (!(t > 0)) return tr('Enter a positive price threshold.', 'Indiquez un seuil de cours positif.');
      return { type, instrumentId: instrumentId!, threshold: t };
    }
    if (type === 'change-pct') {
      const p = parseNum(pct);
      if (!(p > 0 && p <= 1000)) return tr('Enter a percentage between 0 and 1000.', 'Indiquez un pourcentage entre 0 et 1000.');
      return { type, instrumentId: instrumentId!, period, direction, pct: p };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return tr('Choose a date and a time.', 'Choisissez une date et une heure.');
    return { type: 'reminder', ...(instrumentId ? { instrumentId } : {}), at: `${date}T${time}`, note: note.trim() };
  };

  const submit = async () => {
    const rule = build();
    if (typeof rule === 'string') return setErr(rule);
    setBusy(true);
    setErr(null);
    try {
      if (edit) await alertsApi.update(clientId, edit.id, rule);
      else await alertsApi.create(clientId, rule);
      onDone(edit ? tr('Alert updated.', 'Alerte modifiée.') : tr('Alert created. It will be checked at the next evaluation.', 'Alerte créée. Elle sera vérifiée à la prochaine évaluation.'));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const types: { id: FormType; label: string }[] = [
    { id: 'price-above', label: tr('Price above', 'Cours au-dessus') },
    { id: 'price-below', label: tr('Price below', 'Cours en dessous') },
    { id: 'change-pct', label: tr('% change', 'Variation %') },
    { id: 'reminder', label: tr('Reminder', 'Rappel') },
  ];

  return (
    <section className="mt-4" aria-labelledby="alert-form-h">
      <Card>
        <h2 id="alert-form-h" ref={h} tabIndex={-1} className="text-[20px] font-semibold tracking-tight outline-none">
          {edit ? tr('Edit alert', 'Modifier l’alerte') : tr('Create alert', 'Créer une alerte')}
        </h2>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset>
            <legend className="mb-1.5 text-[14px] font-medium">{tr('Type', 'Type')}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {types.map((t) => (
                <label key={t.id} className={cx('flex min-h-11 cursor-pointer items-center justify-center rounded-[10px] border px-2 text-center text-[14px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-sq-orange', type === t.id ? 'border-sq-ink bg-sq-chip font-semibold' : 'border-sq-line bg-sq-surface')}>
                  <input type="radio" name="alert-type" className="sr-only" checked={type === t.id} onChange={() => setType(t.id)} />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <div className="mb-1.5 text-[14px] font-medium">
              {tr('Instrument', 'Instrument')}
              {!needsInstrument && <span className="font-normal text-sq-muted"> {tr('(optional)', '(facultatif)')}</span>}
            </div>
            {instrumentId && !picking ? (
              <div className="flex items-center gap-3 rounded-[10px] border border-sq-line px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{q?.name ?? instrumentId}</span>
                  <span className="num block text-[12px] text-sq-muted">
                    {q ? `${q.symbol} · ${tr('Last price', 'Dernier cours')} ${num(q.price)} ${q.currency} (${zurichDateTime(q.asOf)})` : quotes.error || (quotes.data?.errors as Record<string, string> | undefined)?.[instrumentId] ? tr('Price unavailable', 'Cours indisponible') : tr('Loading price…', 'Chargement du cours…')}
                  </span>
                </span>
                <Button variant="ghost" className="w-auto min-h-10 px-3 py-1.5 text-[14px]" onClick={() => setPicking(true)}>
                  {tr('Change', 'Changer')}
                </Button>
                {!needsInstrument && (
                  <Button variant="ghost" className="w-auto min-h-10 px-3 py-1.5 text-[14px]" onClick={() => setInstrumentId(undefined)}>
                    {tr('Remove', 'Retirer')}
                  </Button>
                )}
              </div>
            ) : (
              <InstrumentSearch
                label={tr('Search an instrument', 'Rechercher un instrument')}
                action={(hit) => (
                  <Button
                    variant="secondary"
                    className="w-auto min-h-10 px-3 py-1.5 text-[14px]"
                    onClick={() => {
                      setInstrumentId(hit.id);
                      setPicking(false);
                    }}
                  >
                    {tr('Select', 'Choisir')}
                  </Button>
                )}
              />
            )}
          </div>

          {(type === 'price-above' || type === 'price-below') && (
            <Field label={tr(`Threshold${q ? ` (${q.currency})` : ''}`, `Seuil${q ? ` (${q.currency})` : ''}`)} hint={q ? tr(`Current price: ${num(q.price)} ${q.currency}`, `Cours actuel : ${num(q.price)} ${q.currency}`) : undefined}>
              <input className={inputCls} inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} name="threshold" />
            </Field>
          )}

          {type === 'change-pct' && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={tr('Direction', 'Sens')}>
                <select className={inputCls} value={direction} onChange={(e) => setDirection(e.target.value as any)}>
                  <option value="either">{tr('Up or down', 'Hausse ou baisse')}</option>
                  <option value="up">{tr('Up', 'Hausse')}</option>
                  <option value="down">{tr('Down', 'Baisse')}</option>
                </select>
              </Field>
              <Field label={tr('Change (%)', 'Variation (%)')}>
                <input className={inputCls} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} name="pct" />
              </Field>
              <Field label={tr('Period', 'Période')} hint={tr('Compared with the first price of that period’s chart.', 'Comparé au premier cours du graphique de la période.')}>
                <select className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value as '1D' | '1W')}>
                  <option value="1D">{tr('1 day', '1 jour')}</option>
                  <option value="1W">{tr('1 week', '1 semaine')}</option>
                </select>
              </Field>
            </div>
          )}

          {type === 'reminder' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field label={tr('Date', 'Date')}>
                  <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} name="date" />
                </Field>
                <Field label={tr('Time (Zurich)', 'Heure (Zurich)')} hint="Europe/Zurich">
                  <input type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} name="time" />
                </Field>
              </div>
              <Field label={tr('Note', 'Note')}>
                <input className={inputCls} value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} name="note" placeholder={tr('e.g. Review my portfolio', 'ex. Revoir mon portefeuille')} />
              </Field>
            </>
          )}

          {err && <Notice tone="bad">{err}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="w-auto" disabled={busy}>
              {busy ? <Spinner /> : edit ? tr('Save', 'Enregistrer') : tr('Create alert', 'Créer l’alerte')}
            </Button>
            <Button variant="ghost" className="w-auto" onClick={onCancel}>
              {tr('Cancel', 'Annuler')}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}
