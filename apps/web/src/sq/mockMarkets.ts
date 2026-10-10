// FICTITIOUS demo data of the reconstructed Swissquote trading account (demo only, always labelled as such in the UI).
// Market prices are NOT here: Trade, instrument pages and the home "Markets" section use real data (lib/market.ts).

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
