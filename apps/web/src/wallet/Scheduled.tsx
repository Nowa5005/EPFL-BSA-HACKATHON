// Scheduled payments & reminders. Nothing is signed or sent automatically: at the due date a payment becomes
// "à confirmer" and opens the normal flow, with fees, balances and simulation recomputed.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, CalendarClock, Pencil, Trash2 } from 'lucide-react';
import { cosigner } from '../lib/api';
import { useLocal, usePoll } from '../lib/hooks';
import { Button, Card, cx, Field, inputCls, Notice, PageHeader, Skeleton, Why } from '../components/ui';
import { zurichLocalToIso } from '../pages/Send';
import { locale, tr } from '../lib/i18n';

const STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: tr('Scheduled', 'Planifiée'), cls: 'bg-sq-chip text-sq-ink-2' },
  due: { label: tr('To confirm', 'À confirmer'), cls: 'mw-important bg-sq-warn-50 text-sq-warn' },
  done: { label: tr('Done', 'Traitée'), cls: 'bg-sq-ok-50 text-sq-up' },
};
const zurich = (iso: string) => new Date(iso).toLocaleString(locale(), { timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short' });
const toZurichInput = (iso: string) => {
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Europe/Zurich' }));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function Scheduled() {
  const { device } = useLocal();
  const clientId = device!.clientId;
  const { data, loading, reload } = usePoll<any[]>(() => cosigner.get(`/clients/${clientId}/scheduled`), 5000, [clientId]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<{ amount: string; due: string; note: string }>({ amount: '', due: '', note: '' });
  const [err, setErr] = useState('');

  const save = async (id: string) => {
    setErr('');
    try {
      await cosigner.post(`/scheduled/${id}`, { clientId, amount: form.amount, dueAt: zurichLocalToIso(form.due), note: form.note || undefined });
      setEditing(null);
      void reload();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <div className="mx-auto max-w-[760px] space-y-4">
      <PageHeader title={tr('Scheduled payments & reminders', 'Dépenses planifiées et rappels')} back="/wallet/more" />
      <Why>{tr('A scheduled payment never goes out on its own: at the due date it becomes “to confirm”, fees and simulation are recalculated, and you approve it yourself. A reminder only notifies you.', 'Une dépense planifiée ne part jamais toute seule : à l’échéance, elle devient « à confirmer », les frais et la simulation sont recalculés, et vous la validez vous-même. Un rappel ne fait que vous prévenir.')}</Why>
      <Link to="/send" className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-sq-line bg-white px-4 text-[14px] font-semibold">
        <CalendarClock size={18} strokeWidth={1.75} /> {tr('Schedule from Send', 'Planifier depuis Envoyer')}
      </Link>
      {err && <Notice tone="bad">{err}</Notice>}
      {loading && !data ? (
        <Skeleton className="h-24" />
      ) : !(data ?? []).length ? (
        <Card className="text-center text-[14px] text-sq-muted">{tr('Nothing scheduled yet.', 'Rien de planifié pour l’instant.')}</Card>
      ) : (
        <ul className="space-y-3">
          {data!.map((s) => (
            <li key={s.id}>
              <Card className="space-y-2">
                <div className="flex items-start gap-3">
                  {s.kind === 'payment' ? <CalendarClock size={22} strokeWidth={1.75} className="mt-0.5 text-sq-ink-2" /> : <BellRing size={22} strokeWidth={1.75} className="mt-0.5 text-sq-ink-2" />}
                  <div className="min-w-0 flex-1 text-[14px]">
                    <div className="font-semibold">
                      {s.kind === 'payment' ? tr('Scheduled payment', 'Dépense planifiée') : tr('Reminder', 'Rappel')} · {s.amount} {s.asset}
                    </div>
                    <div className="text-sq-ink-2">{tr('To:', 'À :')} {s.recipientName ? `${s.recipientName} — ` : ''}<span className="break-all font-mono text-[12px]">{s.recipient}</span></div>
                    <div className="text-sq-ink-2">
                      {zurich(s.dueAt)} <span className="text-sq-muted">(Europe/Zurich)</span>
                    </div>
                    {s.note && <div className="text-sq-muted">{tr('Reference:', 'Motif :')} {s.note}</div>}
                  </div>
                  <span className={cx('shrink-0 rounded-[4px] px-1.5 py-0.5 text-[12px] font-medium', STATUS[s.status]?.cls)}>{STATUS[s.status]?.label ?? s.status}</span>
                </div>
                {editing === s.id ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Field label={tr('Amount', 'Montant')}>
                      <input className={inputCls} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(',', '.') })} />
                    </Field>
                    <Field label={tr('Date and time (Zurich)', 'Date et heure (Zurich)')}>
                      <input type="datetime-local" className={inputCls} value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
                    </Field>
                    <Field label={tr('Reference', 'Motif')}>
                      <input className={inputCls} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                    </Field>
                    <div className="flex gap-2 sm:col-span-3">
                      <Button variant="secondary" className="w-auto px-4" onClick={() => setEditing(null)}>
                        {tr('Cancel', 'Annuler')}
                      </Button>
                      <Button className="w-auto px-4" onClick={() => save(s.id)}>
                        {tr('Save', 'Enregistrer')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {s.status === 'due' && s.kind === 'payment' && (
                      <Link
                        to={`/send?to=${s.recipient}&amount=${s.amount}&asset=${s.asset}${s.note ? `&note=${encodeURIComponent(s.note)}` : ''}`}
                        onClick={() => cosigner.post(`/scheduled/${s.id}/done`, { clientId })}
                        className="inline-flex min-h-11 items-center rounded-[10px] bg-sq-orange px-4 text-[14px] font-semibold text-white"
                      >
                        {tr('Review and confirm now', 'Vérifier et confirmer maintenant')}
                      </Link>
                    )}
                    {s.status !== 'done' && (
                      <Button
                        variant="secondary"
                        className="min-h-11 w-auto px-3 text-[14px]"
                        onClick={() => {
                          setEditing(s.id);
                          setForm({ amount: s.amount, due: toZurichInput(s.dueAt), note: s.note ?? '' });
                        }}
                      >
                        <Pencil size={16} strokeWidth={1.75} /> {tr('Edit', 'Modifier')}
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      className="min-h-11 w-auto px-3 text-[14px]"
                      onClick={async () => {
                        if (!confirm(tr('Delete this scheduled item?', 'Supprimer cet élément planifié ?'))) return;
                        await cosigner.post(`/scheduled/${s.id}/delete`, { clientId });
                        void reload();
                      }}
                    >
                      <Trash2 size={16} strokeWidth={1.75} /> {tr('Delete', 'Supprimer')}
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
