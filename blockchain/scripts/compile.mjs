// Compiles contracts/HoneyChain.sol with solc (bundled, works offline) into artifacts/HoneyChain.json
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const solc = createRequire(import.meta.url)('solc')

const source = fs.readFileSync(path.join(root, 'contracts', 'HoneyChain.sol'), 'utf8')
const input = {
  language: 'Solidity',
  sources: { 'HoneyChain.sol': { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
}
const output = JSON.parse(solc.compile(JSON.stringify(input)))

const problems = (output.errors || []).filter((item) => item.severity === 'error')
for (const item of output.errors || []) console[item.severity === 'error' ? 'error' : 'warn'](item.formattedMessage)
if (problems.length) process.exit(1)

const compiled = output.contracts['HoneyChain.sol'].HoneyChain
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true })
fs.writeFileSync(path.join(root, 'artifacts', 'HoneyChain.json'), JSON.stringify({ contractName: 'HoneyChain', abi: compiled.abi, bytecode: `0x${compiled.evm.bytecode.object}` }, null, 1))
// Exactly what a block explorer needs to verify the source of the deployed contract (scripts/verify.mjs).
fs.writeFileSync(path.join(root, 'artifacts', 'HoneyChain.standard-input.json'), JSON.stringify(input))
fs.writeFileSync(path.join(root, 'artifacts', 'build-info.json'), JSON.stringify({ compiler: `v${solc.version().replace(/\.Emscripten.*$/, '')}`, optimizer: true, runs: 200, viaIR: true }, null, 1))
console.log(`Compiled HoneyChain.sol: ${compiled.abi.length} ABI entries, ${Math.round(compiled.evm.bytecode.object.length / 2)} bytes of bytecode`)
