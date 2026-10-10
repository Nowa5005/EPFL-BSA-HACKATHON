// FICTITIOUS market data for the reconstructed Swissquote screens (demo only, not real quotes).

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  change: number; // %
  currency: string;
  index?: boolean;
}

export const SMI_COMPONENTS: Quote[] = [
  { symbol: 'SMI', name: 'SMI® PR', price: 11681.44, change: 0.34, currency: 'CHF', index: true },
  { symbol: 'SCMN', name: 'Swisscom N', price: 503.0, change: -0.2, currency: 'CHF' },
  { symbol: 'GIVN', name: 'Givaudan N', price: 4000.0, change: 0.7, currency: 'CHF' },
  { symbol: 'ZURN', name: 'Zurich Insurance N', price: 550.0, change: 0.18, currency: 'CHF' },
  { symbol: 'NOVN', name: 'Novartis N', price: 88.56, change: -0.23, currency: 'CHF' },
  { symbol: 'ROG', name: 'Roche GS', price: 256.0, change: 0.87, currency: 'CHF' },
  { symbol: 'HOLN', name: 'Holcim N', price: 88.5, change: -0.29, currency: 'CHF' },
  { symbol: 'ABBN', name: 'ABB Ltd N', price: 51.56, change: 0.55, currency: 'CHF' },
  { symbol: 'NESN', name: 'Nestlé N', price: 84.2, change: -0.41, currency: 'CHF' },
  { symbol: 'UBSG', name: 'UBS Group N', price: 27.8, change: 0.62, currency: 'CHF' },
  { symbol: 'CFR', name: 'Richemont N', price: 132.15, change: 1.02, currency: 'CHF' },
  { symbol: 'LONN', name: 'Lonza Group N', price: 512.4, change: -0.36, currency: 'CHF' },
  { symbol: 'SREN', name: 'Swiss Re N', price: 128.6, change: 0.21, currency: 'CHF' },
  { symbol: 'SIKA', name: 'Sika N', price: 228.3, change: -0.12, currency: 'CHF' },
  { symbol: 'ALC', name: 'Alcon N', price: 74.1, change: 0.44, currency: 'CHF' },
  { symbol: 'SLHN', name: 'Swiss Life Holding N', price: 690.0, change: 0.15, currency: 'CHF' },
];

export const SHARES: Quote[] = [
  { symbol: 'AAPL', name: 'Apple Inc', price: 221.4, change: 0.48, currency: 'USD' },
  { symbol: 'MSFT', name: 'Microsoft Corp', price: 431.2, change: -0.31, currency: 'USD' },
  { symbol: 'NVDA', name: 'Nvidia Corp', price: 132.9, change: 1.64, currency: 'USD' },
  { symbol: 'NESN', name: 'Nestlé N', price: 84.2, change: -0.41, currency: 'CHF' },
  { symbol: 'SQN', name: 'Swissquote Group N', price: 312.0, change: 0.92, currency: 'CHF' },
  { symbol: 'LOGN', name: 'Logitech N', price: 76.8, change: 1.21, currency: 'CHF' },
];

export const CRYPTO: Quote[] = [
  { symbol: 'BTC', name: 'Bitcoin', price: 54210.0, change: 1.12, currency: 'CHF' },
  { symbol: 'ETH', name: 'Ethereum', price: 2900.0, change: -0.84, currency: 'CHF' },
  { symbol: 'USDC', name: 'USD Coin', price: 0.88, change: 0.01, currency: 'CHF' },
  { symbol: 'SOL', name: 'Solana', price: 128.4, change: 2.35, currency: 'CHF' },
  { symbol: 'DOT', name: 'Polkadot', price: 3.92, change: -1.08, currency: 'CHF' },
];

export const INDICES: Quote[] = [
  { symbol: 'SMI', name: 'SMI® PR', price: 11681.44, change: 0.34, currency: 'CHF', index: true },
  { symbol: 'SPI', name: 'SPI®', price: 15820.3, change: 0.29, currency: 'CHF', index: true },
  { symbol: 'DAX', name: 'DAX®', price: 19105.7, change: -0.12, currency: 'EUR', index: true },
  { symbol: 'SPX', name: 'S&P 500', price: 5712.4, change: 0.41, currency: 'USD', index: true },
];

/** Small random walk so the list looks alive (fictitious). */
export function jitter(q: Quote[]): Quote[] {
  return q.map((x) => {
    const d = (Math.random() - 0.5) * 0.08;
    return { ...x, change: Math.round((x.change + d) * 100) / 100, price: Math.round(x.price * (1 + d / 100) * 100) / 100 };
  });
}

// Reconstructed home (fictitious portfolio of the demo client)
export const PORTFOLIO = {
  account: 'Trading 2162953',
  assets: 12000.0,
  crypto: 10150.01,
  buyingPower: 1000.0,
  dailyChange: 1.65,
  dailyChangePct: 1.18,
  absolutePerf: 128.65,
  series: {
    '1W': [54920, 55010, 55090, 55070, 55040, 55020, 55051],
    '1M': [53800, 54200, 54050, 54600, 54900, 54700, 55051],
    '6M': [49800, 51200, 52500, 51900, 53600, 54300, 55051],
    '1Y': [46100, 47900, 50100, 49200, 52800, 53900, 55051],
    All: [30000, 36500, 41200, 45800, 49900, 52600, 55051],
  } as Record<string, number[]>,
};
