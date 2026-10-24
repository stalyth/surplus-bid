export const MICRO_CCD = 1_000_000n

export const DEMO_RULES = Object.freeze({
  service: 'Priority AI Analysis',
  capacity: 1,
  guaranteeMicro: 2n * MICRO_CCD,
  commitMinutes: 5,
  sellerRevealMinutes: 2,
  buyerRevealMinutes: 2,
  maxBids: 2,
  pricingRule: 'Midpoint preview',
  feeRule: '10% of trade surplus, shared equally; waived below 10% of price',
})

export const DEMO_AGENTS = Object.freeze([
  Object.freeze({ id: 'buyer-a', name: 'Buyer Agent A', bidMicro: 4n * MICRO_CCD, commitment: 'sha256:buyer-a-demo' }),
  Object.freeze({ id: 'buyer-b', name: 'Buyer Agent B', bidMicro: 6n * MICRO_CCD, commitment: 'sha256:buyer-b-demo' }),
])

export class DemoRuleError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'DemoRuleError'
    this.code = code
  }
}

export function createDemoAuction(now = Date.now()) {
  return {
    id: `demo-${new Date(now).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
    service: DEMO_RULES.service,
    capacity: DEMO_RULES.capacity,
    guaranteeMicro: DEMO_RULES.guaranteeMicro,
    reserveCommitment: 'sha256:seller-reserve-demo',
    reserveMicro: null,
    maxBids: DEMO_RULES.maxBids,
    createdAt: new Date(now).toISOString(),
    commitEnd: new Date(now + DEMO_RULES.commitMinutes * 60_000).toISOString(),
    phase: 'Commit',
    bids: [],
    settlement: null,
  }
}

export function commitDemoBid(auction, agent) {
  assertPhase(auction, 'Commit')
  if (auction.bids.some((bid) => bid.agentId === agent.id)) {
    throw new DemoRuleError('DUPLICATE_BID', `${agent.name} 已经提交过承诺。`)
  }
  if (auction.bids.length >= auction.maxBids) throw new DemoRuleError('BID_LIMIT', '本轮承诺数量已达到上限。')
  return {
    ...auction,
    bids: [...auction.bids, {
      agentId: agent.id,
      name: agent.name,
      commitment: agent.commitment,
      committedBidMicro: agent.bidMicro,
      sequence: auction.bids.length,
      revealedBidMicro: null,
      escrowMicro: auction.guaranteeMicro,
    }],
  }
}

export function closeCommitAndReveal(auction, reserveMicro = 2n * MICRO_CCD) {
  assertPhase(auction, 'Commit')
  if (auction.bids.length === 0) throw new DemoRuleError('NO_BIDS', '没有买家承诺，不能进入主演示的揭示流程。')
  return { ...auction, phase: 'BuyerReveal', reserveMicro }
}

export function revealDemoBid(auction, agent) {
  assertPhase(auction, 'BuyerReveal')
  const bid = auction.bids.find((candidate) => candidate.agentId === agent.id)
  if (!bid) throw new DemoRuleError('MISSING_COMMITMENT', `${agent.name} 没有报价承诺。`)
  if (bid.revealedBidMicro !== null) throw new DemoRuleError('ALREADY_REVEALED', `${agent.name} 已揭示报价。`)
  if (bid.committedBidMicro !== agent.bidMicro || bid.commitment !== agent.commitment) {
    throw new DemoRuleError('COMMITMENT_MISMATCH', `${agent.name} 的揭示与承诺不匹配。`)
  }
  return {
    ...auction,
    bids: auction.bids.map((candidate) => candidate.agentId === agent.id
      ? {
          ...candidate,
          revealedBidMicro: agent.bidMicro,
          escrowMicro: agent.bidMicro > auction.guaranteeMicro ? agent.bidMicro : auction.guaranteeMicro,
        }
      : candidate),
  }
}

export function closeBuyerReveal(auction) {
  assertPhase(auction, 'BuyerReveal')
  return { ...auction, phase: 'ReadyToFinalize' }
}

export function finalizeDemoAuction(auction) {
  assertPhase(auction, 'ReadyToFinalize')
  const ranked = auction.bids
    .filter((bid) => bid.revealedBidMicro !== null && bid.revealedBidMicro >= auction.reserveMicro)
    .sort((left, right) => {
      if (left.revealedBidMicro === right.revealedBidMicro) return left.sequence - right.sequence
      return left.revealedBidMicro > right.revealedBidMicro ? -1 : 1
    })

  if (ranked.length === 0) {
    return {
      ...auction,
      phase: 'NoSale',
      settlement: {
        allocations: auction.bids.map((bid) => ({ ...bid, won: false, refundMicro: bid.escrowMicro })),
        sellerGuaranteeRefundMicro: auction.guaranteeMicro,
        contractBalanceMicro: 0n,
      },
    }
  }

  const winner = ranked[0]
  const allocations = auction.bids.map((bid) => bid.agentId === winner.agentId
    ? settleWinningBid(bid, auction.reserveMicro)
    : { ...bid, won: false, refundMicro: bid.escrowMicro })
  const winningAllocation = allocations.find((item) => item.won)
  return {
    ...auction,
    phase: 'Finalized',
    settlement: {
      allocations,
      sellerGuaranteeRefundMicro: auction.guaranteeMicro,
      sellerReceivesMicro: winningAllocation.sellerReceivesMicro,
      platformReceivesMicro: winningAllocation.platformFeeMicro,
      contractBalanceMicro: 0n,
    },
  }
}

export function settleWinningBid(bid, reserveMicro) {
  const amountMicro = bid.revealedBidMicro ?? bid.amountMicro
  if (amountMicro < reserveMicro) throw new DemoRuleError('BELOW_RESERVE', '低于底价的报价不能中标。')
  const surplusMicro = amountMicro - reserveMicro
  const priceMicro = reserveMicro + surplusMicro / 2n
  const buyerFeeMicro = surplusMicro * 10n < priceMicro ? 0n : surplusMicro / 20n
  const sellerFeeMicro = buyerFeeMicro
  const platformFeeMicro = buyerFeeMicro + sellerFeeMicro
  const buyerSpendMicro = priceMicro + buyerFeeMicro
  if (buyerSpendMicro > amountMicro) throw new DemoRuleError('BID_CAP_EXCEEDED', '成交价与买家费用之和超过报价上限。')
  return {
    ...bid,
    amountMicro,
    won: true,
    surplusMicro,
    priceMicro,
    platformFeeMicro,
    buyerFeeMicro,
    sellerFeeMicro,
    buyerSpendMicro,
    refundMicro: bid.escrowMicro - buyerSpendMicro,
    sellerReceivesMicro: priceMicro - sellerFeeMicro,
  }
}

export function contractBalanceMicro(auction) {
  if (!auction || auction.phase === 'Finalized' || auction.phase === 'NoSale') return 0n
  return auction.guaranteeMicro + auction.bids.reduce((total, bid) => total + bid.escrowMicro, 0n)
}

export function formatCcd(microCcd) {
  const whole = microCcd / MICRO_CCD
  const fraction = (microCcd % MICRO_CCD).toString().padStart(6, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function assertPhase(auction, expected) {
  if (auction.phase !== expected) throw new DemoRuleError('WRONG_PHASE', `当前状态为 ${auction.phase}，此操作只允许在 ${expected} 阶段执行。`)
}
