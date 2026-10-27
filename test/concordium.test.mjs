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
  deriveAuctionRole,
  getTransactionSender,
  hasRevealedBid,
  parseCcdToMicroCcd,
  prepareStartRound,
  prepareBidCommitment,
  selectWalletAccount,
  shortAccountAddress,
  verifyWalletAuthorization,
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

test('parses a buyer-entered CCD amount exactly to microCCD', () => {
  assert.equal(parseCcdToMicroCcd('2'), '2000000')
  assert.equal(parseCcdToMicroCcd('2.25'), '2250000')
  assert.equal(parseCcdToMicroCcd('2.000001'), '2000001')
  assert.throws(() => parseCcdToMicroCcd('2.0000001'), (error) => error instanceof ConcordiumClientError && error.code === 'INVALID_CCD_AMOUNT')
  assert.throws(() => parseCcdToMicroCcd('-2'), (error) => error instanceof ConcordiumClientError && error.code === 'INVALID_CCD_AMOUNT')
})

test('an explicit connect lists authorized accounts even when the recent account is older', async () => {
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
        return ['4L6swfbApoVxnvxz1oyEpg3vyjLZjr8AZg2ofEn2ze6mRgbRdb']
      },
      getSelectedChain: async () => CONCORDIUM_TESTNET_GENESIS_HASH,
    },
  }
  try {
    const connection = await connectConcordiumWallet()
    assert.deepEqual(connection.accounts, ['4L6swfbApoVxnvxz1oyEpg3vyjLZjr8AZg2ofEn2ze6mRgbRdb'])
    assert.deepEqual(connection.authorizedAccounts, connection.accounts)
    assert.equal(connectCalls, 0)
    assert.equal(requestAccountCalls, 1)
  } finally {
    globalThis.window = originalWindow
  }
})

test('explicitly selected buyer B remains the transaction sender after authorization refresh', async () => {
  const buyerA = INSTANCE.sender
  const buyerB = '4jTMeo6sSSEdQWSczordmnSu6fy8Uq1A7aL4UZK6bAgiCs5ePU'
  const originalWindow = globalThis.window
  const provider = {
    requestAccounts: async () => [buyerA, buyerB],
    getMostRecentlySelectedAccount: async () => buyerA,
    getSelectedChain: async () => CONCORDIUM_TESTNET_GENESIS_HASH,
  }
  globalThis.window = { concordiumSDK: sdk, concordium: provider }
  try {
    const connection = await connectConcordiumWallet()
    assert.deepEqual(connection.authorizedAccounts, [buyerA, buyerB])
    selectWalletAccount(connection, buyerB)
    await verifyWalletAuthorization(connection)
    assert.equal(getTransactionSender(connection), buyerB)
    assert.deepEqual(connection.accounts, [buyerB])
  } finally {
    globalThis.window = originalWindow
  }
})

test('revoked account blocks transaction preparation without silently switching to another account', async () => {
  const buyerA = INSTANCE.sender
  const buyerB = '4jTMeo6sSSEdQWSczordmnSu6fy8Uq1A7aL4UZK6bAgiCs5ePU'
  const connection = {
    provider: {
      requestAccounts: async () => [buyerA],
      getSelectedChain: async () => CONCORDIUM_TESTNET_GENESIS_HASH,
    },
    accounts: [buyerB],
    authorizedAccounts: [buyerA, buyerB],
  }
  await assert.rejects(
    verifyWalletAuthorization(connection),
    (error) => error instanceof ConcordiumClientError && error.code === 'ACCOUNT_NOT_AUTHORIZED',
  )
  assert.deepEqual(connection.accounts, [buyerB])
})

test('detects whether the selected buyer has already revealed on chain', () => {
  const buyerA = INSTANCE.sender
  const buyerB = '4jTMeo6sSSEdQWSczordmnSu6fy8Uq1A7aL4UZK6bAgiCs5ePU'
  const view = {
    state: {
      bids: [
        { bidder: buyerA, revealed_bid: { Some: ['4000000'] } },
        { bidder: buyerB, revealed_bid: { None: [] } },
      ],
    },
  }
  assert.equal(hasRevealedBid(view, buyerA), true)
  assert.equal(hasRevealedBid(view, buyerB), false)
})

test('derives seller, buyer, and committed buyer roles from on-chain state', () => {
  const seller = INSTANCE.sender
  const buyer = '4jTMeo6sSSEdQWSczordmnSu6fy8Uq1A7aL4UZK6bAgiCs5ePU'
  const otherBuyer = '4L6swfbApoVxnvxz1oyEpg3vyjLZjr8AZg2ofEn2ze6mRgbRdb'
  const initialization = { ...INSTANCE, sender: seller }
  const view = { state: { bids: [{ bidder: buyer }] } }

  assert.equal(deriveAuctionRole({ account: seller, initialization, view }), 'seller')
  assert.equal(deriveAuctionRole({ account: buyer, initialization, view }), 'committedBuyer')
  assert.equal(deriveAuctionRole({ account: otherBuyer, initialization, view }), 'buyer')
  assert.equal(deriveAuctionRole({ account: null, initialization, view }), 'observer')
  assert.equal(deriveAuctionRole({ account: otherBuyer, initialization: null, view: null }), 'sellerCandidate')
})

test('keeps the transaction sender available after the global wallet connection disconnects', () => {
  const submittedConnection = { accounts: [INSTANCE.sender] }
  let activeConnection = submittedConnection
  activeConnection = null

  assert.equal(activeConnection, null)
  assert.equal(getTransactionSender(submittedConnection), INSTANCE.sender)
})

test('prepares a seller-bound start_round with fixed 3 + 3 minute windows', async () => {
  const originalWindow = globalThis.window
  globalThis.window = { concordiumSDK: sdk }
  try {
    const plan = await prepareStartRound({ accounts: [INSTANCE.sender] }, INSTANCE, { now: 1_790_000_000_000 })
    assert.equal(plan.seller, INSTANCE.sender)
    assert.equal(plan.reserveSaltHex.length, 64)
    assert.equal(plan.parameters.reserve_commitment.length, 32)
    assert.equal(plan.parameters.commit_end, '1790000180000')
    assert.equal(plan.parameters.reveal_end, '1790000360000')
    assert.equal(plan.parameters.max_bids, START_ROUND_RULES.maxBids)
  } finally {
    globalThis.window = originalWindow
  }
})

test('binds the code-validated Seller Agent reserve into the hidden start-round commitment', async () => {
  const originalWindow = globalThis.window
  globalThis.window = { concordiumSDK: sdk }
  try {
    const plan = await prepareStartRound({ accounts: [INSTANCE.sender] }, INSTANCE, {
      now: 1_790_000_000_000,
      reserveMicroCcd: '2300000',
    })
    assert.equal(plan.reserveMicroCcd, '2300000')
    assert.equal(plan.reserveCommitment.length, 32)
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

test('prepares a buyer-entered decimal bid commitment with a distinct buyer and a 32-byte reveal salt', async () => {
  const originalWindow = globalThis.window
  globalThis.window = { concordiumSDK: sdk }
  try {
    const buyer = '4jTMeo6sSSEdQWSczordmnSu6fy8Uq1A7aL4UZK6bAgiCs5ePU'
    const plan = await prepareBidCommitment({ accounts: [buyer] }, INSTANCE, parseCcdToMicroCcd('4.25'))
    assert.equal(plan.bidder, buyer)
    assert.equal(plan.amountMicroCcd, '4250000')
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
      () => prepareBidCommitment({ accounts: [INSTANCE.sender] }, INSTANCE, '4000000'),
      (error) => error instanceof ConcordiumClientError && error.code === 'SELLER_CANNOT_BID',
    )
  } finally {
    globalThis.window = originalWindow
  }
})
