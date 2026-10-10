// Transaction receipt (justificatif): one data model, rendered as HTML (preview) and as a PDF (jsPDF,
// generated client-side). It is derived from the transaction — never contains keys, codes or key shares,
// and a name is shown only when it is known (address book / own Swissquote account), never inferred.

import { dateTime, fmt, STATUS_LABEL } from '../components/ui';
import { useMasked } from './prefs';
import { locale, tr } from './i18n';
import type { WalletTxView } from './hooks';

export interface ReceiptRow {
  label: string;
  value: string;
  mono?: boolean;
  /** personal amount: masked on screen while amounts are hidden */
  sensitive?: boolean;
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
  const date = d.toLocaleDateString(locale(), { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString(locale(), { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const off = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? '';
  return { date, time, tz: `Europe/Zurich (${off.replace('GMT', 'UTC') || 'UTC'})`, isoDay: d.toLocaleDateString('sv-SE', { timeZone: TZ }) };
}

export function buildReceipt(t: WalletTxView, clientName: string): Receipt {
  const type = t.kind === 'receive' ? tr('Received', 'Réception') : t.kind === 'send' ? tr('Sent', 'Envoi') : tr('Swap', 'Échange');
  const typeSlug = t.kind === 'receive' ? tr('received', 'reception') : t.kind === 'send' ? tr('sent', 'envoi') : tr('swap', 'echange');
  const when = zurich(t.confirmedAt ?? t.createdAt);
  const own = `${clientName} (My Wall)`;
  const fromName = t.kind === 'send' ? own : t.counterpartyName;
  const toName = t.kind === 'receive' ? own : t.counterpartyName;
  const amount = Number(t.amount);
  // CHF counter-value: only with the price captured at transaction time — never today's price on an old tx.
  const v = t.valuation;
  const counterValue = t.simulated
    ? tr('None (simulated receipt, no value)', 'Aucune (réception simulée, sans valeur)')
    : v
      ? tr(
          `${fmt(amount * v.chf)} CHF — indicative valuation at transaction time (1 ${t.asset} = ${fmt(v.chf, v.chf < 10 ? 4 : 2)} CHF, ${v.provider}, ${dateTime(v.asOf)})`,
          `${fmt(amount * v.chf)} CHF — valorisation indicative au moment de la transaction (1 ${t.asset} = ${fmt(v.chf, v.chf < 10 ? 4 : 2)} CHF, ${v.provider}, ${dateTime(v.asOf)})`,
        )
      : tr('CHF value unavailable (no market price was recorded at transaction time)', 'Contre-valeur CHF indisponible (aucun cours enregistré au moment de la transaction)');
  const fees = t.simulated
    ? tr('None (simulated receipt)', 'Aucun (réception simulée)')
    : t.feesSponsored
      ? `0.00 ${t.asset === 'ETH' ? 'ETH' : 'CHF'} — ${tr('paid by Swissquote', 'offerts par Swissquote')}`
      : tr('Paid by the sender', "Payés par l'émetteur");
  const rows: ReceiptRow[] = [
    { label: tr('Document reference', 'Référence du document'), value: t.reference, mono: true },
    { label: 'Type', value: type + (t.simulated ? tr(' (simulated — demo)', ' (simulée — démo)') : '') },
    { label: tr('Status', 'Statut'), value: STATUS_LABEL[t.status] },
    { label: tr('Network', 'Réseau'), value: tr('Ethereum Sepolia (testnet)', 'Ethereum Sepolia (réseau de test)') },
    { label: tr('Asset', 'Actif'), value: t.asset },
    { label: tr('Amount', 'Montant'), value: `${t.amount} ${t.asset}`, sensitive: true },
    { label: tr('Fees', 'Frais'), value: fees },
    { label: 'Date', value: when.date },
    { label: tr('Time', 'Heure'), value: when.time },
    { label: tr('Time zone', 'Fuseau horaire'), value: when.tz },
    { label: tr('From address', "Adresse d'origine"), value: t.simulated ? tr('— (simulation, no blockchain transaction)', '— (simulation, aucune transaction blockchain)') : t.from || '—', mono: !t.simulated },
    ...(fromName ? [{ label: tr('Sender', 'Émetteur'), value: fromName }] : []),
    { label: tr('To address', 'Adresse de destination'), value: t.to, mono: true },
    ...(toName ? [{ label: tr('Recipient', 'Destinataire'), value: toName }] : []),
    { label: tr('Reference / note', 'Motif / note'), value: t.simulated ? tr('Not provided', 'Non renseigné') : t.note || tr('Not provided', 'Non renseigné') },
    { label: tr('Indicative CHF value', 'Contre-valeur indicative'), value: counterValue, sensitive: !!v },
    { label: tr('Transaction ID', 'Identifiant de transaction'), value: t.txHash ?? (t.simulated ? `Simulation ${t.id}` : '—'), mono: true },
    ...(t.kind === 'send' && t.travelRule ? [{ label: 'Travel Rule', value: travelRuleText(t.travelRule) }] : []),
  ];
  return {
    reference: t.reference,
    title: tr('My Wall — Transaction receipt', 'My Wall — Justificatif de transaction'),
    type,
    typeSlug,
    simulated: !!t.simulated,
    rows,
    explorer: t.explorer,
    date: when.isoDay,
    fileName: `${when.isoDay}_${typeSlug}_${t.asset}_${t.reference}.pdf`,
  };
}

/** #9 — Travel Rule line of a receipt: how the rule was satisfied, without any personal data. */
export function travelRuleText(r: NonNullable<WalletTxView['travelRule']>): string {
  if (r.category === 'own') return tr('Your own verified wallet — no third-party data required', 'Votre propre wallet vérifié — aucune donnée de tiers requise');
  if (r.route === 'vasp')
    return r.status === 'approved'
      ? tr(
          `Transmitted to ${r.vaspName} before co-signing — approved (reference ${r.reference}${r.transmittedAt ? `, ${dateTime(r.transmittedAt)}` : ''})`,
          `Transmis à ${r.vaspName} avant la co-signature — approuvé (référence ${r.reference}${r.transmittedAt ? `, ${dateTime(r.transmittedAt)}` : ''})`,
        )
      : tr(`Transmission to ${r.vaspName}: ${r.status ?? 'pending'}`, `Transmission à ${r.vaspName} : ${r.status ?? 'en attente'}`);
  if (r.route === 'self-hosted-proof') return tr('Personal wallet — ownership proven by the beneficiary (signed message)', 'Wallet personnel — propriété prouvée par le bénéficiaire (message signé)');
  if (r.route === 'self-hosted-declaration') return tr('Personal wallet — declared by the sender (below the threshold)', 'Wallet personnel — déclaré par l’expéditeur (sous le seuil)');
  if (r.legacyDemo) return tr('Collected, not transmitted (former demo mode)', 'Collecté, non transmis (ancien mode démo)');
  return '—';
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
  doc.text(tr('Prototype — test data. Swissquote Wallet Challenge (EPFL).', 'Prototype — données de test. Swissquote Wallet Challenge (EPFL).'), 36, 27.5);
  if (r.simulated) {
    doc.setTextColor(178, 106, 0);
    doc.text(tr('SIMULATED RECEIPT — no transaction on the blockchain', 'RÉCEPTION SIMULÉE — aucune transaction sur la blockchain'), 36, 32);
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
    doc.textWithLink(tr('View the transaction on Etherscan (Sepolia)', 'Voir la transaction sur Etherscan (Sepolia)'), 18, y, { url: r.explorer });
    y += 8;
  }
  doc.setDrawColor(227, 230, 238);
  doc.line(18, 270, 192, 270);
  doc.setFontSize(8);
  doc.setTextColor(...muted);
  doc.text(
    doc.splitTextToSize(
      tr(
        'Document generated by My Wall from the transaction data. This receipt contains no private key, no recovery code and no key share. CHF value for information only (price recorded at transaction time, otherwise shown as unavailable). Testnet: no real value.',
        "Document généré par My Wall à partir des données de la transaction. Ce justificatif ne contient aucune clé privée, aucun code de récupération ni aucune part de clé. Contre-valeur en CHF à titre indicatif (cours enregistré au moment de la transaction, sinon indiquée indisponible). Réseau de test : aucune valeur réelle.",
      ),
      174,
    ),
    18,
    276,
  );
  doc.save(r.fileName);
}

export function ReceiptView({ r }: { r: Receipt }) {
  const masked = useMasked();
  return (
    <article className="rounded-[12px] border border-sq-line bg-sq-surface p-5" aria-label={tr(`Receipt ${r.reference}`, `Justificatif ${r.reference}`)}>
      <header className="flex items-start gap-3 border-b border-sq-line pb-4">
        <img src="/brand/swissquote-logo.png" alt="" width={36} height={36} className="rounded-full" />
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold">{r.title}</h3>
          <p className="text-[12px] text-sq-muted">{tr('Prototype — test data', 'Prototype — données de test')}</p>
          {r.simulated && <p className="mt-1 text-[12px] font-medium text-sq-warn">{tr('Simulated receipt — no transaction on the blockchain', 'Réception simulée — aucune transaction sur la blockchain')}</p>}
        </div>
      </header>
      <dl className="mt-3 divide-y divide-sq-line">
        {r.rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(0,40%)_1fr] gap-3 py-2 text-[13px]">
            <dt className="text-sq-muted">{row.label}</dt>
            <dd className={row.mono ? 'break-all font-mono text-[12px]' : 'text-sq-ink'} aria-label={masked && row.sensitive ? tr('Amount hidden', 'Montant masqué') : undefined}>
              {masked && row.sensitive ? '••••••' : row.value}
            </dd>
          </div>
        ))}
      </dl>
      {r.explorer && (
        <a className="mt-3 inline-block text-[13px] font-medium underline decoration-sq-line underline-offset-2" href={r.explorer} target="_blank" rel="noreferrer">
          {tr('View the transaction on Etherscan', 'Voir la transaction sur Etherscan')}
        </a>
      )}
      <p className="mt-4 text-[11px] text-sq-muted">{tr('No private key, recovery code or key share in this document.', 'Aucune clé privée, aucun code de récupération ni part de clé dans ce document.')}</p>
    </article>
  );
}
