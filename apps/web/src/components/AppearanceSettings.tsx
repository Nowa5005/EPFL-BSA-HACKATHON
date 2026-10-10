// Settings → Appearance: System (default) / Light / Dark (N5). Device preference, see lib/theme.ts.
import { Monitor, Moon, Sun, SunMoon } from 'lucide-react';
import { setThemePref, useTheme, type ThemePref } from '../lib/theme';
import { tr } from '../lib/i18n';
import { Card, cx } from './ui';

export function AppearanceSettings() {
  const { pref, resolved } = useTheme();
  const options: [ThemePref, string, typeof Sun][] = [
    ['system', tr('System', 'Système'), Monitor],
    ['light', tr('Light', 'Clair'), Sun],
    ['dark', tr('Dark', 'Sombre'), Moon],
  ];
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 text-[16px] font-semibold">
        <SunMoon size={20} strokeWidth={1.75} /> {tr('Appearance', 'Apparence')}
      </h2>
      <div role="radiogroup" aria-label={tr('Appearance', 'Apparence')} className="grid grid-cols-3 gap-2">
        {options.map(([v, label, Icon]) => (
          <label key={v} className={cx('flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border p-3 text-[14px] font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sq-orange', pref === v ? 'border-sq-orange bg-sq-orange-50' : 'border-sq-line')}>
            <input type="radio" name="theme" value={v} checked={pref === v} onChange={() => setThemePref(v)} className="sr-only" />
            <Icon size={18} strokeWidth={1.75} className={pref === v ? 'text-sq-orange-600' : 'text-sq-muted'} aria-hidden />
            {label}
          </label>
        ))}
      </div>
      <p className="text-[12px] text-sq-muted">
        {pref === 'system'
          ? tr(`Follows your device setting (currently ${resolved === 'dark' ? 'dark' : 'light'}) and changes with it. Saved on this device.`, `Suit le réglage de votre appareil (actuellement ${resolved === 'dark' ? 'sombre' : 'clair'}) et change avec lui. Enregistré sur cet appareil.`)
          : tr('Saved on this device. Documents (PDF) always stay light.', 'Enregistré sur cet appareil. Les documents (PDF) restent toujours clairs.')}
      </p>
    </Card>
  );
}
