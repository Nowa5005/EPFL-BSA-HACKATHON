// Terms of Use (spec N4): mandatory acceptance gate, Settings card, Legal documents (view + PDF), My Wall updates
// items and the console publication action. The texts and the acceptance records live in sq-bank
// (services/sq-bank/src/terms.ts); the full text is served in English (binding version), the 5-point summary and
// the change summary in the request language.

import { Fragment, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, Download, Eye, FileText, Scale } from 'lucide-react';
import { ApiError, bank } from '../lib/api';
import { deviceLabel } from '../lib/device';
import { useLocal, usePoll } from '../lib/hooks';
import { getLang, tr } from '../lib/i18n';
import { Button, Card, cx, dateOnly, dateTime, Logo, Notice, Spinner } from './ui';

// ───────────── Types & shared status cache ─────────────

export interface TermsAcceptance {
  version: string;
  acceptedAt: string;
  deviceLabel: string;
  userAgentHash: string | null;
  lang: 'en' | 'fr';
}
export interface TermsMeta {
  version: string;
  docDate: string;
  title: string;
  summary: string[];
  changeSummary: string[];
  substantive: boolean;
  published: boolean;
  publishedAt: string | null;
}
export interface TermsStatus {
  current: TermsMeta | null;
  accepted: TermsAcceptance | null;
  acceptances: TermsAcceptance[];
  needsAcceptance: boolean;
  reason: 'first' | 'updated' | null;
  infoOnly: boolean;
  updates: (TermsMeta & { acceptedByYou: boolean })[];
  text: string | null;
}

const cache = new Map<string, TermsStatus>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const inflight = new Map<string, Promise<TermsStatus>>();

/** Fetches the terms status of a client (deduplicated) and updates every component that shows it. */
export function loadTerms(clientId: string): Promise<TermsStatus> {
  if (!inflight.has(clientId))
    inflight.set(
      clientId,
      bank
        .get<TermsStatus>(`/clients/${clientId}/terms`)
        .then((s) => {
          cache.set(clientId, s);
          emit();
          return s;
        })
        .finally(() => inflight.delete(clientId)),
    );
  return inflight.get(clientId)!;
}

export function useTerms(clientId: string | undefined) {
  const status = useSyncExternalStore(subscribe, () => (clientId ? cache.get(clientId) ?? null : null));
  const [error, setError] = useState<ApiError | Error | null>(null);
  useEffect(() => {
    if (!clientId) return;
    loadTerms(clientId).then(
      () => setError(null),
      (e) => setError(e),
    );
  }, [clientId]);
  return { status, error, reload: () => clientId && loadTerms(clientId).then(() => setError(null), setError) };
}

// ───────────── Minimal Markdown rendering (our own trusted files only: headings, lists, quotes, tables) ─────────────

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k++} className="rounded bg-sq-chip px-1 text-[12px]">{tok.slice(1, -1)}</code>);
    else out.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function TermsText({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || l.trim() === '---') continue;
    const h = l.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const cls = h[1].length === 1 ? 'text-[18px] font-semibold' : h[1].length === 2 ? 'mt-4 text-[15px] font-semibold' : 'mt-3 text-[14px] font-semibold';
      blocks.push(<p key={i} className={cls} role="heading" aria-level={h[1].length + 1}>{inline(h[2])}</p>);
      continue;
    }
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].startsWith('|'); i++) if (!/^\|[\s|:-]+\|$/.test(lines[i])) rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
      i--;
      blocks.push(
        <div key={i} className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className={cx('border-b border-sq-line align-top', ri === 0 && 'font-semibold')}>
                  {r.map((c, ci) => (
                    <td key={ci} className="py-1 pr-2">{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^(\s*[-*]|\d+\.)\s/.test(l)) {
      const items: string[] = [];
      const ordered = /^\d+\./.test(l);
      for (; i < lines.length && /^(\s*[-*]|\d+\.)\s/.test(lines[i]); i++) items.push(lines[i].replace(/^(\s*[-*]|\d+\.)\s+/, ''));
      i--;
      const L = ordered ? 'ol' : 'ul';
      blocks.push(
        <L key={i} className={cx('space-y-1 pl-5', ordered ? 'list-decimal' : 'list-disc')}>
          {items.map((x, xi) => (
            <li key={xi}>{inline(x)}</li>
          ))}
        </L>,
      );
      continue;
    }
    if (l.startsWith('>')) {
      const q: string[] = [];
      for (; i < lines.length && lines[i].startsWith('>'); i++) q.push(lines[i].replace(/^>\s?/, ''));
      i--;
      blocks.push(
        <div key={i} className="rounded-[8px] border-l-2 border-sq-orange bg-sq-surface px-3 py-2">
          {q.map((x, xi) => (
            <p key={xi}>{inline(x.replace(/^-\s+/, '• '))}</p>
          ))}
        </div>,
      );
      continue;
    }
    blocks.push(<p key={i}>{inline(l)}</p>);
  }
  return <div className="space-y-2 text-[13px] leading-relaxed text-sq-ink-2">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}

// ───────────── Acceptance gate ─────────────

/** Wraps the wallet screens: until the current substantive version is accepted, the terms screen is shown instead. */
export function TermsGate({ children }: { children: ReactNode }) {
  const { device } = useLocal();
  const { status, error, reload } = useTerms(device?.clientId);
  const { pathname } = useLocation();
  // Re-checked on every wallet navigation: a substantive version published meanwhile shows the screen again.
  useEffect(() => {
    if (device?.clientId && cache.has(device.clientId)) loadTerms(device.clientId).catch(() => undefined);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  if (status && !status.needsAcceptance) return <>{children}</>;
  if (!status) {
    // Services unreachable (status 0): do not lock the client out of the wallet (emergency philosophy, spec #21).
    if (error instanceof ApiError && error.status === 0) return <>{children}</>;
    if (error)
      return (
        <GateFrame>
          <Notice tone="bad" title={tr('Could not load the Terms of Use', 'Impossible de charger les conditions d’utilisation')}>
            {error.message}
          </Notice>
          <Button variant="secondary" className="mt-3" onClick={() => void reload()}>
            {tr('Try again', 'Réessayer')}
          </Button>
        </GateFrame>
      );
    return (
      <div className="flex min-h-screen items-center justify-center bg-sq-bg text-sq-muted">
        <Spinner />
      </div>
    );
  }
  return <TermsAcceptScreen clientId={device!.clientId} status={status} />;
}

function GateFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-sq-bg">
      <div className="mx-auto max-w-[720px] px-4 pb-10 pt-6">
        <div className="mb-4 flex items-center gap-2.5">
          <Logo size={28} />
          <span className="text-[16px] font-semibold tracking-tight">My Wall</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function TermsAcceptScreen({ clientId, status }: { clientId: string; status: TermsStatus }) {
  const nav = useNavigate();
  const cur = status.current!;
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const updated = status.reason === 'updated';

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await bank.post(`/clients/${clientId}/terms/accept`, { version: cur.version, accept: true, deviceLabel: deviceLabel(), lang: getLang() });
      await loadTerms(clientId);
    } catch (e: any) {
      setErr(e.message);
      if (e instanceof ApiError && e.status === 409) void loadTerms(clientId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateFrame>
      <section aria-labelledby="terms-title" data-testid="terms-gate">
        <p className="flex items-center gap-2 text-[13px] font-medium text-sq-muted">
          <Scale size={16} strokeWidth={1.75} /> {tr(`Version ${cur.version} — ${cur.docDate}`, `Version ${cur.version} — ${cur.docDate}`)}
        </p>
        <h1 id="terms-title" className="mt-1 text-[22px] font-semibold tracking-tight">
          {updated ? tr('Our Terms of Use have changed', 'Nos conditions d’utilisation ont changé') : tr('Terms of Use', 'Conditions d’utilisation')}
        </h1>
        <p className="mt-1 text-[14px] text-sq-muted">
          {updated
            ? tr(`You accepted version ${status.accepted?.version}. Please read what changed and accept version ${cur.version} to continue using My Wall.`, `Vous avez accepté la version ${status.accepted?.version}. Lisez ce qui change et acceptez la version ${cur.version} pour continuer à utiliser My Wall.`)
            : tr('Before you open My Wall for the first time, please read and accept its Terms of Use.', 'Avant d’ouvrir My Wall pour la première fois, lisez et acceptez ses conditions d’utilisation.')}
        </p>

        {updated && cur.changeSummary.length > 0 && (
          <Card className="mt-4">
            <h2 className="text-[15px] font-semibold">{tr('What changed', 'Ce qui change')}</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] text-sq-ink-2">
              {cur.changeSummary.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="mt-4">
          <h2 className="text-[15px] font-semibold">{tr('In short', 'En bref')}</h2>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-[14px] leading-relaxed text-sq-ink-2">
            {cur.summary.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </Card>

        <Card className="mt-4">
          <h2 className="text-[15px] font-semibold">{tr('Full text', 'Texte complet')}</h2>
          {getLang() === 'fr' && <p className="mt-1 text-[12px] text-sq-muted">Le texte complet est en anglais (version qui fait foi). Une traduction française est disponible en annexe.</p>}
          <div tabIndex={0} aria-label={tr('Full text of the Terms of Use', 'Texte complet des conditions d’utilisation')} className="mt-2 max-h-[42vh] overflow-y-auto rounded-[10px] border border-sq-line bg-sq-surface p-3" data-testid="terms-fulltext">
            <TermsText text={status.text ?? ''} />
          </div>
        </Card>

        <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] border border-sq-line bg-sq-surface p-3 text-[14px]">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[#fa5b35]" />
          <span>{tr(`I have read and accept the My Wall Terms of Use (version ${cur.version}).`, `J’ai lu et j’accepte les conditions d’utilisation de My Wall (version ${cur.version}).`)}</span>
        </label>
        {err && (
          <Notice tone="bad" className="mt-3">
            {err}
          </Notice>
        )}
        <Button className="mt-3" disabled={!checked || busy} onClick={submit}>
          {busy ? <Spinner /> : tr('Accept and continue', 'Accepter et continuer')}
        </Button>
        <Button variant="ghost" className="mt-2" onClick={() => nav('/sq')}>
          {tr('Not now — back to Swissquote', 'Pas maintenant — retour à Swissquote')}
        </Button>
        <p className="mt-2 text-[12px] text-sq-muted">
          {tr(
            'Your acceptance is recorded with the version, the date and this device. If you do not accept, your funds stay yours: the protected exit remains available (section 6).',
            'Votre acceptation est enregistrée avec la version, la date et cet appareil. Si vous n’acceptez pas, vos fonds restent à vous : la sortie protégée reste disponible (section 6).',
          )}
        </p>
      </section>
    </GateFrame>
  );
}

// ───────────── PDF ─────────────

/** jsPDF's standard fonts only cover WinAnsi: replace the few other characters our texts use. */
const pdfSafe = (s: string) =>
  s
    .replace(/[→]/g, '->')
    .replace(/[≈]/g, '~')
    .replace(/[≥]/g, '>=')
    .replace(/[≤]/g, '<=')
    .replace(/[  ]/g, ' ')
    .replace(/[^\x00-\xff–—‘’“”•€…]/g, '?');

interface VersionDoc extends TermsMeta {
  text: string;
}

export async function downloadTermsPdf(v: VersionDoc, a: TermsAcceptance | null, holder: { name?: string; clientId: string }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const ink: [number, number, number] = [48, 49, 55];
  const muted: [number, number, number] = [111, 116, 128];
  let y = 20;
  const text = (t: string, o: { size?: number; bold?: boolean; italic?: boolean; color?: [number, number, number]; x?: number; width?: number; gap?: number } = {}) => {
    doc.setFont('helvetica', o.bold ? 'bold' : o.italic ? 'italic' : 'normal');
    doc.setFontSize(o.size ?? 10);
    doc.setTextColor(...(o.color ?? ink));
    const lines = doc.splitTextToSize(pdfSafe(t), o.width ?? 174) as string[];
    const lh = (o.size ?? 10) * 0.45;
    for (const ln of lines) {
      if (y + lh > 285) {
        doc.addPage();
        y = 20;
      }
      doc.text(ln, o.x ?? 18, y);
      y += lh;
    }
    y += o.gap ?? 1.5;
  };
  text(`My Wall — ${tr('Terms of Use', 'Conditions d’utilisation')}, version ${v.version} (${v.docDate})`, { size: 15, bold: true });
  text(tr('Prototype — not legal advice, to be reviewed by Swissquote Legal. Swissquote Wallet Challenge (EPFL).', 'Prototype — pas un avis juridique, à faire relire par le service juridique de Swissquote. Swissquote Wallet Challenge (EPFL).'), { size: 9, color: muted, gap: 4 });
  if (a) {
    text(tr('Acceptance record', 'Preuve d’acceptation'), { bold: true, size: 11 });
    text(`${tr('Client', 'Client')}: ${holder.name ? `${holder.name}, ` : ''}${holder.clientId}`, { size: 9 });
    text(`${tr('Accepted on', 'Acceptée le')}: ${dateTime(a.acceptedAt)} (${a.acceptedAt} UTC)`, { size: 9 });
    text(`${tr('Device', 'Appareil')}: ${a.deviceLabel}${a.userAgentHash ? ` · ${tr('browser fingerprint (SHA-256, truncated)', 'empreinte du navigateur (SHA-256, tronquée)')} ${a.userAgentHash}` : ''}`, { size: 9 });
    text(`${tr('Published on', 'Publiée le')}: ${v.publishedAt ? dateOnly(v.publishedAt) : '—'} · ${v.substantive ? tr('substantive version (acceptance required)', 'version substantielle (acceptation requise)') : tr('information-only update', 'mise à jour pour information')}`, { size: 9, gap: 4 });
  }
  for (const raw of v.text.split('\n')) {
    const l = raw.trimEnd();
    if (!l.trim() || l.trim() === '---') {
      y += 1.2;
      continue;
    }
    if (/^\|[\s|:-]+\|$/.test(l)) continue;
    const plain = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/`([^`]+)`/g, '$1');
    const h = l.match(/^(#{1,3})\s+(.*)$/);
    if (h) text(plain(h[2]), { bold: true, size: h[1].length === 1 ? 13 : 11, gap: 2 });
    else if (l.startsWith('|')) text(plain(l.split('|').slice(1, -1).map((c) => c.trim()).join('  ·  ')), { size: 8.5 });
    else if (l.startsWith('>')) text(plain(l.replace(/^>\s?/, '')), { size: 9, italic: true, color: muted });
    else if (/^(\s*[-*])\s/.test(l)) text(`• ${plain(l.replace(/^\s*[-*]\s+/, ''))}`, { size: 9.5, x: 22, width: 170 });
    else text(plain(l), { size: 9.5 });
  }
  doc.save(`mywall-terms-v${v.version}${a ? `-accepted-${a.acceptedAt.slice(0, 10)}` : ''}.pdf`);
}

async function fetchVersion(clientId: string, version: string) {
  return bank.get<VersionDoc>(`/clients/${clientId}/terms/versions/${encodeURIComponent(version)}`);
}

/** Latest acceptance of each accepted version, newest first. */
function acceptedVersions(s: TermsStatus | null) {
  const m = new Map<string, TermsAcceptance>();
  for (const a of s?.acceptances ?? []) if (!m.has(a.version) || m.get(a.version)!.acceptedAt < a.acceptedAt) m.set(a.version, a);
  return [...m.values()].sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt));
}

// ───────────── Settings card ─────────────

export function TermsSettingsCard() {
  const { device, session } = useLocal();
  const clientId = device!.clientId;
  const { status } = useTerms(clientId);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = status?.accepted ?? null;
  const pdf = async () => {
    if (!a) return;
    setErr(null);
    try {
      await downloadTermsPdf(await fetchVersion(clientId, a.version), a, { name: session?.profile?.name, clientId });
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <Card className="space-y-3" id="terms">
      <h2 className="flex items-center gap-2 text-[16px] font-semibold">
        <Scale size={20} strokeWidth={1.75} /> {tr('Terms of Use', 'Conditions d’utilisation')}
      </h2>
      {!status ? (
        <p className="text-[14px] text-sq-muted">{tr('Loading…', 'Chargement…')}</p>
      ) : a ? (
        <dl className="divide-y divide-sq-line text-[14px]">
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-sq-muted">{tr('Accepted version', 'Version acceptée')}</dt>
            <dd className="font-medium" data-testid="terms-accepted-version">
              {a.version}
            </dd>
          </div>
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-sq-muted">{tr('Accepted on', 'Acceptée le')}</dt>
            <dd className="text-right font-medium">{dateTime(a.acceptedAt)}</dd>
          </div>
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-sq-muted">{tr('Device', 'Appareil')}</dt>
            <dd className="text-right font-medium">{a.deviceLabel}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-[14px] text-sq-muted">{tr('Not accepted yet.', 'Pas encore acceptées.')}</p>
      )}
      {status?.infoOnly && status.current && (
        <Notice tone="info">{tr(`Version ${status.current.version} was published for information (no new acceptance needed). See Information → My Wall updates.`, `La version ${status.current.version} a été publiée pour information (pas de nouvelle acceptation). Voir Informations → Mises à jour de My Wall.`)}</Notice>
      )}
      {open && a && <AcceptedVersionViewer clientId={clientId} acceptance={a} />}
      <div className="flex flex-wrap gap-2">
        {a && (
          <Button variant="secondary" className="w-auto px-4" onClick={() => setOpen((o) => !o)}>
            <Eye size={16} strokeWidth={1.75} /> {open ? tr('Hide the text', 'Masquer le texte') : tr('Read the accepted version', 'Lire la version acceptée')}
          </Button>
        )}
        {a && (
          <Button variant="secondary" className="w-auto px-4" onClick={pdf}>
            <Download size={16} strokeWidth={1.75} /> PDF
          </Button>
        )}
        <Link to="/wallet/swaplet#legal" className="inline-flex min-h-12 items-center px-2 text-[14px] font-medium text-sq-ink-2 underline-offset-2 hover:underline">
          {tr('All legal documents', 'Tous les documents juridiques')}
        </Link>
      </div>
      {err && <p className="text-[12px] text-sq-down">{err}</p>}
    </Card>
  );
}

function AcceptedVersionViewer({ clientId, acceptance }: { clientId: string; acceptance: TermsAcceptance }) {
  const { data, error } = usePoll(() => fetchVersion(clientId, acceptance.version), 600000, [clientId, acceptance.version]);
  if (error) return <p className="text-[12px] text-sq-down">{error}</p>;
  if (!data) return <Spinner />;
  return (
    <div className="max-h-[50vh] overflow-y-auto rounded-[10px] border border-sq-line bg-sq-surface p-3">
      <TermsText text={data.text} />
    </div>
  );
}

// ───────────── Swaplet → Documents → Legal ─────────────

export function LegalDocuments() {
  const { device, session } = useLocal();
  const clientId = device!.clientId;
  const { status } = useTerms(clientId);
  const [viewing, setViewing] = useState<TermsAcceptance | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const list = acceptedVersions(status);
  useEffect(() => {
    if (window.location.hash === '#legal') document.getElementById('legal')?.scrollIntoView({ block: 'start' });
  }, [status !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const pdf = async (a: TermsAcceptance) => {
    setErr(null);
    try {
      await downloadTermsPdf(await fetchVersion(clientId, a.version), a, { name: session?.profile?.name, clientId });
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <Card className="mb-4 space-y-3" id="legal">
      <h2 className="flex items-center gap-2 text-[16px] font-semibold">
        <Scale size={20} strokeWidth={1.75} /> {tr('Legal', 'Juridique')}
      </h2>
      {viewing ? (
        <div className="space-y-3">
          <button type="button" onClick={() => setViewing(null)} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[14px] font-medium text-sq-ink-2">
            <ChevronLeft size={18} strokeWidth={1.75} /> {tr('Legal documents', 'Documents juridiques')}
          </button>
          <p className="text-[12px] text-sq-muted">{tr(`Accepted on ${dateTime(viewing.acceptedAt)} · ${viewing.deviceLabel}`, `Acceptée le ${dateTime(viewing.acceptedAt)} · ${viewing.deviceLabel}`)}</p>
          <AcceptedVersionViewer clientId={clientId} acceptance={viewing} />
          <Button onClick={() => pdf(viewing)}>
            <Download size={18} strokeWidth={1.75} /> {tr('Download PDF', 'Télécharger le PDF')}
          </Button>
        </div>
      ) : !list.length ? (
        <p className="text-[14px] text-sq-muted">{tr('No accepted terms yet.', 'Aucune condition acceptée pour l’instant.')}</p>
      ) : (
        <ul className="divide-y divide-sq-line">
          {list.map((a) => (
            <li key={a.version} className="flex items-center gap-3 py-2.5" data-testid="legal-doc">
              <FileText size={20} strokeWidth={1.75} className="shrink-0 text-sq-ink-2" />
              <button type="button" onClick={() => setViewing(a)} className="min-w-0 flex-1 text-left">
                <span className="block text-[14px] font-medium">
                  {tr('Terms of Use', 'Conditions d’utilisation')} · version {a.version}
                  {status?.accepted?.version === a.version && <span className="ml-2 rounded-[4px] bg-sq-chip px-1.5 py-px text-[11px] font-medium text-sq-ink-2">{tr('In force for you', 'En vigueur pour vous')}</span>}
                </span>
                <span className="block text-[12px] text-sq-muted">{tr(`Accepted on ${dateOnly(a.acceptedAt)}`, `Acceptée le ${dateOnly(a.acceptedAt)}`)}</span>
              </button>
              <button type="button" onClick={() => setViewing(a)} aria-label={tr(`Preview Terms of Use ${a.version}`, `Aperçu des conditions ${a.version}`)} className="flex size-10 items-center justify-center rounded-full hover:bg-sq-chip/60">
                <Eye size={18} strokeWidth={1.75} />
              </button>
              <button type="button" onClick={() => pdf(a)} aria-label={tr(`Download Terms of Use ${a.version}`, `Télécharger les conditions ${a.version}`)} className="flex size-10 items-center justify-center rounded-full hover:bg-sq-chip/60">
                <Download size={18} strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="text-[12px] text-sq-down">{err}</p>}
    </Card>
  );
}

// ───────────── Information → My Wall updates ─────────────

/** Terms updates as items of the "My Wall updates" category (same shape as wallet/Info.tsx items). */
export function useTermsUpdateItems() {
  const { device } = useLocal();
  const { status } = useTerms(device?.clientId);
  return (status?.updates ?? []).map((u) => ({
    id: `c:terms-${u.version}`,
    title: tr(`Terms of Use updated — version ${u.version}`, `Conditions d’utilisation mises à jour — version ${u.version}`),
    summary: u.changeSummary[0],
    body: [
      u.substantive
        ? u.acceptedByYou
          ? tr('Substantive change — you have accepted this version.', 'Modification substantielle — vous avez accepté cette version.')
          : tr('Substantive change — your new acceptance is required the next time you open My Wall.', 'Modification substantielle — votre nouvelle acceptation est requise à la prochaine ouverture de My Wall.')
        : tr('Information only — no new acceptance needed.', 'Pour information — aucune nouvelle acceptation nécessaire.'),
      '',
      tr('What changed:', 'Ce qui change :'),
      ...u.changeSummary.map((c) => `• ${c}`),
    ].join('\n'),
    date: u.publishedAt ?? new Date().toISOString(),
    action: u.substantive && !u.acceptedByYou ? { label: tr('Review and accept', 'Lire et accepter'), to: '/wallet' } : undefined,
    group: u.substantive && !u.acceptedByYou ? 'action' : 'news',
  }));
}

// ───────────── Console (compliance) ─────────────

export function TermsAdminSection() {
  const { data, error, reload } = usePoll<{ versions: (TermsMeta & { acceptedBy: number })[] }>(() => bank.get('/admin/terms'), 10000);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const publish = async (version: string) => {
    if (!confirm(tr(`Publish Terms of Use v${version}? Clients will be asked to accept it the next time they open My Wall.`, `Publier les conditions v${version} ? Les clients devront l’accepter à leur prochaine ouverture de My Wall.`))) return;
    setBusy(version);
    setMsg(null);
    try {
      await bank.post('/admin/terms/publish', { version });
      setMsg(tr(`Version ${version} published.`, `Version ${version} publiée.`));
      void reload();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(null);
    }
  };
  const resetDemo = async () => {
    setBusy('reset');
    try {
      await bank.post('/admin/terms/reset-demo', {});
      setMsg(tr('Terms demo reset: only version 1.0 is published.', 'Démo des conditions réinitialisée : seule la version 1.0 est publiée.'));
      void reload();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(null);
    }
  };
  const drafts = (data?.versions ?? []).filter((v) => !v.published);
  return (
    <section>
      <h2 className="mb-2 text-[17px] font-semibold">{tr('Terms of Use', 'Conditions d’utilisation')}</h2>
      <Card className="space-y-3 text-[14px]">
        {error && <p className="text-sq-down">{error}</p>}
        <ul className="divide-y divide-sq-line">
          {(data?.versions ?? []).map((v) => (
            <li key={v.version} className="flex items-center gap-3 py-2">
              <span className={cx('rounded-[4px] px-1.5 py-0.5 text-[12px] font-semibold', v.published ? 'bg-sq-ok-50 text-sq-up' : 'bg-sq-chip text-sq-ink-2')}>{v.published ? tr('Published', 'Publiée') : tr('Draft', 'Brouillon')}</span>
              <span className="min-w-0 flex-1">
                v{v.version} · {v.substantive ? tr('substantive', 'substantielle') : tr('editorial', 'rédactionnelle')}
                <span className="block text-[12px] text-sq-muted">
                  {v.publishedAt ? tr(`published ${dateTime(v.publishedAt)}`, `publiée le ${dateTime(v.publishedAt)}`) : tr('not published', 'non publiée')} · {tr(`accepted by ${v.acceptedBy} client(s)`, `acceptée par ${v.acceptedBy} client(s)`)}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {drafts.map((v) => (
          <div key={v.version} className="space-y-2 rounded-[10px] border border-sq-line p-3">
            <p className="font-medium">{tr(`Changes in v${v.version}`, `Changements de la v${v.version}`)}</p>
            <ul className="list-disc space-y-1 pl-5 text-[13px] text-sq-ink-2">
              {v.changeSummary.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Button onClick={() => publish(v.version)} disabled={!!busy}>
              {busy === v.version ? <Spinner /> : tr(`Publish Terms v${v.version} (demo)`, `Publier les conditions v${v.version} (démo)`)}
            </Button>
          </div>
        ))}
        {!drafts.length && data && (
          <Button variant="ghost" onClick={resetDemo} disabled={!!busy}>
            {tr('Reset the terms demo (unpublish later versions)', 'Réinitialiser la démo des conditions (dépublier les versions suivantes)')}
          </Button>
        )}
        {msg && <p className="text-[13px] text-sq-ink-2" role="status">{msg}</p>}
      </Card>
    </section>
  );
}
