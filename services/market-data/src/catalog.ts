// Instruments shown by default in Trade / Watchlist discovery. Identifiers are the provider's exact ones:
//   yf:<Yahoo Finance symbol>  — equities, ETFs, indices (listing venue encoded in the suffix, e.g. .SW = SIX Swiss Exchange)
//   cg:<CoinGecko coin id>     — crypto-assets, priced in CHF
// Names and listing venues are static metadata; prices, changes and history always come from the provider.

export type Kind = 'equity' | 'etf' | 'index' | 'crypto';

export interface Instrument {
  id: string;
  symbol: string; // display ticker
  name: string;
  kind: Kind;
  exchange: string; // listing venue (or "Crypto, 24/7")
  currency: string; // quote currency
}

const yf = (symbol: string, display: string, name: string, kind: Kind, exchange: string, currency: string): Instrument => ({ id: `yf:${symbol}`, symbol: display, name, kind, exchange, currency });
const cg = (coin: string, display: string, name: string): Instrument => ({ id: `cg:${coin}`, symbol: display, name, kind: 'crypto', exchange: 'Crypto (24/7, aggregated)', currency: 'CHF' });

const SIX = 'SIX Swiss Exchange';
export const SMI_COMPONENTS: Instrument[] = [
  yf('ABBN.SW', 'ABBN', 'ABB Ltd', 'equity', SIX, 'CHF'),
  yf('ALC.SW', 'ALC', 'Alcon AG', 'equity', SIX, 'CHF'),
  yf('CFR.SW', 'CFR', 'Compagnie Financière Richemont', 'equity', SIX, 'CHF'),
  yf('GIVN.SW', 'GIVN', 'Givaudan SA', 'equity', SIX, 'CHF'),
  yf('HOLN.SW', 'HOLN', 'Holcim AG', 'equity', SIX, 'CHF'),
  yf('LOGN.SW', 'LOGN', 'Logitech International', 'equity', SIX, 'CHF'),
  yf('LONN.SW', 'LONN', 'Lonza Group AG', 'equity', SIX, 'CHF'),
  yf('NESN.SW', 'NESN', 'Nestlé S.A.', 'equity', SIX, 'CHF'),
  yf('NOVN.SW', 'NOVN', 'Novartis AG', 'equity', SIX, 'CHF'),
  yf('PGHN.SW', 'PGHN', 'Partners Group Holding', 'equity', SIX, 'CHF'),
  yf('ROP.SW', 'ROP', 'Roche Holding AG (participation cert.)', 'equity', SIX, 'CHF'), // Yahoo lists the former ROG.SW line as ROP.SW (ROG.SW returns 'No data found')
  yf('SCMN.SW', 'SCMN', 'Swisscom AG', 'equity', SIX, 'CHF'),
  yf('SIKA.SW', 'SIKA', 'Sika AG', 'equity', SIX, 'CHF'),
  yf('SLHN.SW', 'SLHN', 'Swiss Life Holding AG', 'equity', SIX, 'CHF'),
  yf('SREN.SW', 'SREN', 'Swiss Re AG', 'equity', SIX, 'CHF'),
  yf('UBSG.SW', 'UBSG', 'UBS Group AG', 'equity', SIX, 'CHF'),
  yf('ZURN.SW', 'ZURN', 'Zurich Insurance Group', 'equity', SIX, 'CHF'),
];

export const SHARES: Instrument[] = [
  yf('AAPL', 'AAPL', 'Apple Inc.', 'equity', 'Nasdaq', 'USD'),
  yf('MSFT', 'MSFT', 'Microsoft Corporation', 'equity', 'Nasdaq', 'USD'),
  yf('NVDA', 'NVDA', 'NVIDIA Corporation', 'equity', 'Nasdaq', 'USD'),
  yf('NESN.SW', 'NESN', 'Nestlé S.A.', 'equity', SIX, 'CHF'),
  yf('SQN.SW', 'SQN', 'Swissquote Group Holding', 'equity', SIX, 'CHF'),
  yf('LOGN.SW', 'LOGN', 'Logitech International', 'equity', SIX, 'CHF'),
];

export const ETFS: Instrument[] = [
  yf('CSSMI.SW', 'CSSMI', 'iShares SMI (CH)', 'etf', SIX, 'CHF'),
  yf('CHSPI.SW', 'CHSPI', 'iShares Core SPI (CH)', 'etf', SIX, 'CHF'),
  yf('VT', 'VT', 'Vanguard Total World Stock ETF', 'etf', 'NYSE Arca', 'USD'),
  yf('SPY', 'SPY', 'SPDR S&P 500 ETF Trust', 'etf', 'NYSE Arca', 'USD'),
];

export const INDICES: Instrument[] = [
  yf('^SSMI', 'SMI', 'SMI® (price index)', 'index', SIX, 'CHF'),
  yf('^GDAXI', 'DAX', 'DAX® (performance index)', 'index', 'Xetra', 'EUR'),
  yf('^GSPC', 'S&P 500', 'S&P 500', 'index', 'S&P Dow Jones Indices (US)', 'USD'),
  yf('^STOXX50E', 'Euro Stoxx 50', 'EURO STOXX 50®', 'index', 'STOXX (Eurozone)', 'EUR'),
];

export const CRYPTO: Instrument[] = [
  cg('bitcoin', 'BTC', 'Bitcoin'),
  cg('ethereum', 'ETH', 'Ethereum'),
  cg('usd-coin', 'USDC', 'USD Coin'),
  cg('solana', 'SOL', 'Solana'),
  cg('polkadot', 'DOT', 'Polkadot'),
];

export const LISTS = {
  shares: SHARES,
  etfs: ETFS,
  crypto: CRYPTO,
  indices: INDICES,
  components: SMI_COMPONENTS,
} as const;
export type ListId = keyof typeof LISTS;

const BY_ID = new Map<string, Instrument>();
for (const l of Object.values(LISTS)) for (const i of l) BY_ID.set(i.id, i);
export const known = (id: string) => BY_ID.get(id);
export const remember = (i: Instrument) => BY_ID.set(i.id, BY_ID.get(i.id) ?? i);

/** Wallet assets → market instruments (the wallet runs on Sepolia: test tokens, valued at the mainnet asset's price for illustration). */
export const WALLET_ASSET_INSTRUMENT: Record<string, string> = { ETH: 'cg:ethereum', USDC: 'cg:usd-coin' };
