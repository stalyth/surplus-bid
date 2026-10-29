import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const journey = JSON.parse(await readFile(new URL('../public/evidence/judge-journey.json', import.meta.url), 'utf8'))
const market = JSON.parse(await readFile(new URL('../public/evidence/confirmed-market-settlements.json', import.meta.url), 'utf8'))

test('public judge journey contains one complete, linkable Testnet transaction path', () => {
  const { chainJourney } = journey
  assert.equal(chainJourney.instance.index, '13026')
  assert.equal(chainJourney.steps.length, 8)
  assert.deepEqual(chainJourney.steps.map((step) => step.key), [
    'initialize',
    'start_round',
    'commit_bid_1',
    'commit_bid_2',
    'reveal_bid_1',
    'reveal_bid_2',
    'reveal_reserve',
    'finalize',
  ])
  const hashes = new Set()
  for (const step of chainJourney.steps) {
    assert.match(step.hash, /^[0-9a-f]{64}$/)
    assert.equal(step.explorerUrl, `https://ccdexplorer.io/testnet/transaction/${step.hash}`)
    hashes.add(step.hash)
  }
  assert.equal(hashes.size, chainJourney.steps.length)
})

test('public judge result reconciles and matches the confirmed market record', () => {
  const result = journey.chainJourney.result
  const total = BigInt(result.totalDepositedMicroCcd)
  const distributed = BigInt(result.sellerReceivesMicroCcd) + BigInt(result.platformFeeMicroCcd) + BigInt(result.totalRefundMicroCcd)
  assert.equal(result.phase, 'Settled')
  assert.equal(result.reconciled, true)
  assert.equal(total, distributed)
  assert.equal(result.contractBalanceMicroCcd, '0')

  const marketRecord = market.settlements.find((record) => record.instance.index === journey.chainJourney.instance.index)
  assert.ok(marketRecord)
  assert.equal(marketRecord.service.id, journey.service.serviceId)
  assert.equal(marketRecord.transaction.hash, journey.chainJourney.steps.at(-1).hash)
  assert.equal(marketRecord.clearingPriceMicroCcd, result.clearingPriceMicroCcd)
  assert.equal(marketRecord.totalDepositedMicroCcd, result.totalDepositedMicroCcd)
})

test('public judge journey keeps model evaluation separate from chain provenance', () => {
  assert.equal(journey.sellerDecisionEvidence.sameRunAsChainJourney, false)
  assert.match(journey.limitations[0], /separate evidence sets/)
})
