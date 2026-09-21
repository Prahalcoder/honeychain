// Deploys HoneyChain to the chain in CHAIN_RPC_URL (default: the local dev chain).
// For a public testnet such as Polygon Amoy set:
//   CHAIN_RPC_URL=https://rpc-amoy.polygon.technology  CHAIN_PRIVATE_KEY=0x<funded test key>
import { ensureDeployed } from './common.mjs'

const result = await ensureDeployed()
console.log(result.deployed ? 'Deployed' : 'Already deployed', 'HoneyChain at', result.address, `(chain ${result.chainId})`)
process.exit(0)
