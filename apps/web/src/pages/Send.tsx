import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { isAddress, parseEther, parseUnits } from 'ethers';
import {
  RELATIONSHIPS,
  TRAVEL_RULE,
  USDC_ADDRESS,
  USDC_DECIMALS,
  buildSafeTx,
  checkRecipient,
  foreignAddressFormat,
  isKnownToken,
  missingBeneficiaryFields,
  usdcTransferData,
  type BeneficiaryInput,
  type SafeTx,
  type TransferDeclaration,
} from '@sq/shared';
import { bank, cosigner } from '../lib/api';
import { useLocal, usePoll, useWalletData } from '../lib/hooks';
import { useWalletRates } from '../lib/market';
import { getLang, locale, tr } from '../lib/i18n';
import { Addr, Button, Card, cx, Field, fmt, inputCls, MockBadge, Notice, PageHeader, Why } from '../components/ui';
import { TxFlow } from '../components/TxFlow';
import { RecipientCheckView } from '../components/RecipientCheck';
import { Money } from '../lib/prefs';

const DEMO_BOB = '0xb0b0000000000000000000000000000000000b0b';
const DEMO_SANCTIONED = '0x098B716B8Aaf21512996dC57EB0615e2383E2f96';

// Common ISO 3166-1 alpha-2 codes for the beneficiary's country (names localised by the browser).
const COUNTRIES = ['CH', 'LI', 'DE', 'FR', 'IT', 'AT', 'GB', 'IE', 'ES', 'PT', 'NL', 'BE', 'LU', 'DK', 'SE', 'NO', 'FI', 'PL', 'CZ', 'HU', 'GR', 'RO', 'HR', 'SI', 'SK', 'US', 'CA', 'BR', 'MX', 'AU', 'NZ', 'JP', 'SG', 'HK', 'IN', 'AE', 'IL', 'TR', 'ZA', 'MA'];

/** #20 — another chain's address format pasted in the Ethereum field. */
const foreignMessage = (chain: string) =>
  tr(
    `My Wall sends only on Ethereum (Sepolia test network). “${chain}” addresses belong to another blockchain: funds sent there from here would be lost. Ask the recipient for an Ethereum address (0x… — 42 characters).`,
    `My Wall envoie uniquement sur Ethereum (réseau de test Sepolia). Les adresses « ${chain} » appartiennent à une autre blockchain : des fonds envoyés d’ici seraient perdus. Demandez au destinataire une adresse Ethereum (0x… — 42 caractères).`,
  );
/** #20 — the recipient is the token contract itself. */
const destroyMessage = () =>
  tr(
    'This would destroy the funds: this address is the token’s own contract, not a wallet. Nothing sent there can ever be recovered.',
    'Cela détruirait les fonds : cette adresse est le contrat du jeton lui-même, pas un wallet. Rien de ce qui y est envoyé ne peut être récupéré.',
  );

const relationshipLabel = (r: string) =>
  ({
    family: tr('Family member', 'Membre de la famille'),
    friend: tr('Friend', 'Ami ou amie'),
    business: tr('Business relation (supplier, client, employer…)', 'Relation d’affaires (fournisseur, client, employeur…)'),
    'self-other-institution': tr('Myself, at another institution', 'Moi-même, auprès d’un autre établissement'),
    other: tr('Other', 'Autre'),
  })[r] ?? r;

const fieldLabel = (f: string) =>
  ({
    name: tr('beneficiary’s full name (first and last name, or company name)', 'nom complet du bénéficiaire (prénom et nom, ou raison sociale)'),
    walletType: tr('type of wallet', 'type de wallet'),
    providerName: tr('name of the exchange or institution', 'nom de la plateforme ou de l’établissement'),
    street: tr('street address', 'adresse (rue)'),
    city: tr('city', 'ville'),
    country: tr('country', 'pays'),
    relationship: tr('relationship', 'lien avec le bénéficiaire'),
    purpose: tr('purpose of the transfer', 'motif du transfert'),
    accuracyConfirmed: tr('confirmation that the information is accurate', 'confirmation de l’exactitude des informations'),
  })[f] ?? f;

interface OwnWallet {
  address: string;
  label: string;
  detail: string;
}

export default function Send() {
  const { device } = useLocal();
  const [params] = useSearchParams();
  const { data, reload } = useWalletData();
  const nav = useNavigate();
  const clientId = device!.clientId;
  const [asset, setAsset] = useState<'USDC' | 'ETH'>(params.get('asset') === 'ETH' ? 'ETH' : 'USDC');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [amount, setAmount] = useState(params.get('amount') ?? '2');
  const [note, setNote] = useState(params.get('note') ?? '');
  const [saveName, setSaveName] = useState('');
  const [saveEmail, setSaveEmail] = useState('');
  const [when, setWhen] = useState<'now' | 'payment' | 'reminder'>('now');
  const [dueLocal, setDueLocal] = useState(() => {
    const d = new Date(new Date(Date.now() + 24 * 3600_000).toLocaleString('en-US', { timeZone: 'Europe/Zurich' }));
    d.setMinutes(0, 0, 0);
    return toLocalInput(d);
  });
  const [tx, setTx] = useState<SafeTx | null>(null);
  const [decl, setDecl] = useState<TransferDeclaration | undefined>(undefined);
  const [err, setErr] = useState('');
  // Travel Rule: whose wallet is it?
  const [kind, setKind] = useState<'own' | 'third-party' | null>(params.get('own') === '1' ? 'own' : params.get('third') === '1' ? 'third-party' : null); // third=1: "Send back to sender" (#20)
  const [ben, setBen] = useState<Partial<BeneficiaryInput>>({});
  const [moreDetails, setMoreDetails] = useState(false);
  const setB = (p: Partial<BeneficiaryInput>) => setBen((b) => ({ ...b, ...p }));

  const contacts: any[] = data?.client?.contacts ?? [];
  const balance = Number(asset === 'USDC' ? data?.onchain?.usdc ?? 0 : data?.onchain?.eth ?? 0);
  const safe = (data?.client?.safeAddress ?? device?.safeAddress ?? '').toLowerCase();

  // Verified wallets of this client (sq-bank registry): Swissquote account + external wallets proven with SIWE.
  const profile = usePoll(() => bank.get(`/clients/${clientId}`), 60000, [clientId]);
  const ownWallets: OwnWallet[] = useMemo(() => {
    const p = profile.data;
    if (!p) return [];
    const out: OwnWallet[] = [];
    if (p.treasury) out.push({ address: p.treasury, label: tr('My Swissquote account', 'Mon compte Swissquote'), detail: tr('Credited to your Swissquote account', 'Crédité sur votre compte Swissquote') });
    for (const w of p.verifiedWallets ?? []) {
      if (w.address.toLowerCase() === safe) continue;
      out.push({ address: w.address, label: w.label, detail: tr(`Verified ${new Date(w.verifiedAt).toLocaleDateString(locale())} · ${w.method}`, `Vérifié le ${new Date(w.verifiedAt).toLocaleDateString(locale())} · ${w.method}`) });
    }
    return out;
  }, [profile.data, safe]);

  // Pre-filled recipient (e.g. a scheduled payment) that is one of your verified wallets → "My own wallet".
  useEffect(() => {
    if (kind === null && isAddress(to) && ownWallets.some((w) => w.address.toLowerCase() === to.toLowerCase())) setKind('own');
  }, [ownWallets]); // eslint-disable-line react-hooks/exhaustive-deps

  const trCfg = usePoll(() => cosigner.get(`/clients/${clientId}/travel-rule/config`), 300000, [clientId]);
  const threshold: number = trCfg.data?.thresholdChf ?? TRAVEL_RULE.enhancedThresholdChf;
  const maxAgeSec: number = trCfg.data?.rateMaxAgeSec ?? TRAVEL_RULE.rateMaxAgeSec;
  const demoMode: boolean | undefined = trCfg.data?.demoMode;
  const rates = useWalletRates();
  const rate = rates.data?.rates?.[asset];
  const rateOk = !!rate && !rate.stale && Date.now() - new Date(rate.asOf).getTime() <= maxAgeSec * 1000;
  const estChf = rateOk ? Number(amount || 0) * rate!.chf : null;
  // Same rule as the server (which also adds linked transfers of the last 30 days): unknown value → enhanced.
  const enhanced = estChf === null || estChf >= threshold || moreDetails;

  const suggestions = useMemo(
    () => [
      ...contacts.map((c) => ({ name: c.name, address: c.address, note: c.known ? tr('contact', 'contact') : tr('new (cooling-off)', 'nouveau (délai de réflexion)') })),
      ...(contacts.some((c) => c.address.toLowerCase() === DEMO_BOB) ? [] : [{ name: tr('Bob (demo)', 'Bob (démo)'), address: DEMO_BOB, note: tr('not a contact yet', 'pas encore contact') }]),
      { name: tr('Sanctioned address (demo)', 'Adresse sanctionnée (démo)'), address: DEMO_SANCTIONED, note: tr('OFAC list', 'liste OFAC') },
    ],
    [contacts],
  );

  const review = async () => {
    setErr('');
    const foreign = foreignAddressFormat(to); // #20 address of another chain pasted
    if (foreign) return setErr(foreignMessage(foreign));
    if (!isAddress(to)) return setErr(tr('Enter a valid Ethereum address (0x…).', 'Saisissez une adresse Ethereum valide (0x…).'));
    if (isKnownToken(to)) return setErr(destroyMessage());
    const look = checkRecipient(to, contacts, getLang()); // #19 address poisoning: refused here and by the co-signer
    if (look.status === 'lookalike')
      return setErr(tr(`Refused: this address imitates the one saved for “${look.name}” (look-alike address — possible scam). Pick “${look.name}” from your contacts instead of copying an address.`, `Refusé : cette adresse imite celle enregistrée pour « ${look.name} » (adresse sosie — arnaque possible). Choisissez « ${look.name} » dans vos contacts au lieu de copier une adresse.`));
    if (!(Number(amount) >= 0)) return setErr(tr('Enter an amount.', 'Saisissez un montant.'));
    if (when === 'now') {
      if (!kind) return setErr(tr('Choose whether this is your own wallet or someone else’s wallet.', 'Indiquez s’il s’agit de votre propre wallet ou du wallet de quelqu’un d’autre.'));
      if (kind === 'own' && !ownWallets.some((w) => w.address.toLowerCase() === to.toLowerCase()))
        return setErr(tr('This address is not one of your verified wallets. Choose one below, verify it first in Settings, or choose “Someone else’s wallet”.', 'Cette adresse n’est pas un de vos wallets vérifiés. Choisissez-en un ci-dessous, vérifiez-le d’abord dans Réglages, ou choisissez « Le wallet de quelqu’un d’autre ».'));
      if (kind === 'third-party') {
        const missing = missingBeneficiaryFields(ben, enhanced);
        if (missing.length) return setErr(tr(`Beneficiary information missing: ${missing.map(fieldLabel).join(', ')}.`, `Informations sur le bénéficiaire manquantes : ${missing.map(fieldLabel).join(', ')}.`));
      }
    }
    try {
      if (saveName.trim()) {
        await cosigner.post(`/clients/${clientId}/contacts`, { name: saveName.trim(), address: to, email: saveEmail.trim() || undefined });
        setSaveName('');
      }
      if (when !== 'now') {
        // Planned: nothing is signed now. At the due date it becomes "à confirmer" with a fresh simulation.
        const contact = contacts.find((c) => c.address.toLowerCase() === to.toLowerCase());
        await cosigner.post(`/clients/${clientId}/scheduled`, { kind: when, recipient: to, recipientName: contact?.name ?? (saveName.trim() || undefined), asset, amount, dueAt: zurichLocalToIso(dueLocal), note: note.trim() || undefined });
        nav('/wallet/scheduled');
        return;
      }
      setDecl(kind === 'own' ? { kind: 'own' } : { kind: 'third-party', beneficiary: { ...(ben as BeneficiaryInput), country: ben.country?.toUpperCase() } });
      const nonce = (await cosigner.get(`/clients/${clientId}/onchain`)).nonce;
      setTx(
        asset === 'USDC'
          ? buildSafeTx({ to: USDC_ADDRESS, data: usdcTransferData(to, parseUnits(amount || '0', USDC_DECIMALS)), nonce })
          : buildSafeTx({ to, value: parseEther(amount || '0'), nonce }),
      );
    } catch (e: any) {
      setErr(e.message);
    }
  };

  if (tx)
    return (
      <div className="mx-auto max-w-[640px] space-y-3">
        <PageHeader title={tr('Review', 'Vérification')} />
        {decl?.kind === 'third-party' && demoMode && (
          <Notice tone="warn" title={tr('Demo — Travel Rule data collected but not transmitted; not compliant', 'Démo — données Travel Rule collectées mais non transmises ; non conforme')}>
            {tr('The beneficiary information stays with Swissquote (it is never written on the blockchain). No Travel Rule network is connected in this prototype.', 'Les informations sur le bénéficiaire restent chez Swissquote (jamais inscrites sur la blockchain). Aucun réseau Travel Rule n’est connecté dans ce prototype.')}
          </Notice>
        )}
        <TxFlow clientId={clientId} safeAddress={device!.safeAddress!} safeTx={tx} note={note.trim() || undefined} transfer={decl} onBack={() => setTx(null)} onDone={() => void reload()} />
      </div>
    );

  const regionName = (code: string) => {
    try {
      return new Intl.DisplayNames([getLang()], { type: 'region' }).of(code) ?? code;
    } catch {
      return code;
    }
  };

  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <PageHeader title={tr('Send', 'Envoyer')} back="/wallet" />
      <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-sq-chip/60 p-1">
        {(['USDC', 'ETH'] as const).map((a) => (
          <button key={a} onClick={() => setAsset(a)} aria-pressed={asset === a} className={cx('min-h-11 rounded-[8px] text-[14px]', asset === a ? 'bg-white font-semibold shadow-sm' : 'text-sq-ink-2')}>
            {a}
          </button>
        ))}
      </div>

      <Card className="space-y-3">
        <div className="text-[14px] font-medium" id="whose-wallet">{tr('Whose wallet are you sending to?', 'À quel wallet envoyez-vous ?')}</div>
        <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-sq-chip/60 p-1" role="group" aria-labelledby="whose-wallet">
          {(
            [
              ['own', tr('My own wallet', 'Mon propre wallet')],
              ['third-party', tr('Someone else’s wallet', 'Le wallet de quelqu’un d’autre')],
            ] as const
          ).map(([id, l]) => (
            <button
              key={id}
              type="button"
              aria-pressed={kind === id}
              onClick={() => {
                setKind(id);
                if (id === 'own' && !ownWallets.some((w) => w.address.toLowerCase() === to.toLowerCase())) setTo('');
              }}
              className={cx('min-h-11 rounded-[8px] px-2 text-[14px]', kind === id ? 'bg-white font-semibold shadow-sm' : 'text-sq-ink-2')}
            >
              {l}
            </button>
          ))}
        </div>

        {kind === 'own' && (
          <div className="space-y-2">
            {ownWallets.length ? (
              <div className="space-y-2" role="radiogroup" aria-label={tr('Your verified wallets', 'Vos wallets vérifiés')}>
                {ownWallets.map((w) => (
                  <label key={w.address} className={cx('flex min-h-11 cursor-pointer gap-3 rounded-[10px] border p-3', to.toLowerCase() === w.address.toLowerCase() ? 'border-sq-ink/40 bg-sq-bg' : 'border-sq-line')}>
                    <input type="radio" name="own-wallet" checked={to.toLowerCase() === w.address.toLowerCase()} onChange={() => setTo(w.address)} className="mt-1 accent-[#fa5b35]" />
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium">
                        {w.label} <span className="font-mono text-[12px] text-sq-muted"><Addr a={w.address} /></span>
                      </span>
                      <span className="block text-[12px] text-sq-muted">{w.detail}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : profile.error ? (
              <Notice tone="bad">{tr('Your verified wallets could not be loaded.', 'Impossible de charger vos wallets vérifiés.')} {profile.error}</Notice>
            ) : (
              <p className="text-[13px] text-sq-muted">{tr('Loading your verified wallets…', 'Chargement de vos wallets vérifiés…')}</p>
            )}
            <p className="text-[12px] text-sq-muted">
              {tr('Only wallets verified for you are listed. Another wallet of yours? ', 'Seuls les wallets vérifiés à votre nom sont listés. Un autre de vos wallets ? ')}
              <Link to="/settings#external-wallets" className="underline underline-offset-2">
                {tr('Prove you control it (Settings → External wallets)', 'Prouvez que vous le contrôlez (Réglages → Wallets externes)')}
              </Link>
            </p>
          </div>
        )}

        {kind === 'third-party' && (
          <>
            <Field label={tr('Recipient', 'Destinataire')} hint={tr('Ethereum address (Sepolia test network)', 'Adresse Ethereum (réseau de test Sepolia)')}>
              <input className={cx(inputCls, 'font-mono text-[14px]')} value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
            </Field>
            {isAddress(to) && <RecipientCheckView input={to} contacts={contacts} compact />}
            {foreignAddressFormat(to) && (
              <Notice tone="bad" title={tr(`This is a ${foreignAddressFormat(to)} address`, `Ceci est une adresse ${foreignAddressFormat(to)}`)}>
                {foreignMessage(foreignAddressFormat(to)!)}
              </Notice>
            )}
            {isAddress(to) && isKnownToken(to) && <Notice tone="bad" title={tr('This would destroy the funds', 'Cela détruirait les fonds')}>{destroyMessage()}</Notice>}
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s.address}
                  type="button"
                  onClick={() => {
                    setTo(s.address);
                    if (s.address === DEMO_BOB) setSaveName('Bob');
                  }}
                  className={cx('min-h-9 rounded-full border px-3 py-1.5 text-left text-[13px]', to.toLowerCase() === s.address.toLowerCase() ? 'border-sq-chip bg-sq-chip font-medium' : 'border-sq-line bg-white')}
                >
                  {s.name} <span className="text-sq-muted">· {s.note}</span>
                </button>
              ))}
            </div>
            {isAddress(to) && ownWallets.some((w) => w.address.toLowerCase() === to.toLowerCase()) && (
              <Notice>{tr('This address is one of your verified wallets: you can choose “My own wallet” instead.', 'Cette adresse est un de vos wallets vérifiés : vous pouvez choisir « Mon propre wallet ».')}</Notice>
            )}
          </>
        )}

        <Field
          label={tr(`Amount (${asset})`, `Montant (${asset})`)}
          hint={
            <>
              {tr('Available: ', 'Disponible : ')}
              <Money value={balance} decimals={asset === 'ETH' ? 5 : 2} unit={asset} unitClassName="ml-1" />
            </>
          }
        >
          <input className={cx(inputCls, 'num text-[18px]')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} />
        </Field>
        <Field label={tr('Note (optional)', 'Motif (facultatif)')} hint={tr('Shown on the receipt.', 'Figure sur le justificatif.')}>
          <input className={inputCls} value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} placeholder={tr('e.g. Dinner refund', 'ex. Remboursement repas')} />
        </Field>
        {kind === 'third-party' && isAddress(to) && !contacts.some((c) => c.address.toLowerCase() === to.toLowerCase()) && (
          <>
            <Field label={tr('Save as a contact (optional)', 'Enregistrer comme contact (facultatif)')} hint={tr('A new recipient becomes “known” after a short cooling-off period.', 'Un nouveau destinataire devient « connu » après un court délai de réflexion.')}>
              <input className={inputCls} value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder={tr('e.g. Bob', 'ex. Bob')} />
            </Field>
            {saveName.trim() && (
              <Field label={tr('Contact email (optional)', 'Email du contact (facultatif)')} hint={tr('To write to them from the inbox.', 'Pour lui écrire depuis la boîte de réception.')}>
                <input className={inputCls} type="email" value={saveEmail} onChange={(e) => setSaveEmail(e.target.value)} placeholder="bob@example.ch" />
              </Field>
            )}
          </>
        )}
      </Card>

      {kind === 'third-party' && when === 'now' && (
        <Card className="space-y-3" as="section">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[16px] font-semibold">{tr('Beneficiary', 'Bénéficiaire')}</h2>
            {demoMode && <MockBadge label={tr('Demo — not transmitted', 'Démo — non transmis')} />}
          </div>
          <p className="text-[13px] text-sq-ink-2">
            {tr(
              'Swiss anti-money-laundering rules (the “Travel Rule”) require information on the person you send to. It stays with Swissquote and is never written on the blockchain.',
              'Les règles suisses de lutte contre le blanchiment (la « Travel Rule ») exigent des informations sur la personne à qui vous envoyez. Elles restent chez Swissquote et ne sont jamais inscrites sur la blockchain.',
            )}
          </p>
          <Field label={tr('Full name of the beneficiary', 'Nom complet du bénéficiaire')} hint={tr('First and last name, or the full company name. Always required.', 'Prénom et nom, ou la raison sociale complète. Toujours obligatoire.')}>
            <input className={inputCls} value={ben.name ?? ''} maxLength={140} autoComplete="off" onChange={(e) => setB({ name: e.target.value })} placeholder={tr('e.g. Robert Example', 'ex. Robert Exemple')} />
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[14px] font-medium">{tr('Is this an exchange or bank account, or a personal wallet?', 'Est-ce un compte auprès d’une plateforme ou d’une banque, ou un wallet personnel ?')}</legend>
            {(
              [
                ['hosted', tr('Exchange or bank account (hosted)', 'Compte auprès d’une plateforme ou d’une banque (hébergé)'), tr('A company (e.g. a crypto exchange) holds the keys for the beneficiary.', 'Une entreprise (p. ex. une plateforme crypto) détient les clés pour le bénéficiaire.')],
                ['unhosted', tr('Personal wallet (unhosted)', 'Wallet personnel (non hébergé)'), tr('The beneficiary holds the keys (e.g. MetaMask, a hardware wallet).', 'Le bénéficiaire détient lui-même les clés (p. ex. MetaMask, un wallet matériel).')],
              ] as const
            ).map(([v, l, d]) => (
              <label key={v} className={cx('flex min-h-11 cursor-pointer gap-3 rounded-[10px] border p-3', ben.walletType === v ? 'border-sq-ink/40 bg-sq-bg' : 'border-sq-line')}>
                <input type="radio" name="wallet-type" checked={ben.walletType === v} onChange={() => setB({ walletType: v })} className="mt-1 accent-[#fa5b35]" />
                <span>
                  <span className="block text-[14px] font-medium">{l}</span>
                  <span className="block text-[12px] text-sq-muted">{d}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {ben.walletType === 'hosted' && (
            <Field label={tr('Name of the exchange or institution', 'Nom de la plateforme ou de l’établissement')}>
              <input className={inputCls} value={ben.providerName ?? ''} maxLength={140} onChange={(e) => setB({ providerName: e.target.value })} />
            </Field>
          )}

          <div className="rounded-[10px] bg-sq-bg p-3 text-[13px]">
            {estChf !== null ? (
              <>
                {tr('Estimated counter-value: ', 'Contre-valeur estimée : ')}
                <span className="num font-semibold">≈ {fmt(estChf)} CHF</span>{' '}
                <span className="text-sq-muted">
                  ({rate!.provider}, {new Date(rate!.asOf).toLocaleTimeString(locale(), { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' })})
                </span>
              </>
            ) : (
              <span className="text-sq-warn">{tr(`No recent CHF rate: the transfer is treated as ${fmt(threshold, 0)} CHF or more.`, `Pas de cours CHF récent : le transfert est traité comme valant ${fmt(threshold, 0)} CHF ou plus.`)}</span>
            )}
            <span className="mt-1 block text-[12px] text-sq-muted">
              {tr(
                `From ${fmt(threshold, 0)} CHF (included), alone or with your transfers to the same beneficiary in the last ${TRAVEL_RULE.linkedWindowDays} days, more information is required. Swissquote checks this again before co-signing.`,
                `Dès ${fmt(threshold, 0)} CHF (inclus), seul ou avec vos transferts au même bénéficiaire sur ${TRAVEL_RULE.linkedWindowDays} jours, des informations supplémentaires sont exigées. Swissquote le revérifie avant de co-signer.`,
              )}
            </span>
          </div>

          {!enhanced ? (
            <button type="button" className="text-[13px] text-sq-ink-2 underline underline-offset-4" onClick={() => setMoreDetails(true)}>
              {tr('Add the full beneficiary details now (needed for linked transfers)', 'Ajouter dès maintenant les informations complètes (nécessaires pour des transferts liés)')}
            </button>
          ) : (
            <div className="space-y-3">
              <Field label={tr('Street and number', 'Rue et numéro')}>
                <input className={inputCls} value={ben.street ?? ''} maxLength={140} onChange={(e) => setB({ street: e.target.value })} />
              </Field>
              <div className="grid grid-cols-[1fr_2fr] gap-2">
                <Field label={tr('Postcode', 'NPA')}>
                  <input className={inputCls} value={ben.postcode ?? ''} maxLength={16} onChange={(e) => setB({ postcode: e.target.value })} />
                </Field>
                <Field label={tr('City', 'Ville')}>
                  <input className={inputCls} value={ben.city ?? ''} maxLength={140} onChange={(e) => setB({ city: e.target.value })} />
                </Field>
              </div>
              <Field label={tr('Country', 'Pays')}>
                <select className={inputCls} value={ben.country ?? ''} onChange={(e) => setB({ country: e.target.value })}>
                  <option value="">{tr('Choose…', 'Choisir…')}</option>
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {regionName(c)} ({c})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr('Your relationship with the beneficiary', 'Votre lien avec le bénéficiaire')}>
                <select className={inputCls} value={ben.relationship ?? ''} onChange={(e) => setB({ relationship: e.target.value })}>
                  <option value="">{tr('Choose…', 'Choisir…')}</option>
                  {RELATIONSHIPS.map((r) => (
                    <option key={r} value={r}>
                      {relationshipLabel(r)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr('Purpose of the transfer', 'Motif du transfert')}>
                <input className={inputCls} value={ben.purpose ?? ''} maxLength={200} onChange={(e) => setB({ purpose: e.target.value })} placeholder={tr('e.g. Share of a holiday rental', 'ex. Part d’une location de vacances')} />
              </Field>
              <label className="flex cursor-pointer gap-3 text-[14px]">
                <input type="checkbox" checked={ben.accuracyConfirmed === true} onChange={(e) => setB({ accuracyConfirmed: e.target.checked })} className="mt-1 accent-[#fa5b35]" />
                <span>{tr('I confirm that this information is accurate and complete.', 'Je confirme que ces informations sont exactes et complètes.')}</span>
              </label>
            </div>
          )}
          <Notice tone="info">
            {tr(
              'Giving a name is not enough on its own to make a transfer compliant. The information is not verified, and Swissquote is not yet connected to a Travel Rule network to transmit it.',
              'Indiquer un nom ne suffit pas, à lui seul, à rendre un transfert conforme. Les informations ne sont pas vérifiées, et Swissquote n’est pas encore connecté à un réseau Travel Rule pour les transmettre.',
            )}{' '}
            {demoMode === false
              ? tr('Transfers to someone else’s wallet are therefore blocked.', 'Les transferts vers le wallet de quelqu’un d’autre sont donc bloqués.')
              : demoMode
                ? tr('Demo mode: the transfer can go ahead, labelled “not compliant”.', 'Mode démo : le transfert peut avoir lieu, marqué « non conforme ».')
                : null}
          </Notice>
        </Card>
      )}

      <Card className="space-y-3">
        <div className="text-[14px] font-medium">{tr('When?', 'Quand ?')}</div>
        <div className="grid grid-cols-3 gap-1 rounded-[10px] bg-sq-chip/60 p-1">
          {(
            [
              ['now', tr('Now', 'Maintenant')],
              ['payment', tr('Schedule', 'Planifier')],
              ['reminder', tr('Reminder', 'Rappel')],
            ] as const
          ).map(([id, l]) => (
            <button key={id} type="button" aria-pressed={when === id} onClick={() => setWhen(id)} className={cx('min-h-11 rounded-[8px] text-[14px]', when === id ? 'bg-white font-semibold shadow-sm' : 'text-sq-ink-2')}>
              {l}
            </button>
          ))}
        </div>
        {when !== 'now' && (
          <>
            <Field label={tr('Date and time (Europe/Zurich)', 'Date et heure (Europe/Zurich)')}>
              <input type="datetime-local" className={inputCls} value={dueLocal} onChange={(e) => setDueLocal(e.target.value)} />
            </Field>
            <p className="text-[12px] text-sq-muted">
              {when === 'payment'
                ? tr('On the due date the payment becomes “to confirm”: fees, balances and simulation are recomputed, and you confirm it yourself (with the beneficiary information). Nothing is signed or sent automatically.', 'À l’échéance, la dépense devient « à confirmer » : frais, soldes et simulation sont recalculés et vous la confirmez vous-même (avec les informations sur le bénéficiaire). Aucune signature ni aucun envoi automatique.')
                : tr('On the due date you get a reminder. Nothing is prepared or sent.', 'À l’échéance, vous recevez un rappel. Rien n’est préparé ni envoyé.')}{' '}
              <Link to="/wallet/scheduled" className="underline underline-offset-2">
                {tr('See scheduled items', 'Voir les éléments planifiés')}
              </Link>
            </p>
          </>
        )}
      </Card>
      {err && <Notice tone="bad">{err}</Notice>}
      <Why>{tr('Before you confirm, we show you in plain words what will happen, run the Swissquote checks and simulate the operation on Ethereum.', 'Avant de confirmer, nous vous montrons en mots simples ce qui va se passer, nous lançons les contrôles Swissquote et nous simulons l’opération sur Ethereum.')}</Why>
      <Button onClick={review} disabled={!to || !amount || (when === 'now' && !kind)}>
        {when === 'now' ? tr('Review', 'Vérifier') : when === 'payment' ? tr('Schedule the payment', 'Planifier la dépense') : tr('Create the reminder', 'Créer le rappel')}
      </Button>
    </div>
  );
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" read as Europe/Zurich wall-clock time → ISO UTC (independent of the browser's time zone). */
export function zurichLocalToIso(local: string) {
  const [d, t] = local.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, day, hh, mm);
  const at = new Date(guess);
  const zurich = new Date(at.toLocaleString('en-US', { timeZone: 'Europe/Zurich' }));
  const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess - (zurich.getTime() - utc.getTime())).toISOString();
}
