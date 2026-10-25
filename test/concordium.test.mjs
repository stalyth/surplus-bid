import test from 'node:test'
import assert from 'node:assert/strict'
import * as sdk from '@concordium/web-sdk'

import {
  CONCORDIUM_TESTNET_GENESIS_HASH,
  ConcordiumClientError,
  INITIAL_MARKET,
  PLATFORM_ACCOUNT,
  START_ROUND_RULES,
  assertTransactionHash,
  assertConcordiumTestnet,
  connectConcordiumWallet,
  getTransactionSender,
  prepareStartRound,
  prepareBidCommitment,
  shortAccountAddress,
} from '../src/concordium.mjs'

const INSTANCE = Object.freeze({
  sender: '36pDdmDey4q2iDGTUa4ZgVGybT4khHsCwv2ztLhn188vJkfkyp',
  address: { index: '13006', subindex: '0' },
})

test('accepts Concordium Testnet genesis hash', () => {
  assert.doesNotThrow(() => assertConcordiumTestnet(CONCORDIUM_TESTNET_GENESIS_HASH))
})

test('locked SDK accepts the deployed contract and view receive names', () => {
  assert.equal(String(sdk.ContractName.fromString('surplus_bid')), 'surplus_bid')
  assert.equal(String(sdk.ReceiveName.fromString('surplus_bid.view')), 'surplus_bid.view')
})

test('rejects a wallet connected to another network before any contract action', () => {
  assert.throws(
    () => assertConcordiumTestnet('not-testnet'),
    (error) => error instanceof ConcordiumClientError && error.code === 'WRONG_NETWORK',
  )
})

test('shortens a public account address for the connected-wallet status', () => {
  assert.equal(shortAccountAddress('4L6swfbApoVxnvxz1oyEpg3vyjLZjr8AZg2ofEn2ze6mRgbRdb'), '4L6swf…RgbRdb')
})

test('uses the confirmed 2 CCD guarantee and platform account for initialization', () => {
  assert.equal(INITIAL_MARKET.guarantee, '2000000')
  assert.equal(INITIAL_MARKET.fee_recipient, PLATFORM_ACCOUNT)
})

test('rejects a missing wallet transaction hash before Testnet verification', () => {
  assert.throws(
    () => assertTransactionHash('not-a-hash'),
    (error) => error instanceof ConcordiumClientError && error.code === 'INVALID_TRANSACTION_HASH',
  )
})

test('compares a zero-CCD initialization amount as the SDK decimal value', () => {
  assert.equal(sdk.CcdAmount.toMicroCcd(sdk.CcdAmount.fromCcd(0)).toFixed(0), '0')
})

test('uses the allowlisted current wallet account ahead of older connected accounts', async () => {
  const originalWindow = globalThis.window
  let connectCalls = 0
  let requestAccountCalls = 0
  globalThis.window = {
    concordiumSDK: sdk,
    concordium: {
      getMostRecentlySelectedAccount: async () => INSTANCE.sender,
      connect: async () => {
        connectCalls += 1
        return 'previously-authorized-account'
      },
      requestAccounts: async () => {
        requestAccountCalls += 1
        return [INSTANCE.sender]
      },
      getSelectedChain: async () => CONCORDIUM_TESTNET_GENESIS_HASH,
    },
  }
  try {
    const connection = await connectConcordiumWallet()
    assert.deepEqual(connection.accounts, [INSTANCE.sender])
    assert.equal(connectCalls, 0)
    assert.equal(requestAccountCalls, 0)
  } finally {
    globalThis.window = originalWindow
  }
})

test('keeps the transaction sender available after the global wallet connection disconnects', () => {
  const submittedConnection = { accounts: [INSTANCE.sender] }
  let activeConnection = submittedConnection
  activeConnection = null

  assert.equal(activeConnection, null)
  assert.equal(getTransactionSender(submittedConnection), INSTANCE.sender)
})

test('prepares a seller-bound start_round with the fixed 20 + 5 + 5 minute windows', async () => {
  const originalWindow = globalThis.window
  globalThis.window = { concordiumSDK: sdk }
  try {
    const plan = await prepareStartRound({ accounts: [INSTANCE.sender] }, INSTANCE, { now: 1_790_000_000_000 })
    assert.equal(plan.seller, INSTANCE.sender)
    assert.equal(plan.reserveSaltHex.length, 64)
    assert.equal(plan.parameters.reserve_commitment.length, 32)
    assert.equal(plan.parameters.commit_end, '1790001200000')
    assert.equal(plan.parameters.seller_reveal_end, '1790001500000')
    assert.equal(plan.parameters.buyer_reveal_end, '1790001800000')
    assert.equal(plan.parameters.max_bids, START_ROUND_RULES.maxBids)
  } finally {
    globalThis.window = originalWindow
  }
})

test('rejects start_round before any wallet request when the selected account is not this instance seller', async () => {
  const originalWindow = globalThis.window
  globalThis.window = { concordiumSDK: sdk }
  try {
    await assert.rejects(
      () => prepareStartRound({ accounts: ['4L6swfbApoVxnvxz1oyEpg3vyjLZjr8AZg2ofEn2ze6mRgbRdb'] }, INSTANCE),
      (error) => error instanceof ConcordiumClientError && error.code === 'WRONG_SELLER_ACCOUNT',
    )
  } finally {
    globalThis.window = originalWindow
  }
})

test('prepares a 4 CCD bid commitment with a distinct buyer and a 32-byte reveal salt', async () => {
  const originalWindow = globalThis.window
  globalThis.window = { concordiumSDK: sdk }
  try {
    const buyer = '4jTMeo6sSSEdQWSczordmnSu6fy8Uq1A7aL4UZK6bAgiCs5ePU'
    const plan = await prepareBidCommitment({ accounts: [buyer] }, INSTANCE, 4)
    assert.equal(plan.bidder, buyer)
    assert.equal(plan.amountMicroCcd, '4000000')
    assert.equal(plan.saltHex.length, 64)
    assert.equal(plan.commitment.length, 32)
  } finally {
    globalThis.window = originalWindow
  }
})

test('rejects a seller attempting to prepare a buyer commitment', async () => {
  const originalWindow = globalThis.window
  globalThis.window = { concordiumSDK: sdk }
  try {
    await assert.rejects(
      () => prepareBidCommitment({ accounts: [INSTANCE.sender] }, INSTANCE, 4),
      (error) => error instanceof ConcordiumClientError && error.code === 'SELLER_CANNOT_BID',
    )
  } finally {
    globalThis.window = originalWindow
  }
})
