# HoneyChain smart contract

`contracts/HoneyChain.sol` (Solidity) is the on-chain half of Honey Chain. The API talks to it; nothing here holds business data beyond hashes, weights and CIDs.

| Function | Who signs | What it does |
|---|---|---|
| `registerBatch` | harvester (EIP-712) | creates the batch with its weight and the ledger event hash |
| `certifyBatch` | certified officer (EIP-712) | second signature: result, lab-report hash, metadata CID |
| `registerJars` | harvester (EIP-712) | Merkle root of all jar IDs; enforces `jars + loose <= weight` |
| `recordLooseSale` / `reverseLooseSale` | harvester (EIP-712) | loose honey counted against the same weight |
| `anchorLedger` | anchorer | writes the audit-ledger head; heights only move forward |
| `verifyJar` | anyone (view) | checks a jar with a Merkle proof |

A relayer sends the transactions and pays the gas. It cannot forge the harvester or officer signatures.

```bash
npm install
npm run compile      # solc -> artifacts/HoneyChain.json (+ the input a block explorer needs)
npm test             # 7 tests on an in-process chain
npm run node         # local chain on 127.0.0.1:8545 and deploys (npm start at the repo root does this)
npm run account      # network, paying account and its balance
npm run deploy       # deploy to CHAIN_RPC_URL
npm run verify       # publish the source on Polygonscan (needs ETHERSCAN_API_KEY)
```

These scripts read `CHAIN_RPC_URL`, `CHAIN_PRIVATE_KEY` and `ETHERSCAN_API_KEY` from `APICtech/backend/.env`, so the settings live in one place.

## Polygon Amoy (public testnet)

1. Make a new account and fund it with free test POL: https://faucet.polygon.technology (Polygon Amoy).
2. In `APICtech/backend/.env`:

   ```
   CHAIN_RPC_URL=https://polygon-amoy-bor-rpc.publicnode.com
   CHAIN_PRIVATE_KEY=0x<the funded test account>
   ```
3. `npm run account` (check the balance), then `npm run deploy`. The address is written to `deployments/80002.json`; the API reads it from there.
4. Browse it at https://amoy.polygonscan.com/address/<contract address>.

Never put a key that holds real funds in these files.

## Local chain

Without `CHAIN_RPC_URL`, `npm start` runs an in-memory Hardhat network. Its state is lost when it stops. The contract address is deterministic, and the API replays every confirmed record from its database into the new chain, so the chain and the database agree again after a restart. The development key is public: it is only ever used on chain 31337.
