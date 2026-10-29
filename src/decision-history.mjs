import { isConfirmedSettlement } from './market-history.mjs'

function winningBids(record) {
  if (Array.isArray(record.winners) && record.winners.length > 0) {
    return record.winners.map((winner) => String(winner.bidMicroCcd))
  }
  return typeof record.winningBidMicroCcd === 'string' ? [record.winningBidMicroCcd] : []
}

function supplyUnits(record) {
  const units = Number(record.service?.capacityUnits)
  if (!Number.isSafeInteger(units) || units < 1) {
    throw new Error(`实例 <${record.instance?.index ?? '?'},${record.instance?.subindex ?? '?'}> 缺少可信的容量单位数。`)
  }
  return units
}

function allocatedUnits(record, bids) {
  const units = record.allocatedUnits === undefined ? bids.length : Number(record.allocatedUnits)
  if (!Number.isSafeInteger(units) || units < 0) {
    throw new Error(`实例 <${record.instance?.index ?? '?'},${record.instance?.subindex ?? '?'}> 缺少可信的已分配容量数。`)
  }
  return units
}

/**
 * Turns locally persisted, Testnet-verified settlement facts into the small
 * economic dataset used by the Seller Agent. Transaction hashes deliberately
 * remain provenance only: the model receives no account addresses or hashes.
 */
export function buildTestnetDecisionHistory(records, { marketName, nextSupplyUnits }) {
  if (typeof marketName !== 'string' || marketName.length === 0) throw new Error('当前服务缺少市场名称，无法筛选历史成交。')
  if (!Number.isSafeInteger(nextSupplyUnits) || nextSupplyUnits < 1) throw new Error('下一窗口容量必须是正整数。')

  const confirmed = (Array.isArray(records) ? records : [])
    .filter((record) => isConfirmedSettlement(record) && record.reconciled === true && record.service?.name === marketName)
    .sort((left, right) => Date.parse(left.settledAt) - Date.parse(right.settledAt))

  if (confirmed.length < 3) {
    throw new Error(`当前市场仅有 ${confirmed.length} 笔本地已核验的 Testnet 成交；Seller Agent 至少需要 3 笔，未调用模型。`)
  }

  const rounds = confirmed.map((record) => {
    const noSale = record.outcome === 'no_sale'
    const bids = noSale ? [] : winningBids(record)
    const allocated = allocatedUnits(record, bids)
    const supply = supplyUnits(record)
    if (allocated > supply) throw new Error(`实例 <${record.instance.index},${record.instance.subindex}> 的已分配容量超过可售容量。`)
    if (noSale !== (allocated === 0)) throw new Error(`实例 <${record.instance.index},${record.instance.subindex}> 的成交结果与已分配容量不一致。`)
    if (!noSale && bids.length === 0) throw new Error(`实例 <${record.instance.index},${record.instance.subindex}> 缺少赢家报价，不能作为策略输入。`)
    return {
      // This is a local opaque label, not a transaction hash or account.
      id: `testnet-${record.instance.index}-${record.instance.subindex}`,
      confirmed: true,
      outcome: noSale ? 'no_sale' : 'settled',
      reserveMicroCcd: String(record.reserveMicroCcd),
      winningBidsMicroCcd: bids,
      // Older settlement snapshots did not retain the total bid count. Do not
      // invent it: the decision layer knows this metric is unavailable.
      bidderCount: null,
      supplyUnits: supply,
      allocatedUnits: allocated,
    }
  })
  const latest = rounds.at(-1)
  const protocolVersions = [...new Set(confirmed.map((record) => `v${record.version}`))]

  return {
    input: {
      dataLabel: 'testnet',
      currentReserveMicroCcd: latest.reserveMicroCcd,
      previousSupplyUnits: latest.supplyUnits,
      nextSupplyUnits,
      rounds,
      contextNote: `本地保存的 ${confirmed.length} 笔已核验 Concordium Testnet 成交；当前容量由 ${latest.supplyUnits} 调整为 ${nextSupplyUnits}。历史快照未保存总参与买家数，因此该指标不可用。交易哈希和账户地址仅用于页面证据，不发送给模型。`,
    },
    provenance: {
      source: 'local-verified-testnet-settlements',
      marketName,
      recordCount: confirmed.length,
      latestSettledAt: confirmed.at(-1).settledAt,
      protocolVersions,
      hashesSentToModel: false,
    },
  }
}
