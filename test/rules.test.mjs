import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEMO_AGENTS,
  DemoRuleError,
  MICRO_CCD,
  closeBuyerReveal,
  closeCommitAndReveal,
  commitDemoBid,
  contractBalanceMicro,
  createDemoAuction,
  finalizeDemoAuction,
  revealDemoBid,
  settleWinningBid,
} from '../src/rules.mjs'

function readyAuction() {
  let auction = createDemoAuction(Date.UTC(2026, 9, 24, 10, 0, 0))
  auction = commitDemoBid(auction, DEMO_AGENTS[0])
  auction = commitDemoBid(auction, DEMO_AGENTS[1])
  auction = commitDemoBid(auction, DEMO_AGENTS[2])
  auction = closeCommitAndReveal(auction)
  auction = revealDemoBid(auction, DEMO_AGENTS[0])
  auction = revealDemoBid(auction, DEMO_AGENTS[1])
  auction = revealDemoBid(auction, DEMO_AGENTS[2])
  return closeBuyerReveal(auction)
}

test('commit-reveal capacity allocation settles two of three buyers and conserves every microCCD', () => {
  const before = readyAuction()
  assert.equal(contractBalanceMicro(before), 17n * MICRO_CCD)
  const auction = finalizeDemoAuction(before)
  const firstAccount = auction.settlement.allocations.find((item) => item.agentId === 'account-36pddm-jkfkyp')
  const secondAccount = auction.settlement.allocations.find((item) => item.agentId === 'account-4jtmeo-5epu')
  const thirdAccount = auction.settlement.allocations.find((item) => item.agentId === 'account-4awg-nddj')
  assert.equal(auction.phase, 'Finalized')
  assert.equal(firstAccount.won, false)
  assert.equal(firstAccount.refundMicro, 4n * MICRO_CCD)
  assert.equal(secondAccount.priceMicro, 4n * MICRO_CCD)
  assert.equal(secondAccount.refundMicro, 1_800_000n)
  assert.equal(thirdAccount.priceMicro, 3_500_000n)
  assert.equal(thirdAccount.refundMicro, 1_350_000n)
  assert.equal(auction.settlement.sellerReceivesMicro, 7_150_000n)
  assert.equal(auction.settlement.platformReceivesMicro, 700_000n)
  assert.equal(contractBalanceMicro(auction), 0n)
  const distributed = firstAccount.refundMicro + secondAccount.refundMicro + thirdAccount.refundMicro +
    auction.settlement.sellerReceivesMicro + auction.settlement.platformReceivesMicro +
    auction.settlement.sellerGuaranteeRefundMicro
  assert.equal(distributed, 17n * MICRO_CCD)
})

test('amounts stay hidden until reveal and duplicate commitments are rejected', () => {
  let auction = createDemoAuction()
  auction = commitDemoBid(auction, DEMO_AGENTS[0])
  assert.equal(auction.reserveMicro, null)
  assert.equal(auction.bids[0].revealedBidMicro, null)
  assert.throws(() => commitDemoBid(auction, DEMO_AGENTS[0]), (error) =>
    error instanceof DemoRuleError && error.code === 'DUPLICATE_BID')
})

test('a fourth commitment is rejected by the bounded three-order rule', () => {
  let auction = createDemoAuction()
  for (const agent of DEMO_AGENTS) auction = commitDemoBid(auction, agent)
  assert.throws(() => commitDemoBid(auction, {
    id: 'account-fourth', name: '账户 fourth', bidMicro: 7n * MICRO_CCD, commitment: 'sha256:fourth',
  }), (error) => error instanceof DemoRuleError && error.code === 'BID_LIMIT')
})

test('finalize before buyer reveal closes is rejected without changing state', () => {
  let auction = createDemoAuction()
  auction = commitDemoBid(auction, DEMO_AGENTS[0])
  auction = closeCommitAndReveal(auction)
  assert.throws(() => finalizeDemoAuction(auction), (error) =>
    error instanceof DemoRuleError && error.code === 'WRONG_PHASE')
  assert.equal(auction.phase, 'BuyerReveal')
})

test('fee threshold and per-side floor follow the confirmed rule', () => {
  const waived = settleWinningBid({ amountMicro: 105n, escrowMicro: 105n }, 100n)
  assert.equal(waived.priceMicro, 102n)
  assert.equal(waived.platformFeeMicro, 0n)
  const charged = settleWinningBid({ amountMicro: 6_000_019n, escrowMicro: 6_000_019n }, 2_000_000n)
  assert.equal(charged.priceMicro, 4_000_009n)
  assert.equal(charged.buyerFeeMicro, 200_000n)
  assert.equal(charged.sellerFeeMicro, 200_000n)
  assert.equal(charged.platformFeeMicro, 400_000n)
})

test('a finalized auction cannot pay twice', () => {
  const auction = finalizeDemoAuction(readyAuction())
  assert.throws(() => finalizeDemoAuction(auction), (error) =>
    error instanceof DemoRuleError && error.code === 'WRONG_PHASE')
})
