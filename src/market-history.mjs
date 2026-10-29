function amount(value) {
  if (Array.isArray(value)) return amount(value[0])
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'Some')) return amount(value.Some)
  return BigInt(value ?? 0)
}

function optional(value) {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'Some')) return value.Some
  return null
}

function variant(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return Object.keys(value)[0] ?? ''
  return ''
}

function serviceId(value) {
  if (Array.isArray(value)) return value.join('')
  return String(value ?? '')
}

function address(initialization) {
  if (!initialization?.address) throw new Error('结算记录缺少合约实例地址。')
  return {
    index: String(initialization.address.index),
    subindex: String(initialization.address.subindex),
  }
}

/**
 * Produces a display-ready, lossless record only after a successful settlement.
 * Every winner represents one allocated capacity unit. The compatibility fields
 * named `clearingPriceMicroCcd` and `winningBidMicroCcd` contain per-unit
 * averages; the per-winner facts remain in `winners`.
 * Amounts stay as decimal microCCD strings: UI formatting must never use floats.
 */
export function createConfirmedSettlement({ initialization, view, transaction, serviceSpec = null }) {
  const outcome = variant(view?.state?.phase)
  if (!['Settled', 'NoSale'].includes(outcome)) throw new Error('只有已结束实例可以写入成交记录。')
  if (!transaction?.hash || !transaction?.explorerUrl) throw new Error('成交记录缺少最终结算交易。')

  const allocations = Array.isArray(view.state.allocations) ? view.state.allocations : []
  const winners = allocations.filter((entry) => entry.won === true)
  const reserve = optional(view.state.reserve)
  if (reserve === null) throw new Error('已结束实例缺少已公开的卖家底价，不能用于策略历史。')

  const totalDeposited = amount(view.state.total_deposited)
  const refunds = allocations.reduce((total, entry) => total + amount(entry.buyer_refund), 0n)
  const platformFee = allocations.reduce((total, entry) => total + amount(entry.platform_receives), 0n)
  const sellerReceives = totalDeposited - refunds - platformFee
  const reserveAmount = amount(reserve)
  const winnerDetails = winners.map((winner) => {
    const bid = amount(winner.bid)
    const price = amount(winner.price)
    return {
      bidder: String(winner.bidder),
      sequence: Number(winner.sequence ?? 0),
      bidMicroCcd: bid.toString(),
      clearingPriceMicroCcd: price.toString(),
      surplusMicroCcd: (bid - reserveAmount).toString(),
      buyerFeeMicroCcd: amount(winner.buyer_fee).toString(),
      buyerRefundMicroCcd: amount(winner.buyer_refund).toString(),
    }
  })
  const winnerCount = BigInt(winnerDetails.length)
  const totalWinningBid = winnerDetails.reduce((total, winner) => total + BigInt(winner.bidMicroCcd), 0n)
  const totalClearingPrice = winnerDetails.reduce((total, winner) => total + BigInt(winner.clearingPriceMicroCcd), 0n)
  const totalSurplus = winnerDetails.reduce((total, winner) => total + BigInt(winner.surplusMicroCcd), 0n)
  const winnerRefund = winnerDetails.reduce((total, winner) => total + BigInt(winner.buyerRefundMicroCcd), 0n)
  const chainServiceId = serviceId(view.state.config?.service_id)
  const matchingSpec = serviceSpec?.hash === chainServiceId
  const instance = address(initialization)

  if (outcome === 'NoSale') {
    return {
      version: 2,
      outcome: 'no_sale',
      settledAt: transaction.confirmedAt ?? new Date().toISOString(),
      instance,
      contractUrl: initialization.contractUrl ?? `https://ccdexplorer.io/testnet/contract/${instance.index}/${instance.subindex}`,
      transaction: { hash: String(transaction.hash).toLowerCase(), explorerUrl: transaction.explorerUrl },
      service: {
        id: chainServiceId,
        name: matchingSpec ? serviceSpec.spec.serviceName : '已绑定的历史规格',
        capacityUnits: matchingSpec ? serviceSpec.spec.capacityUnits : null,
        matchesCurrentSpec: matchingSpec,
      },
      seller: String(view.state.seller ?? initialization.sender ?? ''),
      allocatedUnits: 0,
      winners: [],
      reserveMicroCcd: reserveAmount.toString(),
      averageWinningBidMicroCcd: '0',
      averageClearingPriceMicroCcd: '0',
      totalClearingPriceMicroCcd: '0',
      totalSurplusMicroCcd: '0',
      winningBidMicroCcd: '0',
      clearingPriceMicroCcd: '0',
      surplusMicroCcd: '0',
      platformFeeMicroCcd: platformFee.toString(),
      buyerRefundMicroCcd: '0',
      totalRefundMicroCcd: refunds.toString(),
      sellerReceivesMicroCcd: sellerReceives.toString(),
      totalDepositedMicroCcd: totalDeposited.toString(),
      reconciled: sellerReceives >= 0n && sellerReceives + refunds + platformFee === totalDeposited,
    }
  }
  if (winners.length === 0) throw new Error('已结算实例缺少赢家。')

  return {
    version: 2,
    outcome: 'settled',
    settledAt: transaction.confirmedAt ?? new Date().toISOString(),
    instance,
    contractUrl: initialization.contractUrl ?? `https://ccdexplorer.io/testnet/contract/${instance.index}/${instance.subindex}`,
    transaction: {
      hash: String(transaction.hash).toLowerCase(),
      explorerUrl: transaction.explorerUrl,
    },
    service: {
      id: chainServiceId,
      name: matchingSpec ? serviceSpec.spec.serviceName : '已绑定的历史规格',
      capacityUnits: matchingSpec ? serviceSpec.spec.capacityUnits : null,
      matchesCurrentSpec: matchingSpec,
    },
    seller: String(view.state.seller ?? initialization.sender ?? ''),
    allocatedUnits: winnerDetails.length,
    winners: winnerDetails,
    reserveMicroCcd: reserveAmount.toString(),
    averageWinningBidMicroCcd: (totalWinningBid / winnerCount).toString(),
    averageClearingPriceMicroCcd: (totalClearingPrice / winnerCount).toString(),
    totalClearingPriceMicroCcd: totalClearingPrice.toString(),
    totalSurplusMicroCcd: totalSurplus.toString(),
    // Compatibility aliases for existing price-signal rendering. They are
    // explicitly per-unit averages, not a single buyer's settlement amount.
    winningBidMicroCcd: (totalWinningBid / winnerCount).toString(),
    clearingPriceMicroCcd: (totalClearingPrice / winnerCount).toString(),
    surplusMicroCcd: totalSurplus.toString(),
    platformFeeMicroCcd: platformFee.toString(),
    buyerRefundMicroCcd: winnerRefund.toString(),
    totalRefundMicroCcd: refunds.toString(),
    sellerReceivesMicroCcd: sellerReceives.toString(),
    totalDepositedMicroCcd: totalDeposited.toString(),
    reconciled: sellerReceives >= 0n && sellerReceives + refunds + platformFee === totalDeposited,
  }
}

export function isConfirmedSettlement(value) {
  return Boolean(
    value && [1, 2].includes(value.version) && value.instance?.index !== undefined &&
    typeof value.transaction?.hash === 'string' && /^[0-9a-f]{64}$/i.test(value.transaction.hash) &&
    typeof value.transaction?.explorerUrl === 'string' &&
    (value.outcome === undefined || value.outcome === 'settled' || value.outcome === 'no_sale') &&
    typeof value.clearingPriceMicroCcd === 'string' && typeof value.surplusMicroCcd === 'string' &&
    typeof value.reconciled === 'boolean',
  )
}
