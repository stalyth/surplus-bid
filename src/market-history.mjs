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
 * Amounts stay as decimal microCCD strings: UI formatting must never use floats.
 */
export function createConfirmedSettlement({ initialization, view, transaction, serviceSpec = null }) {
  if (variant(view?.state?.phase) !== 'Settled') throw new Error('只有已结算实例可以写入成交记录。')
  if (!transaction?.hash || !transaction?.explorerUrl) throw new Error('成交记录缺少最终结算交易。')

  const allocations = Array.isArray(view.state.allocations) ? view.state.allocations : []
  const winner = allocations.find((entry) => entry.won === true)
  const reserve = optional(view.state.reserve)
  if (!winner || reserve === null) throw new Error('已结算实例缺少赢家或卖家底价。')

  const totalDeposited = amount(view.state.total_deposited)
  const refunds = allocations.reduce((total, entry) => total + amount(entry.buyer_refund), 0n)
  const platformFee = allocations.reduce((total, entry) => total + amount(entry.platform_receives), 0n)
  const sellerReceives = totalDeposited - refunds - platformFee
  const winningBid = amount(winner.bid)
  const reserveAmount = amount(reserve)
  const chainServiceId = serviceId(view.state.config?.service_id)
  const matchingSpec = serviceSpec?.hash === chainServiceId
  const instance = address(initialization)

  return {
    version: 1,
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
    winner: String(winner.bidder),
    reserveMicroCcd: reserveAmount.toString(),
    winningBidMicroCcd: winningBid.toString(),
    clearingPriceMicroCcd: amount(winner.price).toString(),
    surplusMicroCcd: (winningBid - reserveAmount).toString(),
    platformFeeMicroCcd: platformFee.toString(),
    buyerRefundMicroCcd: amount(winner.buyer_refund).toString(),
    totalRefundMicroCcd: refunds.toString(),
    sellerReceivesMicroCcd: sellerReceives.toString(),
    totalDepositedMicroCcd: totalDeposited.toString(),
    reconciled: sellerReceives >= 0n && sellerReceives + refunds + platformFee === totalDeposited,
  }
}

export function isConfirmedSettlement(value) {
  return Boolean(
    value && value.version === 1 && value.instance?.index !== undefined &&
    typeof value.transaction?.hash === 'string' && /^[0-9a-f]{64}$/i.test(value.transaction.hash) &&
    typeof value.transaction?.explorerUrl === 'string' &&
    typeof value.clearingPriceMicroCcd === 'string' && typeof value.surplusMicroCcd === 'string' &&
    typeof value.reconciled === 'boolean',
  )
}
