import { useState } from 'react';
import { tr } from '../lib/i18n';
import { Palette } from 'lucide-react';
import { ACCENTS, BACKGROUNDS, savePrefs, usePrefs, WALLET_ITEMS, type Preferences } from '../lib/prefs';
import { Button, Card, cx, Notice } from './ui';

export function Personalization({ clientId }: { clientId: string }) {
  const { prefs } = usePrefs();
  const [err, setErr] = useState('');
  const set = async (patch: Partial<Preferences> & { reset?: boolean }) => {
    setErr('');
    try {
      await savePrefs(clientId, patch);
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <Card className="space-y-4">
      <h2 className="flex items-center gap-2 text-[16px] font-semibold">
        <Palette size={20} strokeWidth={1.75} /> {tr('Personalisation', 'Personnalisation')}
      </h2>
      <fieldset>
        <legend className="mb-2 text-[14px] font-medium">{tr('Background', 'Fond d’écran')}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(BACKGROUNDS) as Preferences['background'][]).map((k) => (
            <button key={k} type="button" aria-pressed={prefs.background === k} onClick={() => set({ background: k })} className={cx('flex min-h-11 items-center gap-2 rounded-[10px] border px-3 text-left text-[13px]', prefs.background === k ? 'border-sq-ink/50 font-medium' : 'border-sq-line')}>
              <span className="size-5 shrink-0 rounded-full border border-sq-line" style={{ background: BACKGROUNDS[k].color }} />
              {BACKGROUNDS[k].label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-[14px] font-medium">{tr('Accent colour', 'Couleur d’accent')}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(ACCENTS) as Preferences['accent'][]).map((k) => (
            <button key={k} type="button" aria-pressed={prefs.accent === k} onClick={() => set({ accent: k })} className={cx('flex min-h-11 items-center gap-2 rounded-[10px] border px-3 text-left text-[13px]', prefs.accent === k ? 'border-sq-ink/50 font-medium' : 'border-sq-line')}>
              <span className="size-5 shrink-0 rounded-full" style={{ background: ACCENTS[k].main }} />
              {ACCENTS[k].label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[12px] text-sq-muted">{tr('All the colours offered keep enough contrast with the white button text.', 'Toutes les couleurs proposées gardent un contraste suffisant avec le texte blanc des boutons.')}</p>
      </fieldset>
      <label className="flex min-h-11 items-start gap-3">
        <input type="checkbox" className="mt-1 size-4 accent-[var(--color-sq-orange)]" checked={prefs.highlight} onChange={(e) => set({ highlight: e.target.checked })} />
        <span>
          <span className="block text-[14px] font-medium">{tr('Highlight important information', 'Mettre en évidence les informations importantes')}</span>
          <span className="block text-[12px] text-sq-muted">{tr('Alerts, pending operations, required actions and unlimited approvals are outlined.', 'Alertes, opérations en attente, actions requises et autorisations illimitées sont encadrées.')}</span>
        </span>
      </label>
      {/* Masking is no longer optional: amounts are hidden on every wallet entry (see lib/maskState.ts). */}
      <div className="rounded-[10px] bg-sq-bg px-3 py-2.5">
        <span className="block text-[14px] font-medium">{tr('Amounts hidden by default', 'Montants masqués par défaut')}</span>
        <span className="block text-[12px] text-sq-muted">
          {tr(
            'Balances, quantities, values and transaction amounts are hidden each time you enter My Wall. Show them with the eye button: verify with your passkey (Touch ID / Face ID / device PIN depending on your device). They are hidden again when you lock or leave the wallet.',
            'Soldes, quantités, valeurs et montants des transactions sont masqués à chaque entrée dans My Wall. Affichez-les avec le bouton œil : vérification par votre passkey (Touch ID / Face ID / code de l’appareil selon votre appareil). Ils sont à nouveau masqués quand vous verrouillez ou quittez le wallet.',
          )}
        </span>
      </div>
      <fieldset>
        <legend className="mb-1 text-[14px] font-medium">{tr('Wallets and accounts shown', 'Wallets et comptes affichés')}</legend>
        <p className="mb-2 text-[12px] text-sq-muted">{tr('Hiding an item only removes it from the display: neither keys nor assets are deleted.', 'Masquer un élément le retire seulement de l’affichage : ni les clés ni les actifs ne sont supprimés.')}</p>
        {WALLET_ITEMS.map((w) => {
          const shown = !prefs.hiddenWallets.includes(w.id);
          return (
            <label key={w.id} className="flex min-h-11 items-center gap-3 text-[14px]">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-sq-orange)]"
                checked={shown}
                onChange={() => set({ hiddenWallets: shown ? [...prefs.hiddenWallets, w.id] : prefs.hiddenWallets.filter((x) => x !== w.id) })}
              />
              {w.label}
            </label>
          );
        })}
      </fieldset>
      {err && <Notice tone="bad">{err}</Notice>}
      <Button variant="secondary" className="w-auto px-4" onClick={() => set({ reset: true })}>
        {tr('Restore default settings', 'Revenir aux réglages par défaut')}
      </Button>
    </Card>
  );
}
