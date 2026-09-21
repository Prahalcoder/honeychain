// Publishes the contract's source code on the block explorer (Polygonscan), so the explorer can show the
// contract's functions and decode its events. Needs a free API key from https://etherscan.io/apis
// (one key works for Polygonscan through the Etherscan V2 API).
//   set ETHERSCAN_API_KEY=...   (or put it in APICtech/backend/.env)
//   npm run compile && npm run verify
import fs from 'node:fs'
import path from 'node:path'
import { AbiCoder } from 'ethers'
import { connect, deploymentFile, root } from './common.mjs'

const key = process.env.ETHERSCAN_API_KEY
if (!key) { console.error('Set ETHERSCAN_API_KEY (free, from https://etherscan.io/apis).'); process.exit(1) }

const { provider, chainId } = await connect()
provider.destroy()
const file = deploymentFile(chainId)
if (!fs.existsSync(file)) { console.error(`No deployment recorded for chain ${chainId}. Run npm run deploy first.`); process.exit(1) }
const deployment = JSON.parse(fs.readFileSync(file, 'utf8'))

const input = fs.readFileSync(path.join(root, 'artifacts', 'HoneyChain.standard-input.json'), 'utf8')
const build = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'build-info.json'), 'utf8'))
const constructorArguments = AbiCoder.defaultAbiCoder().encode(['address'], [deployment.anchorer]).slice(2)

const api = `https://api.etherscan.io/v2/api?chainid=${chainId}`
const submit = await fetch(api, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    apikey: key, module: 'contract', action: 'verifysourcecode', contractaddress: deployment.address,
    sourceCode: input, codeformat: 'solidity-standard-json-input', contractname: 'HoneyChain.sol:HoneyChain',
    compilerversion: build.compiler, constructorArguements: constructorArguments,
  }),
}).then((response) => response.json())

if (submit.status !== '1') { console.error('Verification was not accepted:', submit.result || submit.message); process.exit(1) }
console.log('Submitted, waiting for the explorer...')

for (let attempt = 0; attempt < 20; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 5000))
  const state = await fetch(`${api}&apikey=${key}&module=contract&action=checkverifystatus&guid=${submit.result}`).then((response) => response.json())
  console.log(' ', state.result)
  if (/pass|already verified/i.test(state.result)) { console.log('Verified. Open the contract address on the explorer and use the Contract tab.'); process.exit(0) }
  if (/fail/i.test(state.result)) process.exit(1)
}
console.log('Still pending. Check the contract page on the explorer in a minute.')
