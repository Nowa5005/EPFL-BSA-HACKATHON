// Demo parameters (see brief §9.3). Production values are noted alongside.

export const CHAIN_ID = 11155111; // Ethereum Sepolia
export const CHAIN_NAME = 'Ethereum Sepolia';
export const RPC_URLS = [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://sepolia.drpc.org',
];
export const EXPLORER = 'https://sepolia.etherscan.io';

// Circle USDC on Sepolia (developers.circle.com/stablecoins/usdc-contract-addresses)
export const USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
export const USDC_DECIMALS = 6;

// Safe v1.4.1 canonical deployments (from @safe-global/safe-deployments, verified on Sepolia)
export const SAFE_L2_SINGLETON = '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762';
export const SAFE_PROXY_FACTORY = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67';
export const SAFE_FALLBACK_HANDLER = '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99';
export const SAFE_VERSION = '1.4.1';
export const SAFE_THRESHOLD = 2;
export const SENTINEL_OWNERS = '0x0000000000000000000000000000000000000001';

// Service ports
export const PORTS = { cosigner: 4001, partner: 4002, bank: 4003, web: 5173 } as const;
export const SERVICE_URLS = {
  cosigner: `http://localhost:${PORTS.cosigner}`,
  partner: `http://localhost:${PORTS.partner}`,
  bank: `http://localhost:${PORTS.bank}`,
};

// Policy (demo values; prod in comments)
export const POLICY = {
  stepUpThresholdUsdc: 50, // prod: ~1'000 CHF
  dailyLimitUsdc: 1000, // prod: per client tier
  coolingOffNewRecipientSec: 30, // prod: 24 h
  recoveryDelaySec: 120, // prod: 48 h
  sponsoredTxPerDay: 20,
  maxSponsoredGas: 600_000,
  maxDevicesPerClient: 2, // 1 mobile + 1 desktop
  otpTtlSec: 300,
  // Confirmation previews (simulation shown before signing)
  previewTtlSec: 60, // a preview and its passkey challenge are valid this long, single use
  feeChange: { maxPct: 25, minAbs: 0.5 }, // re-confirm if network fee estimate moves ≥ 25 % AND ≥ 0.50 CHF
  quoteChange: { maxPct: 0.5, minAbs: 0 }, // re-confirm if a swap quote moves ≥ 0.5 %
  defaultSlippageBps: 50,
  backupCodeMaxAttempts: 5,
  backupCodeLockMinutes: 15,
};
/** Mock referent address for the messaging demo — not a validated Swissquote integration. */
export const SWISSQUOTE_REFERENT_EMAIL = 'moncontact@swissquote.ch';

export const MOCK_USDC_CHF = 0.88; // indicative mock rate
export const MOCK_ETH_CHF = 2900; // indicative mock rate
