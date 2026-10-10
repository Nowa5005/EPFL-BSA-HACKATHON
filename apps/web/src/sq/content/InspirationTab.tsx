// Inspiration: educational editorial articles written for this prototype (English + French), every factual claim
// sourced. Clearly labelled as editorial content, not investment advice. No performance figures, no promised returns.

import { useState } from 'react';
import { Pill } from '../../components/ui';
import { getLang, tr } from '../../lib/i18n';
import { Illustration, listFilters, useOpenReader, useRestoreList } from './common';
import { EDITORIAL_LABEL, INSPIRATION } from './inspiration';

export default function InspirationTab() {
  const [theme, setThemeState] = useState(listFilters.inspiration);
  const open = useOpenReader('inspiration');
  const fr = getLang() === 'fr';
  const L = (x: { en: string; fr: string }) => (fr ? x.fr : x.en);
  const themes = [...new Map(INSPIRATION.map((a) => [a.theme, a.themeLabel])).entries()];
  const items = theme === 'all' ? INSPIRATION : INSPIRATION.filter((a) => a.theme === theme);
  const setTheme = (t: string) => {
    listFilters.inspiration = t;
    setThemeState(t);
  };
  useRestoreList('inspiration', true);

  return (
    <section aria-label="Inspiration" className="mt-4">
      <p className="rounded-[10px] border border-dashed border-sq-muted/50 bg-sq-surface px-3.5 py-2.5 text-[13px] text-sq-ink-2">{L(EDITORIAL_LABEL)}</p>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label={tr('Filter by theme', 'Filtrer par thème')}>
        <Pill active={theme === 'all'} onClick={() => setTheme('all')}>
          {tr('All', 'Tout')}
        </Pill>
        {themes.map(([id, label]) => (
          <Pill key={id} active={theme === id} onClick={() => setTheme(id)}>
            {L(label)}
          </Pill>
        ))}
      </div>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2">
        {items.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              data-card-id={a.id}
              onClick={() => open(a.id)}
              className="group flex h-full w-full flex-col overflow-hidden rounded-[12px] bg-sq-surface text-left focus-visible:outline-2 focus-visible:outline-sq-orange"
            >
              <Illustration theme={a.theme} className="h-36 w-full" label={tr('Illustration', 'Illustration')} />
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-center gap-2 text-[12px] text-sq-muted">
                  <span className="rounded-full bg-sq-chip px-2.5 py-0.5 font-medium text-sq-ink-2">{L(a.themeLabel)}</span>
                  <span>{tr(`${a.readMin} min read`, `${a.readMin} min de lecture`)}</span>
                </div>
                <h3 className="mt-2 text-[16px] font-semibold leading-snug text-sq-ink group-hover:underline">{L(a.title)}</h3>
                <p className="mt-1.5 line-clamp-3 text-[14px] leading-relaxed text-sq-ink-2">{L(a.intro)}</p>
                <span className="mt-auto pt-3 text-[12px] text-sq-muted">{tr(`Editorial · ${a.sources.length} sources`, `Éditorial · ${a.sources.length} sources`)}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
