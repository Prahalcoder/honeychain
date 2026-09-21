// Shows which network the settings point at, the paying account and its balance.
//   npm run account
import { formatEther } from 'ethers'
import { RPC_URL, connect } from './common.mjs'

const { provider, deployer, chainId } = await connect()
const address = await deployer.getAddress()
const balance = await provider.getBalance(address)
const host = (() => { try { return new URL(RPC_URL).host } catch { return RPC_URL } })()

console.log(`Network   chain ${chainId} via ${host}`)
console.log(`Account   ${address}`)
console.log(`Balance   ${formatEther(balance)} ${chainId === 80002 ? 'POL (Amoy test)' : 'ETH/POL'}`)
if (balance === 0n && chainId !== 31337) console.log('The balance is zero: get free test funds for this address from a faucet (for Polygon Amoy: https://faucet.polygon.technology).')
process.exit(0)
