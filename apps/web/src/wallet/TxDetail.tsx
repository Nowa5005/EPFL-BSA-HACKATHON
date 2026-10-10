import { useParams } from 'react-router-dom';
import { Download, FileText } from 'lucide-react';
import { cosigner } from '../lib/api';
import { useLocal, usePoll, type WalletTxView } from '../lib/hooks';
import { buildReceipt, downloadReceiptPdf, ReceiptView } from '../lib/receipt';
import { Button, Card, dateTime, Notice, PageHeader, Skeleton, StatusPill, TxLink } from '../components/ui';
import { ConfirmedCard, PendingIndicator } from '../components/Confirm';
import { counterparty, kindLabel, SignedAmount } from './TxList';
import { tr } from '../lib/i18n';
import { isSuspicious, ScamExplanation } from './scam';

export default function TxDetail() {
  const { id } = useParams();
  const { session } = useLocal();
  const { data: t, error } = usePoll<WalletTxView>(() => cosigner.get(`/wallet-txs/${id}`), 3000, [id]);
  const name = session?.profile?.name ?? '';

  if (error) return <Notice tone="bad" title={tr('Transaction not found', 'Transaction introuvable')}>{error}</Notice>;
  if (!t) return <Skeleton className="h-64" />;
  const receipt = t.status === 'confirmed' && !isSuspicious(t) ? buildReceipt(t, name) : null;

  return (
    <div className="lg:grid lg:grid-cols-12 lg:gap-6">
      <div className="lg:col-span-5">
        <PageHeader title={kindLabel(t.kind)} back="/wallet/transactions" />
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <SignedAmount t={t} className="text-[26px]" />
            <StatusPill status={t.status} />
          </div>
          <ScamExplanation t={t} />
          {t.status === 'confirmed' && isSuspicious(t) ? null : t.status === 'confirmed' ? (
            <ConfirmedCard tx={t} clientName={name} />
          ) : t.status === 'failed' ? (
            <Notice tone="bad" title={tr('Transaction failed', 'Transaction échouée')}>{t.error ?? tr('The transaction did not go through. Your funds have not moved.', 'La transaction n’a pas abouti. Vos fonds n’ont pas bougé.')}</Notice>
          ) : (
            <PendingIndicator />
          )}
          <dl className="divide-y divide-sq-line text-[14px]">
            <Row k={t.kind === 'receive' ? tr('From', 'De') : tr('To', 'À')} v={counterparty(t)} />
            <Row k={tr('Created on', 'Créée le')} v={dateTime(t.createdAt)} />
            {t.confirmedAt && <Row k={tr('Confirmed on', 'Confirmée le')} v={dateTime(t.confirmedAt)} />}
            <Row k={tr('Fees', 'Frais')} v={t.simulated ? tr('None (simulation)', 'Aucun (simulation)') : t.feesSponsored ? tr('Paid by Swissquote', 'Offerts par Swissquote') : tr('Paid by the sender', "Payés par l'émetteur")} />
            {t.note && <Row k={tr('Reference note', 'Motif')} v={t.note} />}
            <Row k={tr('Reference', 'Référence')} v={t.reference} />
          </dl>
          {t.txHash && <TxLink hash={t.txHash} />}
          {t.simulated && <p className="text-[12px] text-sq-muted">{tr('Simulated incoming payment for the demo: no transaction on the blockchain.', 'Réception simulée pour la démo : aucune transaction sur la blockchain.')}</p>}
        </Card>
      </div>
      <div className="mt-5 lg:col-span-7 lg:mt-0">
        <h2 className="mb-3 flex items-center gap-2 text-[17px] font-semibold">
          <FileText size={20} strokeWidth={1.75} /> {tr('Receipt', 'Justificatif')}
        </h2>
        {receipt ? (
          <>
            <ReceiptView r={receipt} />
            <Button
              className="mt-3"
              onClick={() => void downloadReceiptPdf(receipt)}
            >
              <Download size={18} strokeWidth={1.75} /> {tr('Download the PDF', 'Télécharger le PDF')}
            </Button>
            <p className="mt-2 text-[12px] text-sq-muted">{tr('The same document is in Swaplet → Documents.', 'Le même document figure dans Swaplet → Documents.')}</p>
          </>
        ) : (
          <Card className="text-[14px] text-sq-muted">{isSuspicious(t) ? tr('No receipt for a suspicious transfer.', 'Pas de justificatif pour un transfert suspect.') : tr('The receipt will be available as soon as the transaction is confirmed.', 'Le justificatif sera disponible dès la confirmation de la transaction.')}</Card>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 py-2.5">
      <dt className="text-sq-muted">{k}</dt>
      <dd className="text-right font-medium text-sq-ink">{v}</dd>
    </div>
  );
}
