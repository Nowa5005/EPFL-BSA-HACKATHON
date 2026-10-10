// Client for the per-client watchlist & alerts stored by sq-bank (/clients/:id/watchlist, /clients/:id/alerts).

import { bank } from '../../lib/api';

export interface WatchItem {
  instrumentId: string;
  addedAt: string;
  name?: string;
  symbol?: string;
}

export type ChangePeriod = '1D' | '1W';
export type AlertRule =
  | { type: 'price-above' | 'price-below'; instrumentId: string; threshold: number }
  | { type: 'change-pct'; instrumentId: string; period: ChangePeriod; direction: 'up' | 'down' | 'either'; pct: number }
  | { type: 'reminder'; instrumentId?: string; at: string; note: string };

export interface AlertTrigger {
  id: string;
  at: string;
  value: number | null;
  detail: { en: string; fr: string };
  dataAsOf?: string;
  seen: boolean;
}
export interface AlertView {
  id: string;
  rule: AlertRule;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  fromExample?: string;
  state: { armed: boolean; status: 'ok' | 'data-unavailable' | 'never-evaluated'; lastCheckedAt?: string; lastValue?: number };
  triggers: AlertTrigger[];
  status: 'active' | 'inactive' | 'triggered';
  lastTriggeredAt: string | null;
  unseen: number;
}
export interface AlertsPayload {
  alerts: AlertView[];
  evaluator: { intervalMs: number; lastRunAt: string | null; lastError: string | null; channel: 'in-app' };
  max: number;
}

const c = (clientId: string) => `/clients/${encodeURIComponent(clientId)}`;

export const watchlistApi = {
  list: (id: string) => bank.get<{ items: WatchItem[]; max: number }>(`${c(id)}/watchlist`),
  add: (id: string, instrumentId: string) => bank.post<{ items: WatchItem[] }>(`${c(id)}/watchlist`, { instrumentId }),
  remove: (id: string, instrumentId: string) => bank.post<{ items: WatchItem[] }>(`${c(id)}/watchlist/remove`, { instrumentId }),
};

export const alertsApi = {
  list: (id: string) => bank.get<AlertsPayload>(`${c(id)}/alerts`),
  create: (id: string, rule: AlertRule, fromExample?: string) => bank.post<AlertView>(`${c(id)}/alerts`, { rule, fromExample }),
  update: (id: string, alertId: string, rule: AlertRule) => bank.post<AlertView>(`${c(id)}/alerts/${alertId}/update`, { rule }),
  enable: (id: string, alertId: string) => bank.post<AlertView>(`${c(id)}/alerts/${alertId}/enable`),
  disable: (id: string, alertId: string) => bank.post<AlertView>(`${c(id)}/alerts/${alertId}/disable`),
  remove: (id: string, alertId: string) => bank.post(`${c(id)}/alerts/${alertId}/delete`),
  seen: (id: string) => bank.post<AlertsPayload>(`${c(id)}/alerts/seen`),
};
