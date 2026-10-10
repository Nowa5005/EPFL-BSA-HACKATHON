import { Check, Circle } from 'lucide-react';
import type { PasswordRule } from '../lib/passwordPolicy';
import { cx } from './ui';

export function PasswordChecklist({ rules }: { rules: PasswordRule[] }) {
  return (
    <ul className="mt-2 grid gap-1 sm:grid-cols-2" aria-label="Règles du mot de passe">
      {rules.map((r) => (
        <li key={r.id} className={cx('flex items-center gap-2 text-[13px]', r.ok ? 'text-sq-up' : 'text-sq-muted')}>
          {r.ok ? <Check size={16} strokeWidth={2.25} aria-hidden /> : <Circle size={14} strokeWidth={1.75} aria-hidden />}
          <span>
            {r.label}
            <span className="sr-only">{r.ok ? ' : respecté' : ' : non respecté'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
