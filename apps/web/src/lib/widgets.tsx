// Home widget layout (N6): server-side per client (co-signer preferences, `widgets.mobile` / `widgets.desktop`),
// with a local fallback (localStorage, try/catch) used until the server answers or when saving fails.
// Rules (unknown ids dropped, required widgets always present, order preserved) live in @sq/shared/widgets.

import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultLayout, layoutReducer, normalizeLayout, type LayoutAction, type WidgetId, type WidgetKind, type WidgetLayout } from '@sq/shared/widgets';
import { cosigner } from './api';
import { setPrefs, usePrefs } from './prefs';
import { tr } from './i18n';

const localKey = (clientId: string, kind: WidgetKind) => `mw:widgets:${clientId}:${kind}`;

function readLocal(clientId: string, kind: WidgetKind): WidgetLayout | null {
  try {
    const v = localStorage.getItem(localKey(clientId, kind));
    return v ? normalizeLayout(JSON.parse(v), kind) : null;
  } catch {
    return null;
  }
}
function writeLocal(clientId: string, kind: WidgetKind, l: WidgetLayout) {
  try {
    localStorage.setItem(localKey(clientId, kind), JSON.stringify(l));
  } catch {
    /* storage unavailable (private mode…): the server copy is the reference */
  }
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'local-only';

export function useWidgetLayout(clientId: string, kind: WidgetKind) {
  const { prefs } = usePrefs();
  const [local, setLocal] = useState<WidgetLayout | null>(() => readLocal(clientId, kind));
  const [save, setSave] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setLocal(readLocal(clientId, kind)), [clientId, kind]);

  const server = prefs.widgets?.[kind];
  const layout = server ? normalizeLayout(server, kind) : local ?? defaultLayout(kind);

  // Keep the local copy in sync with the server copy (fallback for the next start).
  useEffect(() => {
    if (server) writeLocal(clientId, kind, normalizeLayout(server, kind));
  }, [clientId, kind, server]);

  const dispatch = useCallback(
    (a: LayoutAction) => {
      const next = layoutReducer(layout, a, kind);
      setLocal(next);
      writeLocal(clientId, kind, next);
      setPrefs({ ...prefs, widgets: { ...prefs.widgets, [kind]: next } }); // optimistic
      setSave('saving');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        cosigner
          .post(`/clients/${clientId}/preferences`, { widgets: { [kind]: next } })
          .then(() => setSave('saved'))
          .catch(() => setSave('local-only'));
      }, 350);
      return next;
    },
    [layout, kind, clientId, prefs],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return { layout, dispatch, save };
}

export const WIDGET_META: Record<WidgetId, { label: string; desc: string }> = {
  balances: { label: tr('Balances', 'Soldes'), desc: tr('Total value of your wallet', 'Valeur totale de votre wallet') },
  actions: { label: tr('Main actions', 'Actions principales'), desc: tr('Send, receive, transfer from your account', 'Envoyer, recevoir, virer depuis votre compte') },
  crypto: { label: tr('My crypto', 'Mes cryptos'), desc: tr('Assets held, prices and 24 h change', 'Actifs détenus, cours et variation 24 h') },
  chart: { label: tr('Wallet value chart', 'Graphique de la valeur'), desc: tr('Value over time and market price', 'Valeur dans le temps et cours du marché') },
  recent: { label: tr('Recent transactions', 'Transactions récentes'), desc: tr('Your latest transactions', 'Vos dernières transactions') },
  account: { label: tr('Swissquote account', 'Compte Swissquote'), desc: tr('Transfers between your account and your wallet', 'Virements entre votre compte et votre wallet') },
  security: { label: tr('Security', 'Sécurité'), desc: tr('Keys, linked device, recovery kit', 'Clés, appareil lié, kit de récupération') },
  fees: { label: tr('Your fees', 'Vos frais'), desc: tr('Commission and network fees paid by Swissquote', 'Commission et frais de réseau offerts') },
  info: { label: tr('Information', 'Informations'), desc: tr('Transactions, crypto market, My Wall updates', 'Transactions, marché crypto, nouveautés My Wall') },
  scheduled: { label: tr('Scheduled payments', 'Paiements planifiés'), desc: tr('Upcoming payments to confirm', 'Prochains paiements à confirmer') },
  approvals: { label: tr('Authorised apps', 'Applications autorisées'), desc: tr('Spending approvals you granted', 'Autorisations de dépense accordées') },
};
