// In-process Hardhat network for the contract tests (no compilation here: the guard is compiled by
// scripts/build-contracts.ts with solc-js, official contracts are installed from their Sepolia bytecode).
// chainId = Sepolia so the shared EIP-712 helpers (safeDomain) are used unchanged.
module.exports = {
  solidity: '0.8.30',
  networks: {
    hardhat: { chainId: 11155111, hardfork: 'cancun', initialBaseFeePerGas: 0, loggingEnabled: false },
  },
};
