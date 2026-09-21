import { keccak256, toUtf8Bytes } from 'ethers'

// Shared encoding for the HoneyChain smart contract (blockchain/contracts/HoneyChain.sol):
// identifiers, the EIP-712 typed data each signer approves, and the Merkle tree of jar IDs.
// The contract tests import this file too, so the backend and the contract cannot drift apart.

export const idOf = (text) => keccak256(toUtf8Bytes(String(text)))

export const TYPES = {
  RegisterBatch: [
    { name: 'batchId', type: 'bytes32' }, { name: 'harvester', type: 'address' }, { name: 'quantityGrams', type: 'uint32' },
    { name: 'harvestedAt', type: 'uint64' }, { name: 'ledgerEventHash', type: 'bytes32' },
  ],
  CertifyBatch: [
    { name: 'batchId', type: 'bytes32' }, { name: 'officer', type: 'address' }, { name: 'labReportHash', type: 'bytes32' },
    { name: 'metadataCid', type: 'string' }, { name: 'passed', type: 'bool' },
  ],
  RegisterJars: [
    { name: 'lotId', type: 'bytes32' }, { name: 'batchId', type: 'bytes32' }, { name: 'merkleRoot', type: 'bytes32' },
    { name: 'count', type: 'uint32' }, { name: 'jarGrams', type: 'uint32' },
  ],
  LooseSale: [
    { name: 'saleId', type: 'bytes32' }, { name: 'batchId', type: 'bytes32' }, { name: 'grams', type: 'uint32' }, { name: 'buyerHash', type: 'bytes32' },
  ],
  ReverseLooseSale: [{ name: 'saleId', type: 'bytes32' }, { name: 'batchId', type: 'bytes32' }],
}

export const domainFor = (chainId, verifyingContract) => ({ name: 'HoneyChain', version: '1', chainId, verifyingContract })

export const leafOf = (jarId) => idOf(jarId)

// Sorted-pair keccak Merkle tree (the same rule the contract uses in verifyJar).
const pair = (a, b) => (a < b ? keccak256(`0x${a.slice(2)}${b.slice(2)}`) : keccak256(`0x${b.slice(2)}${a.slice(2)}`))

export function buildMerkle(leaves) {
  if (leaves.length === 0) throw new Error('A Merkle tree needs at least one leaf')

  const levels = [leaves]
  while (levels[levels.length - 1].length > 1) {
    const level = levels[levels.length - 1]
    const next = []
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? pair(level[i], level[i + 1]) : level[i])
    levels.push(next)
  }

  return {
    root: levels[levels.length - 1][0],
    proofFor(leaf) {
      let index = leaves.indexOf(leaf)
      if (index < 0) return null
      const proof = []
      for (let depth = 0; depth < levels.length - 1; depth++) {
        const sibling = index ^ 1
        if (sibling < levels[depth].length) proof.push(levels[depth][sibling])
        index = Math.floor(index / 2)
      }
      return proof
    },
  }
}
