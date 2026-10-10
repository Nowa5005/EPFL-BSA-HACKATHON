// Shared reader view for News and Inspiration (/sq/read/:kind/:id).
// Desktop: occupies the main content area. Mobile: full-screen layer above the app navigation.
// Focus goes to the heading on open; Back / Escape returns to the list, which restores its scroll position,
// filter and focuses the originating card.

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ExternalLink, Info } from 'lucide-react';
import { cx, ICON, Notice, Spinner, useIsDesktop } from '../../components/ui';
import { getLang, locale, tr } from '../../lib/i18n';
import { marketGet, type Article } from '../../lib/market';
import { decodeEntities, findCachedArticle, Illustration, langLabel, newsCache, NewsImage, zurichDateTime, type NewsPayload } from './common';
import { EDITORIAL_LABEL, INSPIRATION, type Block } from './inspiration';

export default function Reader() {
  const { kind, id = '' } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const isDesktop = useIsDesktop();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listUrl = kind === 'inspiration' ? '/sq/markets?tab=inspiration' : '/sq/markets?tab=news';

  const back = () => {
    // Came from the list in this session → real history back (the list restores its own state); else go to the list.
    if ((loc.state as any)?.from && loc.key !== 'default') nav(-1);
    else nav(listUrl);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // (block body: recent browsers return a Promise from scrollTo, which must not become the effect's cleanup)
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [id]);

  const content = kind === 'inspiration' ? <EditorialView id={id} headingRef={headingRef} /> : kind === 'news' ? <NewsView id={id} headingRef={headingRef} /> : null;

  const view = (
    <div
      role="region"
      aria-label={tr('Reader', 'Lecture')}
      className={cx(isDesktop ? 'mx-auto max-w-[760px]' : 'fixed inset-0 z-[45] overflow-y-auto bg-sq-bg pb-[max(24px,env(safe-area-inset-bottom))]')}
      data-reader-scroll
    >
      <div className={cx('sticky top-0 z-10 flex items-center bg-sq-bg/95 backdrop-blur', isDesktop ? 'top-16 -mx-2 py-2' : 'px-2 pt-[max(8px,env(safe-area-inset-top))] pb-1')}>
        <button type="button" onClick={back} className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 pr-3 text-[15px] font-medium text-sq-ink hover:bg-sq-chip/60">
          <ChevronLeft {...ICON} aria-hidden /> {kind === 'inspiration' ? tr('Back to Inspiration', 'Retour à Inspiration') : tr('Back to News', 'Retour aux actualités')}
        </button>
      </div>
      <div className={cx(!isDesktop && 'mx-auto max-w-[720px] px-4')}>{content ?? <NotFound />}</div>
    </div>
  );
  // Mobile: full-screen layer portalled to <body> (the animated page container would otherwise contain a fixed child).
  return isDesktop ? view : createPortal(view, document.body);
}

function NotFound() {
  return (
    <Notice tone="warn" className="mt-4">
      {tr('This item is no longer available.', 'Ce contenu n’est plus disponible.')}
    </Notice>
  );
}

function useFocusOnReady(ref: React.RefObject<HTMLHeadingElement | null>, ready: boolean) {
  useEffect(() => {
    if (ready) ref.current?.focus({ preventScroll: true });
  }, [ready, ref]);
}

// ───────────── News ─────────────
function NewsView({ id, headingRef }: { id: string; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const [a, setA] = useState<Article | null | undefined>(() => findCachedArticle(id) ?? undefined);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (a) return;
    // Direct link / reload: the article must come from the same feed data (never reconstructed).
    marketGet<NewsPayload>('/news')
      .then((p) => {
        newsCache.set('all', p);
        setA(p.articles.find((x) => x.id === id) ?? null);
      })
      .catch((e) => setErr(e.message));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusOnReady(headingRef, !!a);

  if (err) return <Notice tone="bad" className="mt-4">{tr('News feeds unavailable right now.', 'Flux d’actualités indisponibles pour le moment.')}</Notice>;
  if (a === undefined)
    return (
      <div className="flex justify-center py-16 text-sq-muted">
        <Spinner />
      </div>
    );
  if (a === null) return <NotFound />;

  const title = decodeEntities(a.title);
  const summary = decodeEntities(a.summary);
  return (
    <article className="mt-2 overflow-hidden rounded-[12px] bg-sq-surface">
      <NewsImage a={a} className="aspect-[16/9] w-full" big />
      <div className="p-5 sm:p-7">
        <p className="flex flex-wrap gap-x-2 text-[13px] text-sq-muted">
          <span className="font-semibold text-sq-ink-2">{a.source}</span>
          <time dateTime={a.publishedAt}>{zurichDateTime(a.publishedAt)} (Europe/Zurich)</time>
          {a.lang !== getLang() && <span>· {langLabel(a.lang)}</span>}
        </p>
        <h1 ref={headingRef} tabIndex={-1} lang={a.lang} className="mt-2 text-[24px] font-semibold leading-tight tracking-tight outline-none sm:text-[28px]">
          {title}
        </h1>
        {summary && (
          <>
            <h2 className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-sq-muted">{tr('Summary from the publisher’s feed', 'Résumé issu du flux de l’éditeur')}</h2>
            <p lang={a.lang} className="mt-1.5 text-[17px] leading-relaxed text-sq-ink">
              {summary}
            </p>
          </>
        )}
        <h2 className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-sq-muted">{tr('What this is about', 'De quoi s’agit-il')}</h2>
        <p className="mt-1.5 text-[15px] leading-relaxed text-sq-ink-2">
          {tr(
            `A ${topicNames(a.topics, 'en')} story published by ${a.source} on ${zurichDateTime(a.publishedAt)}. Only the headline and the publisher’s own summary are shown here; the full article is on ${a.source}’s website.`,
            `Article ${topicNames(a.topics, 'fr')} publié par ${a.source} le ${zurichDateTime(a.publishedAt)}. Seuls le titre et le résumé fourni par l’éditeur sont affichés ici ; l’article complet se trouve sur le site de ${a.source}.`,
          )}
        </p>
        <a href={a.url} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] bg-sq-orange px-5 text-[15px] font-semibold text-white hover:bg-sq-orange-600">
          {tr('Read the original article', 'Lire l’article original')} <ExternalLink size={16} strokeWidth={2} aria-hidden />
          <span className="sr-only">{tr('(opens in a new tab)', '(s’ouvre dans un nouvel onglet)')}</span>
        </a>
        <p className="mt-4 flex gap-2 text-[12px] leading-relaxed text-sq-muted">
          <Info size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
          {tr(
            'The full text is not reproduced: the publisher’s RSS feed only licenses the headline, summary and link. Some publishers may require a subscription.',
            'Le texte intégral n’est pas reproduit : le flux RSS de l’éditeur n’autorise que le titre, le résumé et le lien. Certains éditeurs peuvent exiger un abonnement.',
          )}
        </p>
      </div>
    </article>
  );
}

function topicNames(topics: string[], lang: 'en' | 'fr') {
  const n: Record<string, [string, string]> = { markets: ['markets', 'marchés'], companies: ['companies', 'entreprises'], economy: ['economy', 'économie'], crypto: ['crypto', 'crypto'] };
  const names = topics.map((t) => n[t]?.[lang === 'fr' ? 1 : 0] ?? t);
  return lang === 'fr' ? `(${names.join(', ')})` : `${names.join(' / ')}`;
}

// ───────────── Inspiration (editorial) ─────────────
function EditorialView({ id, headingRef }: { id: string; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const a = INSPIRATION.find((x) => x.id === id);
  useFocusOnReady(headingRef, !!a);
  if (!a) return <NotFound />;
  const fr = getLang() === 'fr';
  const L = (x: { en: string; fr: string }) => (fr ? x.fr : x.en);
  return (
    <article className="mt-2 overflow-hidden rounded-[12px] bg-sq-surface">
      <Illustration theme={a.theme} big className="aspect-[16/7] w-full" label={tr('Illustration', 'Illustration')} />
      <div className="p-5 sm:p-7">
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-sq-muted">
          <span className="rounded-full bg-sq-chip px-2.5 py-0.5 text-[12px] font-medium text-sq-ink-2">{L(a.themeLabel)}</span>
          <span>{tr('My Wall editorial team', 'Rédaction My Wall')}</span>
          <span>· {tr('Updated', 'Mis à jour')} <time dateTime={a.updated}>{new Date(a.updated + 'T12:00:00Z').toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })}</time></span>
          <span>· {tr(`${a.readMin} min read`, `${a.readMin} min de lecture`)}</span>
        </p>
        <h1 ref={headingRef} tabIndex={-1} className="mt-2 text-[24px] font-semibold leading-tight tracking-tight outline-none sm:text-[28px]">
          {L(a.title)}
        </h1>
        <p className="mt-2 rounded-[8px] border border-dashed border-sq-muted/50 px-3 py-2 text-[12px] text-sq-muted">{L(EDITORIAL_LABEL)}</p>
        <p className="mt-4 text-[17px] leading-relaxed text-sq-ink">{L(a.intro)}</p>
        <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-sq-ink-2">{(fr ? a.body.fr : a.body.en).map((b, i) => <BlockView key={i} b={b} />)}</div>
        <h2 className="mt-8 text-[17px] font-semibold text-sq-ink" id="sources">
          {tr('Sources', 'Sources')}
        </h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-[14px] text-sq-ink-2">
          {a.sources.map((s, i) => (
            <li key={s.url} id={`src-${i + 1}`}>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-sq-ink underline decoration-sq-line underline-offset-2 hover:decoration-sq-ink">
                {s.title}
              </a>{' '}
              — {s.publisher}
              {s.lang && s.lang !== getLang() && <span className="text-sq-muted"> ({langLabel(s.lang).replace(/^Article /, '')})</span>}
            </li>
          ))}
        </ol>
      </div>
    </article>
  );
}

/** Renders "text [1] more [2]" with citation links to the sources list. Plain text only (no HTML injection). */
function Cited({ text }: { text: string }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\[(\d+)\]$/.exec(p);
        return m ? (
          <sup key={i}>
            <a
              href={`#src-${m[1]}`}
              onClick={(e) => {
                // Scroll to the source without adding a history entry (Back must return to the list).
                e.preventDefault();
                const el = document.getElementById(`src-${m[1]}`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el?.querySelector('a')?.focus({ preventScroll: true });
              }}
              className="px-0.5 font-medium text-sq-orange"
              aria-label={tr(`source ${m[1]}`, `source ${m[1]}`)}
            >
              [{m[1]}]
            </a>
          </sup>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        );
      })}
    </>
  );
}

function BlockView({ b }: { b: Block }): ReactNode {
  if ('h' in b) return <h2 className="pt-3 text-[17px] font-semibold text-sq-ink">{b.h}</h2>;
  if ('ul' in b)
    return (
      <ul className="list-disc space-y-1.5 pl-5">
        {b.ul.map((x, i) => (
          <li key={i}>
            <Cited text={x} />
          </li>
        ))}
      </ul>
    );
  return (
    <p>
      <Cited text={b.p} />
    </p>
  );
}
