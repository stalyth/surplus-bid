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
