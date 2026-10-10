// Documents → annual statement (help for the Swiss tax return, NOT an official tax certificate) and CSV export of
// the year's transactions. Both are computed by the co-signer (authenticated). Amounts are masked by default: the
// client must reveal them (passkey) before viewing or downloading.

import { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import { cosigner } from '../lib/api';
import { tr, locale } from '../lib/i18n';
import { useLocal, usePoll } from '../lib/hooks';
import { revealAmounts, revealErrorMessage, useMasked } from '../lib/prefs';
import { Button, Card, cx, fmt, MockBadge, Notice, Pill, Spinner } from './ui';

interface YearInfo {
  year: number;
  closed: boolean;
  cutoff: string;
}

export function AnnualDocuments() {
  const { device, session } = useLocal();
  const clientId = device!.clientId;
  const masked = useMasked();
  const years = usePoll<{ walletCreatedAt: string | null; years: YearInfo[] }>(() => cosigner.get(`/clients/${clientId}/statements/years`), 600000, [clientId]);
  const [year, setYear] = useState<number | null>(null);
  const [st, setSt] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (year === null && years.data?.years.length) setYear((years.data.years.find((y) => y.closed) ?? years.data.years[0]).year);
  }, [years.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setSt(null), [year]);

  const sel = years.data?.years.find((y) => y.year === year);

  const ensureRevealed = async () => {
    if (!masked) return true;
    try {
      await revealAmounts(clientId);
      return true;
    } catch (e) {
      setErr(revealErrorMessage(e));
      return false;
    }
  };

  const loadStatement = async () => {
    setErr(null);
    if (!(await ensureRevealed())) return null;
    setBusy('view');
    try {
      const s = await cosigner.get(`/clients/${clientId}/statements/${year}`);
      setSt(s);
      return s;
    } catch (e: any) {
      setErr(e.message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const pdf = async () => {
    const s = st ?? (await loadStatement());
    if (!s) return;
    setBusy('pdf');
    try {
      await downloadStatementPdf(s, session?.profile?.name ?? s.account.name);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const csv = async () => {
    setErr(null);
    if (!(await ensureRevealed())) return;
    setBusy('csv');
    try {
      const r = await cosigner.get(`/clients/${clientId}/exports/transactions/${year}`);
      const url = URL.createObjectURL(new Blob([r.csv], { type: r.mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="mb-4 space-y-3" as="section">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold">{tr('Annual statement & export', 'Relevé annuel et export')}</h2>
        <MockBadge label={tr('Testnet', 'Réseau de test')} />
      </div>
      <p className="text-[13px] text-sq-ink-2">
        {tr(
          'Holdings of your My Wall wallet at 31 December 23:59:59 (Europe/Zurich), to help with your Swiss tax return, and the CSV of all the year’s transactions. Not an official Swissquote tax certificate.',
          'Avoirs de votre wallet My Wall au 31 décembre 23:59:59 (Europe/Zurich), pour vous aider à remplir votre déclaration d’impôt suisse, et le CSV de toutes les transactions de l’année. Pas une attestation fiscale officielle de Swissquote.',
        )}
      </p>
      {years.error && !years.data ? (
        <Notice tone="bad">{years.error}</Notice>
      ) : !years.data ? (
        <Spinner />
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={tr('Year', 'Année')}>
            {years.data.years.map((y) => (
              <Pill key={y.year} active={year === y.year} onClick={() => setYear(y.year)}>
                {y.year}
                {!y.closed && ` · ${tr('provisional', 'provisoire')}`}
              </Pill>
            ))}
          </div>
          {sel && !sel.closed && (
            <Notice tone="warn">
              {tr(
                `${sel.year} is not closed yet: the statement is provisional, as of now — not a year-end statement.`,
                `${sel.year} n’est pas encore close : le relevé est provisoire, à la date d’aujourd’hui — pas un relevé de fin d’année.`,
              )}
            </Notice>
          )}
          {years.data.walletCreatedAt && (
            <p className="text-[12px] text-sq-muted">
              {tr('Wallet created on ', 'Wallet créé le ')}
              {new Date(years.data.walletCreatedAt).toLocaleDateString(locale(), { timeZone: 'Europe/Zurich' })}
              {tr(': earlier years have no holdings in this wallet.', ' : les années antérieures n’ont aucun avoir dans ce wallet.')}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <Button variant="secondary" onClick={loadStatement} disabled={!year || !!busy}>
              {busy === 'view' ? <Spinner /> : null} {tr('View statement', 'Voir le relevé')}
            </Button>
            <Button variant="secondary" onClick={pdf} disabled={!year || !!busy}>
              <Download size={18} strokeWidth={1.75} /> {tr('Statement (PDF)', 'Relevé (PDF)')}
            </Button>
            <Button variant="secondary" onClick={csv} disabled={!year || !!busy}>
              <FileSpreadsheet size={18} strokeWidth={1.75} /> {tr('Transactions (CSV)', 'Transactions (CSV)')}
            </Button>
          </div>
          {masked && <p className="text-[12px] text-sq-muted">{tr('Amounts are hidden: you will be asked to confirm with your passkey before viewing or downloading.', 'Les montants sont masqués : une confirmation par passkey vous sera demandée avant l’affichage ou le téléchargement.')}</p>}
        </>
      )}
      {err && <Notice tone="bad">{err}</Notice>}
      {st && !masked && <StatementView s={st} />}
    </Card>
  );
}

const valKind = (k: string) =>
  ({
    official: tr('Official ESTV rate', 'Cours officiel AFC'),
    estimated: tr('Estimated — not the official ESTV rate', 'Estimé — pas le cours officiel AFC'),
    'provisional-market': tr('Provisional market price', 'Prix de marché provisoire'),
    missing: tr('Missing', 'Manquant'),
  })[k] ?? k;

function StatementView({ s }: { s: any }) {
  return (
    <article id="annual-statement" className="space-y-3 rounded-[12px] border border-sq-line bg-white p-4 text-[13px]" aria-label={tr('Annual statement', 'Relevé annuel')}>
      <header className="space-y-1 border-b border-sq-line pb-3">
        <h3 className="text-[15px] font-semibold">
          {tr('My Wall — Statement of holdings', 'My Wall — Relevé des avoirs')} {s.year} {!s.closed && <span className="text-sq-warn">({tr('provisional', 'provisoire')})</span>}
        </h3>
        <p className="text-sq-muted">
          {s.account.name} · {tr('client no.', 'client n°')} {s.account.clientId}
        </p>
        <p className="text-sq-muted">
          {tr('Reference date', 'Date de référence')}: {s.closed ? s.cutoff.local : s.asOf.local} ({s.cutoff.timeZone})
        </p>
      </header>
      <Notice tone="warn">{s.testnetNotice}</Notice>
      {!s.held ? (
        <p className="font-medium">{s.notHeldReason}</p>
      ) : (
        <table className="w-full">
          <thead className="text-left text-[12px] text-sq-muted">
            <tr>
              <th className="py-1">{tr('Asset', 'Actif')}</th>
              <th className="py-1 text-right">{tr('Quantity', 'Quantité')}</th>
              <th className="py-1 text-right">{tr('CHF rate', 'Cours CHF')}</th>
              <th className="py-1 text-right">{tr('Value CHF', 'Valeur CHF')}</th>
            </tr>
          </thead>
          <tbody>
            {s.lines.map((l: any) => (
              <tr key={l.asset} className="border-t border-sq-line align-top">
                <td className="py-1.5">
                  {l.asset}
                  <span className="block text-[11px] text-sq-muted">{l.network}</span>
                </td>
                <td className="num py-1.5 text-right">{l.quantity ?? '—'}</td>
                <td className="num py-1.5 text-right">
                  {l.valuation.chf === null ? '—' : fmt(l.valuation.chf, l.asset === 'USDC' ? 4 : 2)}
                  <span className={cx('block text-[11px]', l.valuation.kind === 'official' ? 'text-sq-up' : 'text-sq-warn')}>{valKind(l.valuation.kind)}</span>
                </td>
                <td className="num py-1.5 text-right">{l.valueChf === null ? tr('unavailable', 'indisponible') : fmt(l.valueChf)}</td>
              </tr>
            ))}
            <tr className="border-t border-sq-ink/30 font-semibold">
              <td className="py-1.5" colSpan={3}>
                {tr('Total crypto holdings covered', 'Total de la fortune crypto couverte')} {!s.totalComplete && `(${tr('incomplete', 'incomplet')})`}
              </td>
              <td className="num py-1.5 text-right">{fmt(s.totalChf)} CHF</td>
            </tr>
          </tbody>
        </table>
      )}
      <dl className="space-y-1 text-[12px]">
        <div>
          <dt className="inline text-sq-muted">{tr('Method: ', 'Méthode : ')}</dt>
          <dd className="inline">{s.method}</dd>
        </div>
        {s.lines?.map((l: any) => (
          <div key={l.asset}>
            <dt className="inline text-sq-muted">{tr(`${l.asset} valuation source: `, `Source du cours ${l.asset} : `)}</dt>
            <dd className="inline">
              {l.valuation.source}
              {l.valuation.rateDate ? ` (${l.valuation.rateDate})` : ''}
            </dd>
          </div>
        ))}
        <div>
          <dt className="inline text-sq-muted">{tr('Wallets covered: ', 'Wallets couverts : ')}</dt>
          <dd className="inline break-all">{s.walletsCovered.map((w: any) => `${w.label} ${w.address} (${w.network})`).join('; ') || '—'}</dd>
        </div>
        {s.excluded.map((x: string) => (
          <div key={x} className="text-sq-muted">
            {x}
          </div>
        ))}
      </dl>
      {s.warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-[12px] text-sq-warn">
          {s.warnings.map((w: string) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-sq-muted">{s.disclaimer}</p>
      <Button variant="ghost" className="w-auto px-3 text-[13px] print:hidden" onClick={() => window.print()}>
        <Printer size={16} strokeWidth={1.75} /> {tr('Print', 'Imprimer')}
      </Button>
    </article>
  );
}

/** PDF of the statement (jsPDF, generated in the browser from the server's statement). */
export async function downloadStatementPdf(s: any, name: string) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const ink: [number, number, number] = [48, 49, 55];
  const muted: [number, number, number] = [111, 116, 128];
  const warn: [number, number, number] = [178, 106, 0];
  let y = 20;
  const text = (t: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; x?: number; width?: number } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.size ?? 10);
    doc.setTextColor(...(opts.color ?? ink));
    const lines = doc.splitTextToSize(t, opts.width ?? 174) as string[];
    if (y + lines.length * 4.6 > 285) {
      doc.addPage();
      y = 20;
    }
    doc.text(lines, opts.x ?? 18, y);
    y += lines.length * ((opts.size ?? 10) * 0.45) + 2;
  };
  text(`${tr('My Wall — Statement of holdings', 'My Wall — Relevé des avoirs')} ${s.year}${s.closed ? '' : ` (${tr('provisional', 'provisoire')})`}`, { size: 15, bold: true });
  text(tr('Help for your Swiss tax return — not an official Swissquote tax certificate. Prototype, test data.', 'Aide à la déclaration d’impôt — pas une attestation fiscale officielle de Swissquote. Prototype, données de test.'), { size: 9, color: muted });
  y += 2;
  text(`${tr('Account holder', 'Titulaire')}: ${name} · ${tr('client no.', 'client n°')} ${s.account.clientId}`);
  text(`${tr('Reference date (cut-off)', 'Date de référence (coupure)')}: ${s.cutoff.local} ${s.cutoff.timeZone} = ${s.cutoff.utc} UTC`);
  if (!s.closed) text(`${tr('Provisional, as of', 'Provisoire, au')} ${s.asOf.local}`, { color: warn });
  text(`${tr('Generated', 'Généré le')}: ${s.generatedAt}`, { size: 9, color: muted });
  y += 2;
  text(s.testnetNotice, { color: warn, bold: true, size: 10 });
  y += 2;
  if (!s.held) text(s.notHeldReason, { bold: true });
  else {
    text(`${tr('Asset', 'Actif')} / ${tr('Network', 'Réseau')}`, { bold: true, size: 9, color: muted, width: 60 });
    y -= 6;
    text(tr('Quantity', 'Quantité'), { bold: true, size: 9, color: muted, x: 80, width: 40 });
    y -= 6;
    text(tr('CHF rate', 'Cours CHF'), { bold: true, size: 9, color: muted, x: 125, width: 30 });
    y -= 6;
    text(tr('Value CHF', 'Valeur CHF'), { bold: true, size: 9, color: muted, x: 160, width: 30 });
    for (const l of s.lines) {
      const y0 = y;
      text(`${l.asset} — ${l.network}`, { width: 60 });
      const y1 = y;
      y = y0;
      text(String(l.quantity ?? '—'), { x: 80, width: 44 });
      y = y0;
      text(l.valuation.chf === null ? '—' : String(l.valuation.chf), { x: 125, width: 33 });
      y = y0;
      text(l.valueChf === null ? tr('unavailable', 'indisponible') : fmt(l.valueChf), { x: 160, width: 32 });
      y = Math.max(y, y1);
      text(`${valKind(l.valuation.kind)} — ${l.valuation.source}${l.valuation.rateDate ? ` (${l.valuation.rateDate})` : ''}`, { size: 8, color: muted });
    }
    y += 1;
    text(`${tr('Total crypto holdings covered', 'Total de la fortune crypto couverte')}: ${fmt(s.totalChf)} CHF${s.totalComplete ? '' : ` (${tr('incomplete', 'incomplet')})`}`, { bold: true });
  }
  y += 2;
  text(`${tr('Method', 'Méthode')}: ${s.method}`, { size: 9 });
  text(`${tr('Wallets covered', 'Wallets couverts')}: ${s.walletsCovered.map((w: any) => `${w.label} ${w.address} (${w.network})`).join('; ') || '—'}`, { size: 9 });
  for (const x of s.excluded) text(x, { size: 9, color: muted });
  for (const w of s.warnings) text(`! ${w}`, { size: 9, color: warn });
  y += 2;
  text(s.disclaimer, { size: 8, color: muted });
  doc.save(`mywall-statement-${s.account.clientId}-${s.year}${s.closed ? '' : '-provisional'}.pdf`);
}
