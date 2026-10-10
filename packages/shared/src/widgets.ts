// My Wall home widgets (SECURITY_GAPS_FIX N6): which widgets the client shows, in which order, separately for the
// phone layout and the desktop layout. Display only — a widget layout never changes keys, rules or assets.
//
// Shared by the web app (reducer + local fallback) and the co-signer (strict server-side validation of the
// `widgets` preference), so both apply exactly the same rules:
//   - unknown ids are dropped, duplicates removed, the stored order is preserved;
//   - required widgets (balances, main actions) are always present and never hidden (re-added if missing);
//   - a known widget missing from a stored layout (e.g. added in a later version) is inserted at its default place.

export const WIDGET_IDS = ['balances', 'actions', 'crypto', 'chart', 'recent', 'account', 'security', 'fees', 'info', 'scheduled', 'approvals'] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];
export type WidgetKind = 'mobile' | 'desktop';
export const WIDGET_KINDS: readonly WidgetKind[] = ['mobile', 'desktop'];

/** Always shown: can be moved, never removed. */
export const REQUIRED_WIDGETS: readonly WidgetId[] = ['balances', 'actions'];

export interface WidgetLayout {
  /** Every known widget, in display order (hidden ones keep their place for when they are shown again). */
  order: WidgetId[];
  /** Hidden widgets (never a required one). */
  hidden: WidgetId[];
}
export type WidgetLayouts = Partial<Record<WidgetKind, WidgetLayout>>;

const DEFAULT_ORDER: WidgetId[] = [...WIDGET_IDS];
const DEFAULT_HIDDEN: WidgetId[] = ['scheduled', 'approvals'];

export const isWidgetId = (x: unknown): x is WidgetId => typeof x === 'string' && (WIDGET_IDS as readonly string[]).includes(x);
export const isRequiredWidget = (id: WidgetId) => REQUIRED_WIDGETS.includes(id);

export function defaultLayout(_kind: WidgetKind = 'mobile'): WidgetLayout {
  // Same default for both layouts today (the desktop grid places the widgets itself); kept per kind on purpose.
  return { order: [...DEFAULT_ORDER], hidden: [...DEFAULT_HIDDEN] };
}

/** Lenient normalisation of anything (stored value, local storage, server reply) into a valid layout. */
export function normalizeLayout(input: unknown, kind: WidgetKind = 'mobile'): WidgetLayout {
  const def = defaultLayout(kind);
  if (!input || typeof input !== 'object') return def;
  const raw = input as { order?: unknown; hidden?: unknown };
  const order: WidgetId[] = [];
  for (const x of Array.isArray(raw.order) ? raw.order : []) if (isWidgetId(x) && !order.includes(x)) order.push(x);
  if (order.length === 0) return def;
  // Known widgets missing from the stored order: insert after their default predecessor (or at the start), with
  // their default visibility (an optional widget added in a later version stays hidden until the client shows it).
  const missing: WidgetId[] = [];
  for (const id of def.order) {
    if (order.includes(id)) continue;
    missing.push(id);
    const di = def.order.indexOf(id);
    let at = 0;
    for (let i = di - 1; i >= 0; i--) {
      const p = order.indexOf(def.order[i]);
      if (p >= 0) {
        at = p + 1;
        break;
      }
    }
    order.splice(at, 0, id);
  }
  const hidden: WidgetId[] = [];
  for (const x of Array.isArray(raw.hidden) ? raw.hidden : []) if (isWidgetId(x) && !isRequiredWidget(x) && !hidden.includes(x)) hidden.push(x);
  for (const id of missing) if (def.hidden.includes(id) && !hidden.includes(id)) hidden.push(id);
  return { order, hidden };
}

export type LayoutAction =
  | { type: 'move'; id: WidgetId; delta: number }
  | { type: 'moveTo'; id: WidgetId; index: number }
  | { type: 'hide'; id: WidgetId }
  | { type: 'show'; id: WidgetId }
  | { type: 'reset' };

/** Pure reducer used by the Customize mode (buttons, keyboard, drag and drop). */
export function layoutReducer(state: WidgetLayout, action: LayoutAction, kind: WidgetKind = 'mobile'): WidgetLayout {
  const s = normalizeLayout(state, kind);
  switch (action.type) {
    case 'reset':
      return defaultLayout(kind);
    case 'hide':
      if (!isWidgetId(action.id) || isRequiredWidget(action.id) || s.hidden.includes(action.id)) return s;
      return { ...s, hidden: [...s.hidden, action.id] };
    case 'show':
      return { ...s, hidden: s.hidden.filter((x) => x !== action.id) };
    case 'move':
    case 'moveTo': {
      const from = s.order.indexOf(action.id);
      if (from < 0) return s;
      const target = action.type === 'move' ? from + Math.trunc(action.delta) : Math.trunc(action.index);
      const to = Math.max(0, Math.min(s.order.length - 1, target));
      if (to === from || !Number.isFinite(to)) return s;
      const order = [...s.order];
      order.splice(from, 1);
      order.splice(to, 0, action.id);
      return { ...s, order };
    }
    default:
      return s;
  }
}

/** Visible widgets in display order. */
export const visibleWidgets = (l: WidgetLayout): WidgetId[] => l.order.filter((id) => !l.hidden.includes(id));

/** Strict server-side validation of a `widgets` preference patch. Returns the normalised layouts, or an error
 *  message for a malformed payload (wrong types, unknown layout kind, oversized arrays). Unknown widget ids inside
 *  a well-formed layout are dropped (forward/backward compatibility between app versions). */
export function validateWidgetsPatch(input: unknown): { ok: true; value: WidgetLayouts } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'widgets must be an object' };
  const out: WidgetLayouts = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(WIDGET_KINDS as readonly string[]).includes(k)) return { ok: false, error: `unknown layout "${k.slice(0, 20)}"` };
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: `widgets.${k} must be an object` };
    const keys = Object.keys(v);
    if (keys.some((x) => x !== 'order' && x !== 'hidden')) return { ok: false, error: `widgets.${k}: only order and hidden are allowed` };
    const { order, hidden } = v as { order?: unknown; hidden?: unknown };
    for (const [name, arr] of [['order', order], ['hidden', hidden]] as const) {
      if (arr === undefined && name === 'hidden') continue;
      if (!Array.isArray(arr)) return { ok: false, error: `widgets.${k}.${name} must be an array` };
      if (arr.length > 32) return { ok: false, error: `widgets.${k}.${name} is too long` };
      if (arr.some((x) => typeof x !== 'string' || x.length > 40)) return { ok: false, error: `widgets.${k}.${name} must contain widget ids` };
    }
    out[k as WidgetKind] = normalizeLayout(v, k as WidgetKind);
  }
  return { ok: true, value: out };
}
