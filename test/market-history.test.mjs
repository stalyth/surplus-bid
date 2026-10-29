import test from 'node:test'
import assert from 'node:assert/strict'

import { createConfirmedSettlement, isConfirmedSettlement } from '../src/market-history.mjs'

const INITIALIZATION = {
  sender: '4L6swfbApoVxnvxz1oyEpg3vyjLZjr8AZg2ofEn2ze6mRgbRdb',
  address: { index: '13023', subindex: '0' },
  contractUrl: 'https://ccdexplorer.io/testnet/contract/13023/0',
}

const TRANSACTION = {
  hash: '52'.repeat(32),
  explorerUrl: `https://ccdexplorer.io/testnet/transaction/${'52'.repeat(32)}`,
  confirmedAt: '2026-10-28T04:30:58.864Z',
}

function settledView() {
  return {
    state: {
      phase: { Settled: [] },
      seller: INITIALIZATION.sender,
      config: { service_id: 'ab'.repeat(32) },
      reserve: { Some: '2000000' },
      total_deposited: '12000000',
      allocations: [
        {
          bidder: '36pDdmDey4q2iDGTUa4ZgVGybT4khHsCwv2ztLhn188vJkfkyp',
          won: true,
          bid: '4000000',
          price: '3000000',
          buyer_refund: '900000',
          platform_receives: '200000',
        },
        {
          bidder: '4jTMeo6sSSEdQWSczordmnSu6fy8Uq1A7aL4UZK6bAgiCs5ePU',
          won: false,
          bid: '6000000',
          price: '0',
          buyer_refund: '6000000',
          platform_receives: '0',
        },
      ],
    },
  }
}

test('creates a reconciled settlement ledger entry from the finalized chain view', () => {
  const record = createConfirmedSettlement({
    initialization: INITIALIZATION,
    view: settledView(),
    transaction: TRANSACTION,
    serviceSpec: { hash: 'ab'.repeat(32), spec: { serviceName: 'Priority AI Analysis', capacityUnits: 1 } },
  })
  assert.equal(record.service.name, 'Priority AI Analysis')
  assert.equal(record.version, 2)
  assert.equal(record.allocatedUnits, 1)
  assert.equal(record.winners[0].bidMicroCcd, '4000000')
  assert.equal(record.winningBidMicroCcd, '4000000')
  assert.equal(record.clearingPriceMicroCcd, '3000000')
  assert.equal(record.surplusMicroCcd, '2000000')
  assert.equal(record.platformFeeMicroCcd, '200000')
  assert.equal(record.sellerReceivesMicroCcd, '4900000')
  assert.equal(record.reconciled, true)
  assert.equal(isConfirmedSettlement(record), true)
})

test('refuses to create a market record before settlement', () => {
  const view = settledView()
  view.state.phase = { Reveal: [] }
  assert.throws(() => createConfirmedSettlement({ initialization: INITIALIZATION, view, transaction: TRANSACTION }))
})

test('records both winners and uses a per-unit average for a two-unit capacity window', () => {
  const view = settledView()
  view.state.total_deposited = '17000000'
  view.state.allocations[1] = {
    bidder: '4jTMeo6sSSEdQWSczordmnSu6fy8Uq1A7aL4UZK6bAgiCs5ePU',
    won: true,
    bid: '6000000',
    price: '4000000',
    buyer_fee: '200000',
    buyer_refund: '1800000',
    platform_receives: '400000',
  }
  const record = createConfirmedSettlement({
    initialization: INITIALIZATION,
    view,
    transaction: TRANSACTION,
    serviceSpec: { hash: 'ab'.repeat(32), spec: { serviceName: 'Priority AI Analysis', capacityUnits: 2 } },
  })
  assert.equal(record.allocatedUnits, 2)
  assert.equal(record.winners.length, 2)
  assert.equal(record.averageClearingPriceMicroCcd, '3500000')
  assert.equal(record.totalClearingPriceMicroCcd, '7000000')
  assert.equal(record.totalSurplusMicroCcd, '6000000')
})

test('records a reconciled no-sale outcome for future Seller Agent price decisions', () => {
  const view = settledView()
  view.state.phase = { NoSale: [] }
  view.state.allocations = []
  view.state.total_deposited = '2000000'
  const record = createConfirmedSettlement({
    initialization: INITIALIZATION,
    view,
    transaction: TRANSACTION,
    serviceSpec: { hash: 'ab'.repeat(32), spec: { serviceName: 'Priority AI Analysis', capacityUnits: 2 } },
  })
  assert.equal(record.outcome, 'no_sale')
  assert.equal(record.allocatedUnits, 0)
  assert.equal(record.reserveMicroCcd, '2000000')
  assert.equal(isConfirmedSettlement(record), true)
})
