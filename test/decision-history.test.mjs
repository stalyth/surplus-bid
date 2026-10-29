import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTestnetDecisionHistory } from '../src/decision-history.mjs'

function settlement({ index, settledAt, reserve, bid, capacityUnits = 1, version = 1 }) {
  return {
    version,
    settledAt,
    instance: { index: String(index), subindex: '0' },
    transaction: {
      hash: String(index).padStart(64, '0'),
      explorerUrl: `https://ccdexplorer.io/testnet/transaction/${String(index).padStart(64, '0')}`,
    },
    service: { name: 'Priority AI Analysis', capacityUnits },
    reserveMicroCcd: reserve,
    winningBidMicroCcd: bid,
    clearingPriceMicroCcd: bid,
    surplusMicroCcd: (BigInt(bid) - BigInt(reserve)).toString(),
    reconciled: true,
  }
}

test('builds Seller Agent input from only reconciled local Testnet settlements without hashes', () => {
  const history = buildTestnetDecisionHistory([
    settlement({ index: 2, settledAt: '2026-10-28T08:00:00.000Z', reserve: '2200000', bid: '2900000' }),
    settlement({ index: 1, settledAt: '2026-10-28T07:00:00.000Z', reserve: '2200000', bid: '3000000' }),
    settlement({ index: 3, settledAt: '2026-10-28T09:00:00.000Z', reserve: '2200000', bid: '4000000' }),
    { ...settlement({ index: 4, settledAt: '2026-10-28T10:00:00.000Z', reserve: '2200000', bid: '9000000' }), reconciled: false },
  ], { marketName: 'Priority AI Analysis', nextSupplyUnits: 2 })

  assert.equal(history.provenance.recordCount, 3)
  assert.equal(history.provenance.hashesSentToModel, false)
  assert.equal(history.input.dataLabel, 'testnet')
  assert.equal(history.input.currentReserveMicroCcd, '2200000')
  assert.equal(history.input.previousSupplyUnits, 1)
  assert.equal(history.input.nextSupplyUnits, 2)
  assert.deepEqual(history.input.rounds.map((round) => round.id), ['testnet-1-0', 'testnet-2-0', 'testnet-3-0'])
  assert.deepEqual(history.input.rounds.map((round) => round.bidderCount), [null, null, null])
  assert.equal(JSON.stringify(history.input).includes('0000000000000000000000000000000000000000000000000000000000000001'), false)
})

test('refuses to call the Seller Agent with fewer than three local verified settlements', () => {
  assert.throws(
    () => buildTestnetDecisionHistory([
      settlement({ index: 1, settledAt: '2026-10-28T07:00:00.000Z', reserve: '2200000', bid: '3000000' }),
      settlement({ index: 2, settledAt: '2026-10-28T08:00:00.000Z', reserve: '2200000', bid: '2900000' }),
    ], { marketName: 'Priority AI Analysis', nextSupplyUnits: 2 }),
    /至少需要 3 笔/,
  )
})

test('keeps a verified zero-allocation outcome so the next decision must consider it', () => {
  const noSale = settlement({ index: 3, settledAt: '2026-10-28T09:00:00.000Z', reserve: '2200000', bid: '0', capacityUnits: 2 })
  noSale.outcome = 'no_sale'
  noSale.allocatedUnits = 0
  const history = buildTestnetDecisionHistory([
    settlement({ index: 1, settledAt: '2026-10-28T07:00:00.000Z', reserve: '2200000', bid: '3000000' }),
    settlement({ index: 2, settledAt: '2026-10-28T08:00:00.000Z', reserve: '2200000', bid: '2900000' }),
    noSale,
  ], { marketName: 'Priority AI Analysis', nextSupplyUnits: 2 })
  assert.equal(history.input.rounds.at(-1).outcome, 'no_sale')
  assert.equal(history.input.rounds.at(-1).allocatedUnits, 0)
})
