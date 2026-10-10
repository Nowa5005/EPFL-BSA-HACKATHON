// Transaction receipt (justificatif): one data model, rendered as HTML (preview) and as a PDF (jsPDF,
// generated client-side). It is derived from the transaction — never contains keys, codes or key shares,
// and a name is shown only when it is known (address book / own Swissquote account), never inferred.

import { MOCK_ETH_CHF, MOCK_USDC_CHF } from '@sq/shared';
import { fmt, STATUS_LABEL } from '../components/ui';
import type { WalletTxView } from './hooks';

export interface ReceiptRow {
  label: string;
  value: string;
  mono?: boolean;
}

export interface Receipt {
  reference: string;
  title: string;
  type: string;
  typeSlug: string;
  simulated: boolean;
  rows: ReceiptRow[];
  explorer?: string;
  fileName: string;
  date: string;
}

const TZ = 'Europe/Zurich';

function zurich(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('fr-CH', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-CH', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const off = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? '';
  return { date, time, tz: `Europe/Zurich (${off.replace('GMT', 'UTC') || 'UTC'})`, isoDay: d.toLocaleDateString('sv-SE', { timeZone: TZ }) };
}

export function buildReceipt(t: WalletTxView, clientName: string): Receipt {
  const type = t.kind === 'receive' ? 'Réception' : t.kind === 'send' ? 'Envoi' : 'Échange';
  const typeSlug = t.kind === 'receive' ? 'reception' : t.kind === 'send' ? 'envoi' : 'echange';
  const when = zurich(t.confirmedAt ?? t.createdAt);
  const own = `${clientName} (My Wall)`;
  const fromName = t.kind === 'send' ? own : t.counterpartyName;
  const toName = t.kind === 'receive' ? own : t.counterpartyName;
  const amount = Number(t.amount);
  const rate = t.asset === 'USDC' ? MOCK_USDC_CHF : MOCK_ETH_CHF;
  const fees = t.simulated
    ? 'Aucun (réception simulée)'
    : t.feesSponsored
      ? `0.00 ${t.asset === 'ETH' ? 'ETH' : 'CHF'} — offerts par Swissquote`
      : "Payés par l'émetteur";
  const rows: ReceiptRow[] = [
    { label: 'Référence du document', value: t.reference, mono: true },
    { label: 'Type', value: type + (t.simulated ? ' (simulée — démo)' : '') },
    { label: 'Statut', value: STATUS_LABEL[t.status] },
    { label: 'Réseau', value: 'Ethereum Sepolia (réseau de test)' },
    { label: 'Actif', value: t.asset },
    { label: 'Montant', value: `${t.amount} ${t.asset}` },
    { label: 'Frais', value: fees },
    { label: 'Date', value: when.date },
    { label: 'Heure', value: when.time },
    { label: 'Fuseau horaire', value: when.tz },
    { label: "Adresse d'origine", value: t.simulated ? '— (simulation, aucune transaction blockchain)' : t.from || '—', mono: !t.simulated },
    ...(fromName ? [{ label: 'Émetteur', value: fromName }] : []),
    { label: 'Adresse de destination', value: t.to, mono: true },
    ...(toName ? [{ label: 'Destinataire', value: toName }] : []),
    { label: 'Motif / note', value: t.simulated ? 'Non renseigné' : t.note || 'Non renseigné' },
    { label: 'Contre-valeur indicative', value: `${fmt(amount * rate)} CHF (taux indicatif 1 ${t.asset} = ${fmt(rate)} CHF)` },
    { label: 'Identifiant de transaction', value: t.txHash ?? (t.simulated ? `Simulation ${t.id}` : '—'), mono: true },
  ];
  return {
    reference: t.reference,
    title: 'My Wall — Justificatif de transaction',
    type,
    typeSlug,
    simulated: !!t.simulated,
    rows,
    explorer: t.explorer,
    date: when.isoDay,
    fileName: `${when.isoDay}_${typeSlug}_${t.asset}_${t.reference}.pdf`,
  };
}

let logoData: Promise<string> | null = null;
function loadLogo() {
  logoData ??= fetch('/brand/swissquote-logo.png')
    .then((r) => r.blob())
    .then(
      (b) =>
        new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result as string);
          fr.onerror = rej;
          fr.readAsDataURL(b);
        }),
    );
  return logoData;
}

export async function downloadReceiptPdf(r: Receipt) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const ink: [number, number, number] = [48, 49, 55];
  const muted: [number, number, number] = [111, 116, 128];
  try {
    doc.addImage(await loadLogo(), 'PNG', 18, 16, 14, 14, undefined, 'FAST');
  } catch {
    /* logo optional */
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...ink);
  doc.text(r.title, 36, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text('Prototype — données de test. Swissquote Wallet Challenge (EPFL).', 36, 27.5);
  if (r.simulated) {
    doc.setTextColor(178, 106, 0);
    doc.text('RÉCEPTION SIMULÉE — aucune transaction sur la blockchain', 36, 32);
  }
  doc.setDrawColor(227, 230, 238);
  doc.line(18, 37, 192, 37);
  let y = 46;
  for (const row of r.rows) {
    doc.setFontSize(9);
    doc.setTextColor(...muted);
    doc.setFont('helvetica', 'normal');
    doc.text(row.label, 18, y);
    doc.setTextColor(...ink);
    doc.setFont(row.mono ? 'courier' : 'helvetica', 'normal');
    doc.setFontSize(row.mono ? 9 : 10);
    const lines = doc.splitTextToSize(row.value, 120) as string[];
    doc.text(lines, 72, y);
    y += Math.max(7, lines.length * 4.6 + 2.4);
  }
  if (r.explorer) {
    y += 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(47, 111, 237);
    doc.textWithLink('Voir la transaction sur Etherscan (Sepolia)', 18, y, { url: r.explorer });
    y += 8;
  }
  doc.setDrawColor(227, 230, 238);
  doc.line(18, 270, 192, 270);
  doc.setFontSize(8);
  doc.setTextColor(...muted);
  doc.text(
    doc.splitTextToSize(
      "Document généré par My Wall à partir des données de la transaction. Ce justificatif ne contient aucune clé privée, aucun code de récupération ni aucune part de clé. Contre-valeur en CHF à titre indicatif. Réseau de test : aucune valeur réelle.",
      174,
    ),
    18,
    276,
  );
  doc.save(r.fileName);
}

export function ReceiptView({ r }: { r: Receipt }) {
  return (
    <article className="rounded-[12px] border border-sq-line bg-white p-5" aria-label={`Justificatif ${r.reference}`}>
      <header className="flex items-start gap-3 border-b border-sq-line pb-4">
        <img src="/brand/swissquote-logo.png" alt="" width={36} height={36} className="rounded-full" />
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold">{r.title}</h3>
          <p className="text-[12px] text-sq-muted">Prototype — données de test</p>
          {r.simulated && <p className="mt-1 text-[12px] font-medium text-sq-warn">Réception simulée — aucune transaction sur la blockchain</p>}
        </div>
      </header>
      <dl className="mt-3 divide-y divide-sq-line">
        {r.rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(0,40%)_1fr] gap-3 py-2 text-[13px]">
            <dt className="text-sq-muted">{row.label}</dt>
            <dd className={row.mono ? 'break-all font-mono text-[12px]' : 'text-sq-ink'}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {r.explorer && (
        <a className="mt-3 inline-block text-[13px] font-medium underline decoration-sq-line underline-offset-2" href={r.explorer} target="_blank" rel="noreferrer">
          Voir la transaction sur Etherscan
        </a>
      )}
      <p className="mt-4 text-[11px] text-sq-muted">Aucune clé privée, aucun code de récupération ni part de clé dans ce document.</p>
    </article>
  );
}
