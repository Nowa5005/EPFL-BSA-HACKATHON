// Authorised apps: ERC-20 allowances read ON-CHAIN. Revoking = approve(spender, 0) through the normal
// confirmation flow; it only counts once confirmed on the chain.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KeySquare, RefreshCw } from 'lucide-react';
import { USDC_ADDRESS, buildSafeTx, erc20Iface, type SafeTx } from '@sq/shared';
import { cosigner } from '../lib/api';
import { useLocal, usePoll } from '../lib/hooks';
import { Addr, Button, Card, cx, dateTime, Notice, PageHeader, Skeleton, Why } from '../components/ui';
import { TxFlow } from '../components/TxFlow';
import { tr } from '../lib/i18n';

export default function Approvals() {
  const { device } = useLocal();
  const { data, loading, error, reload } = usePoll<any[]>(() => cosigner.get(`/clients/${device!.clientId}/allowances`), 15000, [device?.clientId]);
  const [tx, setTx] = useState<SafeTx | null>(null);
  const [target, setTarget] = useState<any>(null);

  const revoke = async (row: any) => {
    const nonce = (await cosigner.get(`/clients/${device!.clientId}/onchain`)).nonce;
    setTarget(row);
    setTx(buildSafeTx({ to: USDC_ADDRESS, data: erc20Iface.encodeFunctionData('approve', [row.spender, 0n]), nonce }));
  };

  if (tx)
    return (
      <div className="mx-auto max-w-[640px]">
        <PageHeader title={tr(`Revoke access for ${target?.name ?? 'the app'}`, `Retirer l’accès de ${target?.name ?? 'l’application'}`)} />
        <TxFlow
          clientId={device!.clientId}
          safeAddress={device!.safeAddress!}
          safeTx={tx}
          onBack={() => {
            setTx(null);
            void reload();
          }}
          onDone={() => setTimeout(() => void reload(), 3000)}
        />
        <Button variant="ghost" className="mt-3" onClick={() => { setTx(null); void reload(); }}>
          {tr('Back to authorised apps', 'Retour aux applications autorisées')}
        </Button>
      </div>
    );

  return (
    <div className="mx-auto max-w-[760px] space-y-4">
      <PageHeader title={tr('Authorised apps', 'Applications autorisées')} back="/wallet/more" subtitle={tr('Apps and contracts that can spend your tokens, read directly from the blockchain.', 'Applications et contrats qui peuvent dépenser vos jetons, lus directement sur la blockchain.')} />
      <Why>{tr('An authorisation (“approve”) lets a contract take your tokens up to the stated limit, without any new signature from you. Revoke the ones you no longer need. Revoking is a transaction: it only takes effect once confirmed on Ethereum.', 'Une autorisation (« approve ») permet à un contrat de prélever vos jetons jusqu’au plafond indiqué, sans nouvelle signature de votre part. Retirez celles dont vous n’avez plus besoin. La révocation est une transaction : elle n’est effective qu’une fois confirmée sur Ethereum.')}</Why>
      {error && <Notice tone="warn" title={tr('Could not read', 'Lecture impossible')}>{error}</Notice>}
      <Card className="p-0">
        {loading && !data ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : !(data ?? []).length ? (
          <div className="p-6 text-center text-[14px] text-sq-muted">
            {tr('No app is authorised to spend your tokens.', 'Aucune application n’a d’autorisation de dépense sur vos jetons.')}
            <div className="mt-2">
              <Link to="/dapps" className="underline underline-offset-4">
                {tr('See approved dApps', 'Voir les dApps approuvées')}
              </Link>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-sq-line">
            {data!.map((r) => (
              <li key={r.spender} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <KeySquare size={22} strokeWidth={1.75} className="hidden shrink-0 text-sq-ink-2 sm:block" />
                <div className="min-w-0 flex-1 text-[14px]">
                  <div className="font-semibold">
                    {r.name ?? tr('Unknown app', 'Application inconnue')}
                    {!r.whitelisted && <span className="ml-2 rounded-[4px] bg-sq-bad-50 px-1.5 py-px text-[11px] font-semibold text-sq-down">{tr('Not approved', 'Non approuvée')}</span>}
                  </div>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px] text-sq-ink-2">
                    <dt className="text-sq-muted">{tr('Network', 'Réseau')}</dt>
                    <dd>{r.network}</dd>
                    <dt className="text-sq-muted">{tr('Contract', 'Contrat')}</dt>
                    <dd>
                      <Addr a={r.spender} full />
                    </dd>
                    <dt className="text-sq-muted">{tr('Asset', 'Actif')}</dt>
                    <dd>{r.token}</dd>
                    <dt className="text-sq-muted">{tr('Limit', 'Plafond')}</dt>
                    <dd className={cx('font-semibold', r.unlimited && 'text-sq-down')}>{r.unlimited ? tr('Unlimited', 'Illimité') : `${r.allowance} ${r.token}`}</dd>
                    <dt className="text-sq-muted">{tr('Authorised on', 'Autorisé le')}</dt>
                    <dd>{r.authorizedAt ? dateTime(r.authorizedAt) : tr('Unknown', 'Inconnu')}</dd>
                  </dl>
                </div>
                <Button variant="danger" className="w-full sm:w-auto sm:px-4" onClick={() => revoke(r)}>
                  {tr('Revoke access', 'Retirer l’accès')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Button variant="ghost" onClick={reload}>
        <RefreshCw size={16} strokeWidth={1.75} /> {tr('Refresh from the blockchain', 'Actualiser depuis la blockchain')}
      </Button>
      <p className="text-[12px] text-sq-muted">{tr('Network fee for the revocation: estimated in the preview, paid by Swissquote. Status: pending while sending, confirmed once included in a block, or failed.', 'Frais réseau de la révocation : estimés dans l’aperçu, offerts par Swissquote. États : en attente pendant l’envoi, confirmée une fois incluse dans un bloc, ou échouée.')}</p>
    </div>
  );
}
