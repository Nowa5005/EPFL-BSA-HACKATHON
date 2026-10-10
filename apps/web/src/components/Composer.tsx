// Message composer: local draft + opens the user's own email client (mailto). My Wall sends NOTHING itself.
// The Swissquote referent address is a mock-up address provided for the demo, not a validated integration.

import { useEffect, useState } from 'react';
import { PenLine, Send } from 'lucide-react';
import { SWISSQUOTE_REFERENT_EMAIL } from '@sq/shared';
import { findSensitive } from '../lib/messageGuard';
import { Button, Card, cx, Field, inputCls, MockBadge, Notice } from './ui';

interface Draft {
  to: string;
  subject: string;
  body: string;
}
const key = (clientId: string) => `mw:draft:${clientId}`;
const load = (clientId: string): Draft => {
  try {
    return JSON.parse(localStorage.getItem(key(clientId)) ?? '') as Draft;
  } catch {
    return { to: SWISSQUOTE_REFERENT_EMAIL, subject: '', body: '' };
  }
};

export function Composer({ clientId, contacts }: { clientId: string; contacts: { name: string; email?: string }[] }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Draft>(() => load(clientId));
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const [opened, setOpened] = useState(false);
  const recipients = [{ label: `Référent Swissquote — ${SWISSQUOTE_REFERENT_EMAIL}`, email: SWISSQUOTE_REFERENT_EMAIL }, ...contacts.filter((c) => c.email).map((c) => ({ label: `${c.name} — ${c.email}`, email: c.email! }))];

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(key(clientId), JSON.stringify(d));
        setSaved(true);
      } catch {
        /* storage unavailable: the draft just isn't kept */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [d, open, clientId]);

  const sensitive = findSensitive(`${d.subject}\n${d.body}`);
  const validate = () => {
    if (!recipients.some((r) => r.email === d.to)) return 'Choisissez un destinataire disposant d’une adresse email.';
    if (!d.subject.trim()) return 'Ajoutez un objet.';
    if (!d.body.trim()) return 'Écrivez votre message.';
    if (d.subject.length > 120 || d.body.length > 2000) return 'Message trop long (objet 120 caractères, texte 2 000).';
    if (sensitive) return `Votre message semble contenir ${sensitive}. Ne transmettez jamais vos clés, codes ou mots de passe — Swissquote ne vous les demandera jamais.`;
    return '';
  };
  const openMail = () => {
    const e = validate();
    setErr(e);
    if (e) return;
    setOpened(true);
    window.location.href = `mailto:${encodeURIComponent(d.to)}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
  };

  if (!open)
    return (
      <Button variant="secondary" className="w-auto px-4" onClick={() => setOpen(true)}>
        <PenLine size={18} strokeWidth={1.75} /> Nouveau message
      </Button>
    );

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">Nouveau message</h2>
        <MockBadge label="Ouverture de votre messagerie" />
      </div>
      <Field label="À">
        <select className={cx(inputCls, 'appearance-auto')} value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })}>
          {recipients.map((r) => (
            <option key={r.email} value={r.email}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>
      {d.to === SWISSQUOTE_REFERENT_EMAIL && <p className="-mt-1 text-[12px] text-sq-muted">Adresse fournie pour la maquette, pas une intégration Swissquote validée.</p>}
      <Field label="Objet">
        <input className={inputCls} value={d.subject} maxLength={120} onChange={(e) => setD({ ...d, subject: e.target.value })} />
      </Field>
      <Field label="Message" hint={`${d.body.length} / 2 000`}>
        <textarea className={cx(inputCls, 'h-36 resize-y')} value={d.body} maxLength={2000} onChange={(e) => setD({ ...d, body: e.target.value })} />
      </Field>
      {sensitive && <Notice tone="bad" title="Information sensible détectée">Retirez {sensitive} : My Wall ne vous laissera pas le joindre à un message.</Notice>}
      {err && !sensitive && <Notice tone="bad">{err}</Notice>}
      {saved && <p className="text-[12px] text-sq-muted">Brouillon enregistré sur cet appareil.</p>}
      {opened && <Notice tone="info">Votre client email s’est ouvert avec ce message. L’envoi se fait depuis votre messagerie : My Wall n’a rien envoyé.</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button className="w-auto px-4" onClick={openMail} disabled={!!sensitive}>
          <Send size={18} strokeWidth={1.75} /> Ouvrir dans ma messagerie
        </Button>
        <Button
          variant="ghost"
          className="w-auto px-4"
          onClick={() => {
            setD({ to: SWISSQUOTE_REFERENT_EMAIL, subject: '', body: '' });
            try {
              localStorage.removeItem(key(clientId));
            } catch {
              /* ignore */
            }
            setSaved(false);
            setOpened(false);
          }}
        >
          Effacer le brouillon
        </Button>
        <Button variant="ghost" className="w-auto px-4" onClick={() => setOpen(false)}>
          Fermer
        </Button>
      </div>
    </Card>
  );
}
