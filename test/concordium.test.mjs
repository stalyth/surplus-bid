import test from 'node:test'
import assert from 'node:assert/strict'
import { CcdAmount, ContractName, ReceiveName } from '@concordium/web-sdk'

import {
  CONCORDIUM_TESTNET_GENESIS_HASH,
  ConcordiumClientError,
  INITIAL_MARKET,
  PLATFORM_ACCOUNT,
  assertTransactionHash,
  assertConcordiumTestnet,
  shortAccountAddress,
} from '../src/concordium.mjs'

test('accepts Concordium Testnet genesis hash', () => {
  assert.doesNotThrow(() => assertConcordiumTestnet(CONCORDIUM_TESTNET_GENESIS_HASH))
})

test('locked SDK accepts the deployed contract and view receive names', () => {
  assert.equal(String(ContractName.fromString('surplus_bid')), 'surplus_bid')
  assert.equal(String(ReceiveName.fromString('surplus_bid.view')), 'surplus_bid.view')
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
  assert.equal(CcdAmount.toMicroCcd(CcdAmount.fromCcd(0)).toFixed(0), '0')
})
