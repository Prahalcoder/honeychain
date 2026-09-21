// Used only to run a local development chain (`npm run node`). The contract itself is compiled
// with solc (scripts/compile.mjs), so Hardhat is pointed at an empty sources folder and never
// needs to download a compiler.
module.exports = {
  solidity: '0.8.28',
  paths: { sources: './hardhat-empty' },
  networks: {
    hardhat: { chainId: 31337, mining: { auto: true, interval: 0 } },
  },
}
