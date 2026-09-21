import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { createRequire } from 'node:module'
import { BrowserProvider, ContractFactory, Wallet, ZeroHash, keccak256, toUtf8Bytes } from 'ethers'

import { TYPES, buildMerkle, domainFor, idOf, leafOf } from '../../APICtech/backend/src/services/chainCodec.js'
import { readArtifact } from '../scripts/common.mjs'

const hre = createRequire(import.meta.url)('hardhat')

async function rejects(promise, text) {
  await assert.rejects(promise, (error) => new RegExp(text, 'i').test(`${error.message} ${error.shortMessage || ''} ${error.reason || ''}`))
}

describe('HoneyChain contract', () => {
  let provider, owner, contract, domain, harvester, officer, stranger

  before(async () => {
    provider = new BrowserProvider(hre.network.provider)
    owner = await provider.getSigner(0)
    const artifact = readArtifact()
    contract = await new ContractFactory(artifact.abi, artifact.bytecode, owner).deploy(await owner.getAddress())
    await contract.waitForDeployment()

    const chainId = Number((await provider.getNetwork()).chainId)
    domain = domainFor(chainId, await contract.getAddress())
    harvester = Wallet.createRandom()
    officer = Wallet.createRandom()
    stranger = Wallet.createRandom()

    await (await contract.setHarvester(harvester.address, true)).wait()
    await (await contract.setOfficer(officer.address, true)).wait()
  })

  const batchId = idOf('HC-2026-0001')
  const register = (id, grams, wallet = harvester) => wallet.signTypedData(domain, { RegisterBatch: TYPES.RegisterBatch }, {
    batchId: id, harvester: harvester.address, quantityGrams: grams, harvestedAt: 1_780_000_000, ledgerEventHash: keccak256(toUtf8Bytes('event-1')),
  })
  const certify = (id, wallet = officer, passed = true) => wallet.signTypedData(domain, { CertifyBatch: TYPES.CertifyBatch }, {
    batchId: id, officer: officer.address, labReportHash: keccak256(toUtf8Bytes('report')), metadataCid: 'bafkreiexample', passed,
  })

  it('only the owner can grant roles', async () => {
    const other = await provider.getSigner(1)
    await rejects(contract.connect(other).setOfficer(stranger.address, true), 'only owner')
  })

  it('registers a batch only with the harvester\'s own signature', async () => {
    const forged = await register(batchId, 5000, stranger)
    await rejects(contract.registerBatch(batchId, 5000, 1_780_000_000, keccak256(toUtf8Bytes('event-1')), harvester.address, forged), 'bad harvester signature')
    await rejects(contract.registerBatch(batchId, 5000, 1_780_000_000, keccak256(toUtf8Bytes('event-1')), stranger.address, await register(batchId, 5000)), 'not a registered harvester')

    await (await contract.registerBatch(batchId, 5000, 1_780_000_000, keccak256(toUtf8Bytes('event-1')), harvester.address, await register(batchId, 5000))).wait()
    const batch = await contract.getBatch(batchId)
    assert.equal(batch.quantityGrams, 5000n)
    assert.equal(batch.certified, false)
    await rejects(contract.registerBatch(batchId, 5000, 1_780_000_000, keccak256(toUtf8Bytes('event-1')), harvester.address, await register(batchId, 5000)), 'batch exists')
  })

  it('needs a second, officer signature to certify (dual-EOA)', async () => {
    const report = keccak256(toUtf8Bytes('report'))
    await rejects(contract.certifyBatch(batchId, report, 'bafkreiexample', true, officer.address, await certify(batchId, stranger)), 'bad officer signature')
    await rejects(contract.certifyBatch(batchId, report, 'bafkreiexample', true, harvester.address, await certify(batchId, harvester)), 'not a certified officer')
    await rejects(contract.certifyBatch(batchId, report, 'bafkreiother', true, officer.address, await certify(batchId)), 'bad officer signature')

    await (await contract.certifyBatch(batchId, report, 'bafkreiexample', true, officer.address, await certify(batchId))).wait()
    const batch = await contract.getBatch(batchId)
    assert.equal(batch.certified, true)
    assert.equal(batch.passed, true)
    assert.equal(batch.officer, officer.address)
    assert.equal(batch.metadataCid, 'bafkreiexample')
    await rejects(contract.certifyBatch(batchId, report, 'bafkreiexample', true, officer.address, await certify(batchId)), 'already certified')
  })

  const lot = (lotId, root, count, jarGrams) => harvester.signTypedData(domain, { RegisterJars: TYPES.RegisterJars }, { lotId, batchId, merkleRoot: root, count, jarGrams })
  const jarIds = Array.from({ length: 6 }, (_, index) => `PB-2026-001-JAR-${String(index + 1).padStart(6, '0')}`)
  const tree = buildMerkle(jarIds.map(leafOf))

  it('registers jars and proves a jar belongs to the batch', async () => {
    const lotId = idOf('PB-2026-001')
    await (await contract.registerJars(lotId, batchId, tree.root, 6, 500, await lot(lotId, tree.root, 6, 500))).wait()

    for (const id of jarIds) assert.equal(await contract.verifyJar(batchId, leafOf(id), tree.proofFor(leafOf(id))), true)
    assert.equal(await contract.verifyJar(batchId, leafOf('PB-2026-001-JAR-000099'), tree.proofFor(leafOf(jarIds[0]))), false)
    await rejects(contract.registerJars(lotId, batchId, tree.root, 6, 500, await lot(lotId, tree.root, 6, 500)), 'lot exists')
  })

  it('refuses more jars than honey: 5 kg allows 10 jars of 500 g in total', async () => {
    const more = idOf('PB-2026-002')
    await rejects(contract.registerJars(more, batchId, ZeroHash, 5, 500, await lot(more, ZeroHash, 5, 500)), 'more jars than honey')
    const four = idOf('PB-2026-003')
    await (await contract.registerJars(four, batchId, keccak256(toUtf8Bytes('root-4')), 4, 500, await lot(four, keccak256(toUtf8Bytes('root-4')), 4, 500))).wait()
    assert.equal((await contract.getBatch(batchId)).jarGrams, 5000n)
  })

  const sale = (saleId, grams, buyerHash, wallet = harvester) => wallet.signTypedData(domain, { LooseSale: TYPES.LooseSale }, { saleId, batchId, grams, buyerHash })

  it('shares the same honey limit between jars and loose sales, and lets a sale be reversed', async () => {
    const buyer = keccak256(toUtf8Bytes('Madurai Honey Traders'))
    const id = idOf('ORG:SAL-2026-001')
    await rejects(contract.recordLooseSale(id, batchId, 1000, buyer, await sale(id, 1000, buyer)), 'more honey than harvested')

    // free 1 kg by reversing nothing: instead start a fresh batch
    const second = idOf('HC-2026-0002')
    const sign = (types, name, value) => harvester.signTypedData(domain, { [name]: types }, value)
    const ledgerEventHash = keccak256(toUtf8Bytes('event-2'))
    await (await contract.registerBatch(second, 10_000, 1_780_000_100, ledgerEventHash, harvester.address, await sign(TYPES.RegisterBatch, 'RegisterBatch', { batchId: second, harvester: harvester.address, quantityGrams: 10_000, harvestedAt: 1_780_000_100, ledgerEventHash }))).wait()

    const saleId = idOf('ORG:SAL-2026-002')
    const signSale = await sign(TYPES.LooseSale, 'LooseSale', { saleId, batchId: second, grams: 7500, buyerHash: buyer })
    await rejects(contract.recordLooseSale(saleId, second, 7500, buyer, await sale(saleId, 7500, buyer, stranger)), 'bad harvester signature')
    await (await contract.recordLooseSale(saleId, second, 7500, buyer, signSale)).wait()
    assert.equal((await contract.getBatch(second)).looseGrams, 7500n)

    const tooMuch = idOf('ORG:SAL-2026-003')
    await rejects(contract.recordLooseSale(tooMuch, second, 3000, buyer, await sign(TYPES.LooseSale, 'LooseSale', { saleId: tooMuch, batchId: second, grams: 3000, buyerHash: buyer })), 'more honey than harvested')

    const reverse = await sign(TYPES.ReverseLooseSale, 'ReverseLooseSale', { saleId, batchId: second })
    await (await contract.reverseLooseSale(saleId, reverse)).wait()
    assert.equal((await contract.getBatch(second)).looseGrams, 0n)
    await rejects(contract.reverseLooseSale(saleId, reverse), 'nothing to reverse')
  })

  it('anchors the off-chain ledger head, forward only and only by the anchorer', async () => {
    const other = await provider.getSigner(1)
    const head = keccak256(toUtf8Bytes('head-12'))
    await rejects(contract.connect(other).anchorLedger(12, head), 'only anchorer')
    await (await contract.anchorLedger(12, head)).wait()
    assert.equal(await contract.anchoredHead(), head)
    assert.equal(await contract.anchoredHeight(), 12n)
    await rejects(contract.anchorLedger(5, head), 'moved backwards')
  })
})
