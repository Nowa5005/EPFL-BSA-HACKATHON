// News from publishers' own public RSS feeds (an authorised syndication channel). We show title, a short
// summary from the feed, source, date, the feed's image (credited to the publisher) and a link to the original.
// Full article text is NOT reproduced (no licence for it) and paywalls are never bypassed.

import { XMLParser } from 'fast-xml-parser';
import { ProviderError } from './providers';

export type NewsTopic = 'markets' | 'companies' | 'economy' | 'crypto';

interface Feed {
  source: string;
  url: string;
  topics: NewsTopic[];
  lang: 'en';
}
export const FEEDS: Feed[] = [
  { source: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', topics: ['markets', 'economy'], lang: 'en' },
  { source: 'CNBC', url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html', topics: ['companies'], lang: 'en' },
  { source: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', topics: ['markets'], lang: 'en' },
  { source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', topics: ['crypto'], lang: 'en' },
  { source: 'Cointelegraph', url: 'https://cointelegraph.com/rss', topics: ['crypto'], lang: 'en' },
  { source: 'Decrypt', url: 'https://decrypt.co/feed', topics: ['crypto'], lang: 'en' },
];

export interface Article {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  topics: NewsTopic[];
  lang: string;
  image: { url: string; credit: string } | null;
  fullTextAvailable: false; // feeds only licence headline + summary display
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text' });

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#822[01];/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
const text = (v: any): string => (v == null ? '' : typeof v === 'string' || typeof v === 'number' ? String(v) : v['#text'] != null ? String(v['#text']) : '');
const httpsUrl = (u: unknown) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);

function imageOf(item: any): string | null {
  const media = [item['media:content'], item['media:thumbnail'], item.enclosure].flat().filter(Boolean);
  for (const m of media) {
    const u = httpsUrl(m?.['@url']);
    if (u && (!m['@type'] || String(m['@type']).startsWith('image') || m['@medium'] === 'image' || /\.(jpe?g|png|webp)/i.test(u))) return u;
  }
  const html = text(item['content:encoded']) || text(item.description);
  const m = html.match(/<img[^>]+src="(https:[^"]+)"/i);
  return m ? m[1] : null;
}

export function parseFeed(xml: string, feed: Feed): Article[] {
  const doc = parser.parse(xml);
  const items = [doc?.rss?.channel?.item ?? []].flat();
  return items.flatMap((it: any) => {
    const url = httpsUrl(text(it.link)) ?? httpsUrl(text(it.guid));
    const title = decode(text(it.title));
    if (!url || !title) return [];
    const date = new Date(text(it.pubDate) || text(it['dc:date']));
    let summary = decode(text(it.description));
    if (summary.length > 320) summary = summary.slice(0, 317).replace(/\s+\S*$/, '') + '…';
    const img = imageOf(it);
    return [
      {
        id: Buffer.from(url).toString('base64url').slice(-40),
        title,
        summary,
        url,
        source: feed.source,
        publishedAt: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
        topics: feed.topics,
        lang: feed.lang,
        image: img ? { url: img, credit: feed.source } : null,
        fullTextAvailable: false as const,
      },
    ];
  });
}

let cache: { at: number; articles: Article[]; failed: string[] } | null = null;

export async function getNews(topic?: NewsTopic): Promise<{ articles: Article[]; fetchedAt: string; stale: boolean; failedSources: string[] }> {
  if (!cache || Date.now() - cache.at > 10 * 60_000) {
    const results = await Promise.all(
      FEEDS.map(async (f) => {
        try {
          const res = await fetch(f.url, { headers: { 'user-agent': 'Mozilla/5.0 (MyWall prototype; RSS reader)' }, signal: AbortSignal.timeout(10_000), redirect: 'follow' });
          if (!res.ok) throw new Error(String(res.status));
          return { f, articles: parseFeed(await res.text(), f) };
        } catch {
          return { f, articles: null };
        }
      }),
    );
    const ok = results.filter((r) => r.articles);
    if (!ok.length) {
      if (cache) return { ...pickTopic(cache.articles, topic), fetchedAt: new Date(cache.at).toISOString(), stale: true, failedSources: FEEDS.map((f) => f.source) };
      throw new ProviderError('News feeds unavailable');
    }
    const seen = new Set<string>();
    const articles = ok
      .flatMap((r) => r.articles!)
      .filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true)))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    cache = { at: Date.now(), articles, failed: [...new Set(results.filter((r) => !r.articles).map((r) => r.f.source))] };
  }
  return { ...pickTopic(cache.articles, topic), fetchedAt: new Date(cache.at).toISOString(), stale: false, failedSources: cache.failed };
}

const pickTopic = (a: Article[], topic?: NewsTopic) => ({ articles: (topic ? a.filter((x) => x.topics.includes(topic)) : a).slice(0, 60) });
