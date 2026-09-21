import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ContractFactory, JsonRpcProvider, NonceManager, Wallet } from 'ethers'

const here = path.dirname(fileURLToPath(import.meta.url))
export const root = path.resolve(here, '..')

// The first well-known Hardhat development account. Fine for a local chain; NEVER use it with real funds.
export const DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// One place for settings: the API's .env (CHAIN_RPC_URL, CHAIN_PRIVATE_KEY ...) is read here too.
try {
  for (const line of fs.readFileSync(path.resolve(root, '../APICtech/backend/.env'), 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && !line.trim().startsWith('#') && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no .env */ }

export const RPC_URL = process.env.CHAIN_RPC_URL || 'http://127.0.0.1:8545'
export const artifactPath = path.join(root, 'artifacts', 'HoneyChain.json')
export const readArtifact = () => JSON.parse(fs.readFileSync(artifactPath, 'utf8'))

export async function connect() {
  const provider = new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: false, polling: true, pollingInterval: 500 })
  const network = await provider.getNetwork()
  const chainId = Number(network.chainId)
  const key = process.env.CHAIN_DEPLOYER_KEY || process.env.CHAIN_PRIVATE_KEY || (chainId === 31337 ? DEV_KEY : null)
  if (!key) { provider.destroy(); throw new Error(`CHAIN_PRIVATE_KEY is required on chain ${chainId}: it is the account that pays gas. Use a key that holds only test funds.`) }
  const deployer = new NonceManager(new Wallet(key, provider))
  return { provider, deployer, chainId }
}

export const deploymentFile = (chainId) => path.join(root, 'deployments', `${chainId}.json`)

// Deploys the contract unless the recorded address already holds code. Returns { address, deployed }.
export async function ensureDeployed() {
  const { provider, deployer, chainId } = await connect()
  const file = deploymentFile(chainId)
  const known = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null

  if (known && (await provider.getCode(known.address)) !== '0x') return { ...known, deployed: false, chainId }

  const artifact = readArtifact()
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer)
  const anchorer = process.env.CHAIN_ANCHORER_ADDRESS || (await deployer.getAddress())
  const contract = await factory.deploy(anchorer)
  await contract.waitForDeployment()

  const record = {
    address: await contract.getAddress(),
    chainId,
    owner: await deployer.getAddress(),
    anchorer,
    deployTx: contract.deploymentTransaction()?.hash,
    deployedAt: new Date().toISOString(),
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(record, null, 2))
  provider.destroy()
  return { ...record, deployed: true }
}
