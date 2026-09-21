// Runs the local development chain and keeps the contract deployed on it.
//
//   npm run node
//
// The chain is Hardhat's in-memory EVM (chain id 31337, http://127.0.0.1:8545), which costs nothing.
// It forgets everything when stopped, so the contract is redeployed at start-up (always to the same
// address). The Honey Chain backend then replays every record from its database into the fresh chain.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JsonRpcProvider } from 'ethers'

import { RPC_URL, ensureDeployed, root, artifactPath } from './common.mjs'
import fs from 'node:fs'

if (!fs.existsSync(artifactPath)) {
  const compile = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'compile.mjs')], { stdio: 'inherit' })
  await new Promise((resolve, reject) => compile.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('compile failed')))))
}

const hardhat = path.join(root, 'node_modules', 'hardhat', 'internal', 'cli', 'bootstrap.js')
const node = spawn(process.execPath, [hardhat, 'node', '--hostname', '127.0.0.1', '--port', '8545'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] })
node.stdout.on('data', (chunk) => {
  const text = chunk.toString()
  // The dev chain prints every RPC call and ten funded accounts with their private keys: keep the log short.
  if (!/Started HTTP/.test(text)) return
  process.stdout.write(text)
})
node.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { node.kill(); process.exit(0) })

// Wait for the RPC, then deploy.
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const provider = new JsonRpcProvider(RPC_URL)
    await provider.getBlockNumber()
    provider.destroy()
    break
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

const result = await ensureDeployed()
console.log(`HoneyChain contract ${result.deployed ? 'deployed' : 'ready'} at ${result.address} on chain ${result.chainId}. RPC ${RPC_URL}`)
