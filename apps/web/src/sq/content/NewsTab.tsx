// News: real articles from publishers' public RSS feeds via the market-data service (/news?topic=).
// Title, short feed summary, source, date (Europe/Zurich), feed image credited to the publisher (or a neutral
// illustration), link to the original. No full text (the feeds do not licence it), paywalls never bypassed.

import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Card, Notice, Pill, Skeleton, Spinner } from '../../components/ui';
import { getLang, tr } from '../../lib/i18n';
import { ageLabel, marketGet, type Article } from '../../lib/market';
import { decodeEntities, langLabel, listFilters, newsCache, NewsImage, useOpenReader, useRestoreList, zurichDateTime, type NewsPayload, type NewsTopic } from './common';

const TOPICS: { id: NewsTopic; label: () => string }[] = [
  { id: 'all', label: () => tr('All', 'Tout') },
  { id: 'markets', label: () => tr('Markets', 'Marchés') },
  { id: 'companies', label: () => tr('Companies', 'Entreprises') },
  { id: 'economy', label: () => tr('Economy', 'Économie') },
  { id: 'crypto', label: () => tr('Crypto', 'Crypto') },
];

export default function NewsTab() {
  const [topic, setTopicState] = useState<NewsTopic>(listFilters.news);
  const [data, setData] = useState<NewsPayload | null>(newsCache.get(topic) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!data);
  const open = useOpenReader('news');

  const setTopic = (t: NewsTopic) => {
    listFilters.news = t;
    setTopicState(t);
  };

  const load = async (t: NewsTopic) => {
    setLoading(true);
    try {
      const p = await marketGet<NewsPayload>(t === 'all' ? '/news' : `/news?topic=${t}`);
      newsCache.set(t, p);
      if (listFilters.news === t) {
        setData(p);
        setError(null);
      }
    } catch (e: any) {
      if (listFilters.news === t) setError(e.message);
    } finally {
      if (listFilters.news === t) setLoading(false);
    }
  };

  useEffect(() => {
    const cached = newsCache.get(topic) ?? null;
    setData(cached);
    setError(null);
    // Fresh cache (< 5 min) is reused so going back from the reader is instant and keeps the scroll position.
    if (!cached || Date.now() - new Date(cached.fetchedAt).getTime() > 5 * 60_000) void load(topic);
    else setLoading(false);
  }, [topic]); // eslint-disable-line react-hooks/exhaustive-deps

  useRestoreList('news', !!data);

  return (
    <section aria-label={tr('News', 'Actualités')} className="mt-4">
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={tr('Filter by topic', 'Filtrer par thème')}>
        {TOPICS.map((t) => (
          <Pill key={t.id} active={topic === t.id} onClick={() => setTopic(t.id)}>
            {t.label()}
          </Pill>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-sq-muted">
        <span>{tr('Sources: CNBC, MarketWatch, CoinDesk, Cointelegraph, Decrypt (publishers’ public RSS feeds).', 'Sources : CNBC, MarketWatch, CoinDesk, Cointelegraph, Decrypt (flux RSS publics des éditeurs).')}</span>
        {data && (
          <span className="num">
            {tr('Fetched', 'Récupéré')} {ageLabel(data.fetchedAt, Date.now(), getLang())}
          </span>
        )}
        <button type="button" onClick={() => void load(topic)} disabled={loading} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-1 font-medium text-sq-ink hover:underline disabled:opacity-50">
          {loading ? <Spinner className="size-3.5" /> : <RefreshCw size={13} strokeWidth={2} />} {tr('Refresh', 'Actualiser')}
        </button>
      </div>

      {data?.stale && (
        <Notice tone="warn" className="mt-3">
          {tr(`The feeds could not be reached. Showing the articles fetched ${ageLabel(data.fetchedAt)}.`, `Les flux sont injoignables. Articles récupérés ${ageLabel(data.fetchedAt, Date.now(), 'fr')}.`)}
        </Notice>
      )}
      {data && data.failedSources.length > 0 && !data.stale && (
        <p className="mt-2 text-[12px] text-sq-muted">{tr(`Temporarily unavailable: ${data.failedSources.join(', ')}.`, `Momentanément indisponible : ${data.failedSources.join(', ')}.`)}</p>
      )}

      {error && !data ? (
        <Notice tone="bad" className="mt-4" title={tr('News unavailable', 'Actualités indisponibles')}>
          {tr('The news feeds could not be loaded. No article is shown rather than invented ones.', 'Les flux d’actualités n’ont pas pu être chargés. Aucun article n’est affiché plutôt que d’en inventer.')}{' '}
          <button type="button" className="font-semibold underline" onClick={() => void load(topic)}>
            {tr('Try again', 'Réessayer')}
          </button>
        </Notice>
      ) : !data ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2" aria-busy="true" aria-label={tr('Loading news', 'Chargement des actualités')}>
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="space-y-3 p-0">
              <Skeleton className="h-36 w-full rounded-b-none" />
              <div className="space-y-2 p-4">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
              </div>
            </Card>
          ))}
        </div>
      ) : data.articles.length === 0 ? (
        <Card className="mt-4 text-[14px] text-sq-muted">{tr('No article for this topic right now.', 'Aucun article pour ce thème pour le moment.')}</Card>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {data.articles.map((a) => (
            <li key={a.id}>
              <NewsCard a={a} onOpen={() => open(a.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewsCard({ a, onOpen }: { a: Article; onOpen: () => void }) {
  const title = decodeEntities(a.title);
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[12px] bg-sq-surface">
      <button type="button" data-card-id={a.id} onClick={onOpen} className="group flex flex-1 flex-col text-left focus-visible:outline-2 focus-visible:outline-sq-orange" aria-label={tr(`Open: ${title}`, `Ouvrir : ${title}`)}>
        <NewsImage a={a} className="h-40 w-full" />
        <div className="flex flex-1 flex-col p-4">
          <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-sq-muted">
            <span className="font-semibold text-sq-ink-2">{a.source}</span>
            <time dateTime={a.publishedAt}>{zurichDateTime(a.publishedAt)}</time>
            {a.lang !== getLang() && <span>· {langLabel(a.lang)}</span>}
          </div>
          <h3 className="mt-1.5 text-[16px] font-semibold leading-snug text-sq-ink group-hover:underline" lang={a.lang}>
            {title}
          </h3>
          {a.summary && (
            <p className="mt-1.5 line-clamp-3 text-[14px] leading-relaxed text-sq-ink-2" lang={a.lang}>
              {decodeEntities(a.summary)}
            </p>
          )}
        </div>
      </button>
      <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 border-t border-sq-line px-4 text-[14px] font-medium text-sq-ink hover:underline">
        {tr('Read the original article', 'Lire l’article original')} <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
        <span className="sr-only">{tr(`(${a.source}, opens in a new tab)`, `(${a.source}, s’ouvre dans un nouvel onglet)`)}</span>
      </a>
    </article>
  );
}
