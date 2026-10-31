import { formatCcd } from '../src/rules.mjs'
import { createConfirmedSettlement } from '../src/market-history.mjs'
import {
  ConcordiumClientError,
  connectConcordiumWallet,
  downloadReserveRevealBackup,
  deriveAuctionRole,
  getTransactionSender,
  hasRevealedBid,
  loadReserveRevealBackup,
  loadBidRevealBackup,
  parseCcdToMicroCcd,
  prepareStartRound,
  prepareBidCommitment,
  START_ROUND_RULES,
  saveReserveRevealBackup,
  saveBidRevealBackup,
  selectWalletAccount,
  shortAccountAddress,
  submitMarketInitialization,
  submitModuleDeployment,
  submitCancelRound,
  submitBidCommitment,
  submitBidReveal,
  submitFinalizeRound,
  submitReserveReveal,
  submitStartRound,
} from '../src/concordium.mjs'

const publicAssetUrl = (path) => new URL(`../${path.replace(/^\//, '')}`, import.meta.url)

const runtime = await loadRuntimeConfig()
let activity = []
let walletConnection = null
let observedWalletProvider = null
let judgeJourney = null
let confirmedSettlements = []
let publishedSettlements = []
let serviceSpec = null
let serviceSpecError = null
let testnet = { status: null, deployment: null, initialization: null, round: null, view: null, startPlan: null, bidPlan: null, sellerDecision: null, sellerHistory: null, sellerReserveMicroCcd: null, transactions: [], pending: null, busy: false, agentBusy: false, winnerVerification: null }

const elements = {
  auctionPhase: byId('auction-phase'),
  auctionId: byId('auction-id'),
  auctionDeadline: byId('auction-deadline'),
  serviceSpecName: document.querySelector('[data-service-name]'),
  serviceSpecCapacity: byId('service-spec-capacity'),
  serviceSpecDelivery: byId('service-spec-delivery'),
  serviceSpecHash: byId('service-spec-hash'),
  serviceBindingStatus: byId('service-binding-status'),
  walletButton: byId('wallet-button'),
  walletStatus: byId('wallet-status'),
  walletAccountControl: byId('wallet-account-control'),
  walletAccountSelect: byId('wallet-account-select'),
  walletAccountNotice: byId('wallet-account-notice'),
  sellerDecisionButton: byId('seller-decision-button'),
  sellerReserveControl: byId('seller-reserve-control'),
  sellerReserveInput: byId('seller-reserve-input'),
  sellerDecisionStatus: byId('seller-decision-status'),
  sellerAgentCard: byId('seller-agent-card'),
  sellerAgentLocked: byId('seller-agent-locked'),
  deployModuleButton: byId('deploy-module-button'),
  initContractButton: byId('init-contract-button'),
  readViewButton: byId('read-view-button'),
  startRoundButton: byId('start-round-button'),
  cancelRoundButton: byId('cancel-round-button'),
  backupReserveButton: byId('backup-reserve-button'),
  bidAmountInput: byId('bid-amount-input'),
  commitBidButton: byId('commit-bid-button'),
  revealReserveButton: byId('reveal-reserve-button'),
  revealBidButton: byId('reveal-bid-button'),
  finalizeChainButton: byId('finalize-chain-button'),
  roleSummary: byId('role-summary'),
  roleLabel: byId('role-label'),
  roleStage: byId('role-stage'),
  roleGuidance: byId('role-guidance'),
  roundProgress: byId('round-progress'),
  roundProgressStatus: byId('round-progress-status'),
  progressInstanceDetail: byId('progress-instance-detail'),
  progressCommitDetail: byId('progress-commit-detail'),
  progressRevealDetail: byId('progress-reveal-detail'),
  progressSettlementDetail: byId('progress-settlement-detail'),
  sellerSettlementSummary: byId('seller-settlement-summary'),
  sellerSettlementExplorer: byId('seller-settlement-explorer'),
  sellerSettlementPrice: byId('seller-settlement-price'),
  sellerSettlementProceeds: byId('seller-settlement-proceeds'),
  sellerSettlementBalance: byId('seller-settlement-balance'),
  sellerPublishActions: byId('seller-publish-actions'),
  buyerCommitShell: byId('buyer-commit-shell'),
  sellerRevealShell: byId('seller-reveal-shell'),
  buyerRevealShell: byId('buyer-reveal-shell'),
  finalizeShell: byId('finalize-shell'),
  testnetStatus: byId('testnet-status'),
  marketHistoryBadge: byId('market-history-badge'),
  marketHistorySummary: byId('market-history-summary'),
  marketHistoryList: byId('market-history-list'),
  marketSignalBadge: byId('market-signal-badge'),
  marketSignalMetrics: byId('market-signal-metrics'),
  marketSignalReading: byId('market-signal-reading'),
  marketSignalChart: byId('market-signal-chart'),
  evidenceSummary: byId('evidence-summary'),
  evidenceList: byId('evidence-list'),
  evidenceBadge: byId('evidence-badge'),
  settlementBreakdown: byId('settlement-breakdown'),
  settlementBreakdownList: byId('settlement-breakdown-list'),
  winnerVerification: byId('winner-verification'),
  verifyWinnerButton: byId('verify-winner-button'),
  winnerVerificationStatus: byId('winner-verification-status'),
  runtimeModeBadge: byId('runtime-mode-badge'),
  judgeJourneyBadge: byId('judge-journey-badge'),
  judgeJourneySummary: byId('judge-journey-summary'),
  judgeDecisionEvidence: byId('judge-decision-evidence'),
  judgeJourneySteps: byId('judge-journey-steps'),
  judgeJourneyResult: byId('judge-journey-result'),
}

elements.sellerDecisionButton.addEventListener('click', async () => {
  if (!runtime.agentApi || testnet.agentBusy) return
  testnet.agentBusy = true
  testnet.sellerDecision = null
  testnet.sellerReserveMicroCcd = null
  elements.sellerDecisionStatus.textContent = '正在调用 Seller Agent，并等待代码裁决…'
  elements.sellerDecisionStatus.dataset.tone = 'neutral'
  render()
  try {
    const payload = await requestJson('/api/agent/decide', {
      method: 'POST',
      body: { taskId: `seller-next-round-${Date.now()}` },
      timeoutMs: 20_000,
      timeoutMessage: 'Seller Agent 请求超时；没有生成可进入钱包流程的底价建议。',
    })
    testnet.sellerDecision = payload.decision
    testnet.sellerHistory = payload.history
    const decision = payload.decision
    testnet.sellerReserveMicroCcd = decision.final.reserveMicroCcd
    const reserve = formatMicroCcd(decision.final.reserveMicroCcd)
    const override = decision.ruleOverride
      ? `；代码覆盖：${decision.ruleOverride.map((item) => item.code).join(', ')}`
      : '；代码未覆盖模型提议'
    elements.sellerDecisionStatus.textContent = [
      `数据：本地已核验 Testnet 历史 ${payload.history.recordCount} 笔；模型：${decision.model}；prompt：${decision.promptVersion}`,
      `模型判断：${decision.proposed.marketSignal}；最终动作：${decision.final.action}；最终底价：${reserve} CCD${override}`,
      decision.proposed.reason,
    ].join('\n')
    elements.sellerDecisionStatus.dataset.tone = decision.final.action === 'needs_human' ? 'error' : 'success'
    record(`Seller Agent 建议经代码裁决：${decision.final.action}，下一轮底价 ${reserve} CCD。`, decision.final.action === 'needs_human' ? 'rejected' : 'agent')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    elements.sellerDecisionStatus.textContent = `Seller Agent 未完成：${message}`
    elements.sellerDecisionStatus.dataset.tone = 'error'
    record(`Seller Agent 未完成：${message}`, 'rejected')
  } finally {
    testnet.agentBusy = false
    render()
  }
})

elements.sellerReserveInput.addEventListener('input', () => {
  if (!testnet.sellerDecision) return
  try {
    testnet.sellerReserveMicroCcd = parseCcdToMicroCcd(elements.sellerReserveInput.value).toString()
  } catch {
    testnet.sellerReserveMicroCcd = null
  }
  render()
})

elements.walletButton.addEventListener('click', async () => {
  if (!runtime.walletActions) return
  elements.walletButton.disabled = true
  elements.walletButton.textContent = '等待钱包…'
  try {
    walletConnection = await connectConcordiumWallet()
    observeWalletAccountChanges(walletConnection.provider)
    const account = walletConnection.accounts[0]
    populateWalletAccounts()
    testnet.bidPlan = testnet.initialization ? loadBidRevealBackup(testnet.initialization, account) : null
    record(`本站已授权 ${walletConnection.authorizedAccounts.length} 个 Testnet 账户；当前交易账户 ${shortAccountAddress(account)}。`)
    await refreshTestnetStatus()
    setMessage(`本站交易账户：${shortAccountAddress(account)}。如与钱包首页不同，请从顶部列表明确选择；缺少账户则先在钱包中授权本站。`, 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const tone = error instanceof ConcordiumClientError ? 'warning' : 'error'
    setMessage(message, tone)
    record(`钱包连接未完成：${message}`, 'rejected')
  } finally {
    render()
  }
})

elements.walletAccountSelect.addEventListener('change', () => {
  if (!walletConnection || testnet.busy) return
  try {
    const account = selectWalletAccount(walletConnection, elements.walletAccountSelect.value)
    testnet.bidPlan = testnet.initialization ? loadBidRevealBackup(testnet.initialization, account) : null
    record(`本站交易账户已明确选择为 ${shortAccountAddress(account)}；本次未发送交易。`)
    setMessage(`交易前会核对 ${shortAccountAddress(account)} 仍获本站授权；请在钱包确认页再次核对签名地址。`, 'success')
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), 'warning')
  }
  render()
})

function populateWalletAccounts() {
  elements.walletAccountSelect.replaceChildren()
  for (const account of walletConnection?.authorizedAccounts ?? []) {
    const option = document.createElement('option')
    option.value = account
    option.textContent = shortAccountAddress(account)
    option.title = account
    elements.walletAccountSelect.append(option)
  }
  if (walletConnection) elements.walletAccountSelect.value = walletConnection.accounts[0]
}

function transactionConnection() {
  if (!walletConnection) throw new ConcordiumClientError('WALLET_NOT_CONNECTED', '请先连接钱包并选择本站交易账户。')
  return {
    ...walletConnection,
    accounts: [...walletConnection.accounts],
    authorizedAccounts: [...walletConnection.authorizedAccounts],
  }
}

function observeWalletAccountChanges(provider) {
  if (observedWalletProvider === provider || typeof provider?.on !== 'function') return
  observedWalletProvider = provider
  provider.on('accountChanged', (account) => {
    if (typeof account !== 'string' || account.length === 0 || !walletConnection) return
    if (walletConnection.accounts[0] === account) return
    if (!walletConnection.authorizedAccounts.includes(account)) walletConnection.authorizedAccounts.push(account)
    walletConnection.accounts = [account]
    populateWalletAccounts()
    testnet.bidPlan = testnet.initialization ? loadBidRevealBackup(testnet.initialization, account) : null
    record(`钱包当前账户已切换为 ${shortAccountAddress(account)}；本次未发送交易。`)
    setMessage(`已同步钱包当前账户：${shortAccountAddress(account)}。`, 'success')
    render()
  })
  provider.on('accountDisconnected', () => {
    walletConnection = null
    populateWalletAccounts()
    testnet.bidPlan = null
    record('钱包当前账户已断开；已返回哈希的交易仍会继续通过公共节点核验。', 'rejected')
    setMessage('钱包当前账户已断开。若交易已返回哈希，页面会继续只读核验；请勿重发。', 'warning')
    render()
  })
}

elements.deployModuleButton.addEventListener('click', () => {
  runTestnetAction('deploy', async () => {
    const connection = transactionConnection()
    const hash = await submitModuleDeployment(connection)
    const sender = getTransactionSender(connection)
    testnet.pending = { kind: 'deploy', hash, sender }
    setTestnetStatus(`钱包已返回部署交易哈希：${hash}\n正在等待 Testnet 最终确认。`, 'success')
    const verified = await waitForFinalization('/api/testnet/verify-deployment', hash, { sender })
    testnet.deployment = verified.deployment
    testnet.pending = null
    record(`当前 surplus_bid Wasm 已在 Testnet 部署：${shortHash(hash)}。`, 'chain')
    setTestnetStatus(`模块部署已最终确认。\nmodule ref: ${verified.deployment.moduleReference}\n${verified.deployment.explorerUrl}`, 'success')
  })
})

elements.initContractButton.addEventListener('click', () => {
  runTestnetAction('init', async () => {
    const connection = transactionConnection()
    if (!serviceSpec?.hash) throw new ConcordiumClientError('SERVICE_SPEC_UNAVAILABLE', '容量规格尚未加载或摘要校验失败；未请求钱包创建实例。')
    const hash = await submitMarketInitialization(connection, testnet.status.moduleReference, serviceSpec.hash)
    const sender = getTransactionSender(connection)
    testnet.pending = { kind: 'init', hash, sender }
    setTestnetStatus(`钱包已返回初始化交易哈希：${hash}\n交易创建的是 0 CCD 空实例，正在等待最终确认。`, 'success')
    const verified = await waitForFinalization('/api/testnet/verify-init', hash, { sender })
    testnet.initialization = verified.initialization
    testnet.round = null
    testnet.view = verified.view
    testnet.startPlan = null
    testnet.bidPlan = null
    testnet.sellerDecision = null
    testnet.sellerHistory = null
    testnet.sellerReserveMicroCcd = null
    testnet.winnerVerification = null
    testnet.transactions = []
    trackVerifiedTransaction('创建容量窗口', verified.initialization)
    testnet.pending = null
    record(`Testnet 新实例 <${verified.initialization.address.index},${verified.initialization.address.subindex}> 已创建，并读回 view。`, 'chain')
    setTestnetStatus(formatInitializedStatus(verified.initialization, verified.view), 'success')
  })
})

elements.verifyWinnerButton.addEventListener('click', async () => {
  if (!walletConnection || testnet.busy || !testnet.initialization) return
  testnet.busy = true
  testnet.winnerVerification = null
  elements.winnerVerificationStatus.textContent = '正在读取 Testnet view 并核对链上赢家…'
  elements.winnerVerificationStatus.dataset.tone = 'neutral'
  render()
  try {
    const account = getTransactionSender(transactionConnection())
    const result = await requestJson('/api/testnet/verify-winner', {
      method: 'POST',
      body: { account },
    })
    testnet.winnerVerification = result
    elements.winnerVerificationStatus.textContent = result.eligible
      ? `核验通过：${shortAccountAddress(result.account)} 属于链上赢家。`
      : `核验未通过：${result.reason}${result.winners?.length ? ` 链上赢家为 ${result.winners.map(shortAccountAddress).join('、')}。` : ''}`
    elements.winnerVerificationStatus.dataset.tone = result.eligible ? 'success' : 'error'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    elements.winnerVerificationStatus.textContent = `赢家核验未完成：${message}`
    elements.winnerVerificationStatus.dataset.tone = 'error'
  } finally {
    testnet.busy = false
    render()
  }
})

elements.commitBidButton.addEventListener('click', () => {
  runTestnetAction('commit_bid', async () => {
    const connection = transactionConnection()
    const amountMicroCcd = parseCcdToMicroCcd(elements.bidAmountInput.value)
    const plan = await prepareBidCommitment(connection, testnet.initialization, amountMicroCcd)
    saveBidRevealBackup(plan)
    testnet.bidPlan = plan
    const hash = await submitBidCommitment(connection, testnet.initialization, plan)
    const sender = getTransactionSender(connection)
    testnet.pending = { kind: 'commit_bid', hash, sender }
    setTestnetStatus(`钱包已返回隐藏报价承诺交易哈希：${hash}\n本次先锁定 2 CCD 保证金；报价金额会在揭示期前保持隐藏。`, 'success')
    const verified = await waitForContractUpdate(hash, 'surplus_bid.commit_bid', '2000000', {
      sender,
      bidder: plan.bidder,
      commitment: plan.commitment,
    })
    testnet.view = verified.view
    testnet.round = verified.round
    testnet.pending = null
    trackVerifiedTransaction('买家提交隐藏承诺', verified)
    record(`买家 ${shortAccountAddress(plan.bidder)} 已提交隐藏报价承诺：${shortHash(hash)}。`, 'chain')
    setTestnetStatus(formatLiveState(verified.view, verified.explorerUrl), 'success')
  })
})

elements.revealReserveButton.addEventListener('click', () => {
  runTestnetAction('reveal_reserve', async () => {
    const connection = transactionConnection()
    const plan = testnet.startPlan ?? loadReserveRevealBackup(testnet.initialization)
    const hash = await submitReserveReveal(connection, testnet.initialization, plan)
    const sender = getTransactionSender(connection)
    testnet.pending = { kind: 'reveal_reserve', hash, sender }
    const verified = await waitForContractUpdate(hash, 'surplus_bid.reveal_reserve', '0', { sender, reserveMicroCcd: plan.reserveMicroCcd })
    testnet.view = verified.view; testnet.round = verified.round; testnet.pending = null
    trackVerifiedTransaction('卖家揭示底价', verified)
    record(`卖家已揭示底价：${shortHash(hash)}。`, 'chain')
    setTestnetStatus(formatLiveState(verified.view, verified.explorerUrl), 'success')
  })
})

elements.revealBidButton.addEventListener('click', () => {
  runTestnetAction('reveal_bid', async () => {
    const connection = transactionConnection()
    const plan = testnet.bidPlan ?? loadBidRevealBackup(testnet.initialization, connection.accounts[0])
    const hash = await submitBidReveal(connection, testnet.initialization, plan)
    const sender = getTransactionSender(connection)
    testnet.pending = { kind: 'reveal_bid', hash, sender }
    const topUp = (BigInt(plan.amountMicroCcd) - BigInt(START_ROUND_RULES.guaranteeCcd) * 1_000_000n).toString()
    const verified = await waitForContractUpdate(hash, 'surplus_bid.reveal_bid', topUp, {
      sender,
      bidder: plan.bidder,
      bidMicroCcd: plan.amountMicroCcd,
    })
    testnet.view = verified.view; testnet.round = verified.round; testnet.pending = null
    trackVerifiedTransaction('买家揭示报价', verified)
    record(`买家已揭示报价：${shortHash(hash)}。`, 'chain')
    setTestnetStatus(formatLiveState(verified.view, verified.explorerUrl), 'success')
  })
})

elements.finalizeChainButton.addEventListener('click', () => {
  runTestnetAction('finalize', async () => {
    const connection = transactionConnection()
    const hash = await submitFinalizeRound(connection, testnet.initialization)
    const sender = getTransactionSender(connection)
    testnet.pending = { kind: 'finalize', hash, sender }
    const verified = await waitForContractUpdate(hash, 'surplus_bid.finalize', '0', { sender, requireSettlement: true })
    testnet.view = verified.view; testnet.round = verified.round; testnet.pending = null
    trackVerifiedTransaction('链上结算', verified)
    record(`链上结算已最终确认：${shortHash(hash)}。`, 'chain')
    await loadLocalSessionHistory()
    setTestnetStatus(formatLiveState(verified.view, verified.explorerUrl), 'success')
  })
})

elements.readViewButton.addEventListener('click', () => {
  runTestnetAction('view', async () => {
    const result = await requestJson('/api/testnet/view')
    testnet.view = result
    setTestnetStatus(formatInitializedStatus(testnet.initialization, result), 'success')
    record(`从 Testnet 读回实例 <${testnet.initialization.address.index},${testnet.initialization.address.subindex}> 的 view 状态。`, 'chain')
  })
})

elements.startRoundButton.addEventListener('click', () => {
  runTestnetAction('start_round', async () => {
    const connection = transactionConnection()
    const decision = testnet.sellerDecision
    if (!decision) throw new ConcordiumClientError('SELLER_DECISION_REQUIRED', '请先获取 Seller Agent 底价建议。')
    const selectedReserveMicroCcd = parseCcdToMicroCcd(elements.sellerReserveInput.value)
    const plan = await prepareStartRound(connection, testnet.initialization, {
      reserveMicroCcd: selectedReserveMicroCcd,
    })
    saveReserveRevealBackup(plan)
    testnet.startPlan = plan
    setTestnetStatus(
      `本轮底价为 ${formatMicroCcd(plan.reserveMicroCcd)} CCD（${plan.reserveMicroCcd === decision.final.reserveMicroCcd ? '采用 Seller Agent 建议' : '卖家手动调整'}）；已生成底价承诺，并将揭示所需的 32 字节盐保存在当前浏览器。\n接下来钱包将请求调用 start_round：锁定 2 CCD 测试保证金；承诺期 ${START_ROUND_RULES.commitDurationMs / 60_000} 分钟，卖家与买家共享 ${START_ROUND_RULES.revealDurationMs / 60_000} 分钟揭示期。`,
      'success',
    )
    const hash = await submitStartRound(connection, testnet.initialization, plan)
    const sender = getTransactionSender(connection)
    testnet.pending = { kind: 'start_round', hash, sender }
    setTestnetStatus(`钱包已返回 start_round 交易哈希：${hash}\n正在等待 Testnet 最终确认。`, 'success')
    const verified = await waitForFinalization('/api/testnet/verify-start-round', hash, { sender, plan: publicRoundPlan(plan) })
    testnet.round = verified.round
    testnet.view = verified.view
    testnet.pending = null
    trackVerifiedTransaction('开始隐藏报价轮次', verified)
    record(`Testnet 轮次已开始：${shortHash(hash)}；合约中锁定 2 CCD 卖家保证金。`, 'chain')
    setTestnetStatus(formatRoundStatus(verified.round, verified.view), 'success')
  })
})

elements.cancelRoundButton.addEventListener('click', () => {
  runTestnetAction('cancel', async () => {
    const connection = transactionConnection()
    const hash = await submitCancelRound(connection, testnet.initialization)
    const sender = getTransactionSender(connection)
    testnet.pending = { kind: 'cancel', hash, sender }
    setTestnetStatus(`钱包已返回 cancel 交易哈希：${hash}\n正在等待 Testnet 最终确认并核对 2 CCD 退款。`, 'success')
    const verified = await waitForFinalization('/api/testnet/verify-cancel-round', hash, { sender })
    testnet.round = verified.round
    testnet.pending = null
    trackVerifiedTransaction('取消并退款', verified)
    record(`过期空轮次已取消：${shortHash(hash)}；2 CCD 已退回实例卖家。`, 'chain')
    setTestnetStatus(`空轮次已取消，合约余额为 ${verified.view.contractBalance} CCD。\n${verified.round.explorerUrl}`, 'success')
  })
})

elements.backupReserveButton.addEventListener('click', () => {
  try {
    if (!testnet.startPlan) throw new ConcordiumClientError('ROUND_PLAN_UNAVAILABLE', '请先发布当前容量窗口，才能下载底价揭示备份。')
    downloadReserveRevealBackup(testnet.startPlan)
    setTestnetStatus('底价揭示备份已下载；请妥善保存且不要公开盐值。下载不会发送链上交易。', 'success')
  } catch (error) {
    setTestnetStatus(error instanceof Error ? error.message : String(error), 'error')
  }
  render()
})

async function runTestnetAction(kind, action) {
  if (!walletConnection || testnet.busy) return
  testnet.busy = true
  render()
  try {
    await action()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    testnet.pending = null
    setTestnetStatus(`${kind} 未完成：${message}`, error instanceof ConcordiumClientError ? 'error' : 'error')
    record(`Testnet ${kind} 未完成：${message}`, 'rejected')
  } finally {
    testnet.busy = false
    render()
  }
}

function render() {
  renderServiceSpec()
  const livePhase = phaseName(testnet.view?.state?.phase)
  const liveWindow = testnet.initialization?.address

  const activeRound = testnet.round !== null && !['NoSale', 'Settled', 'Cancelled'].includes(livePhase)
  elements.sellerDecisionButton.disabled = !runtime.agentApi || testnet.agentBusy || activeRound
  elements.sellerDecisionButton.textContent = !runtime.agentApi
    ? '真实评测结果已记录'
    : testnet.agentBusy ? 'Seller Agent 正在分析…' : testnet.sellerDecision ? '重新获取底价建议' : '获取底价建议'
  const hasSellerReserve = testnet.sellerDecision !== null
  elements.sellerReserveControl.hidden = !hasSellerReserve
  elements.sellerReserveInput.disabled = testnet.agentBusy || activeRound || testnet.busy
  if (hasSellerReserve && document.activeElement !== elements.sellerReserveInput) {
    elements.sellerReserveInput.value = testnet.sellerReserveMicroCcd === null
      ? ''
      : formatMicroCcd(testnet.sellerReserveMicroCcd)
  }
  elements.auctionPhase.textContent = livePhase ? phaseLabel(livePhase) : '等待发布'
  elements.auctionId.textContent = liveWindow
    ? `<${liveWindow.index},${liveWindow.subindex}>`
    : '等待卖家发布'
  elements.auctionDeadline.textContent = testnet.round?.commitEnd
    ? formatDate(testnet.round.commitEnd)
    : '发布后显示'
  if (!runtime.walletActions) {
    elements.walletButton.disabled = true
    elements.walletButton.textContent = '公开只读'
    elements.walletStatus.textContent = '公开只读模式'
    elements.walletAccountControl.hidden = true
    elements.walletAccountNotice.hidden = true
  } else if (walletConnection) {
    elements.walletButton.disabled = false
    elements.walletButton.textContent = '刷新授权账户'
    elements.walletStatus.textContent = `本站交易账户 · ${shortAccountAddress(walletConnection.accounts[0])}`
    elements.walletAccountControl.hidden = false
    elements.walletAccountSelect.disabled = testnet.busy || testnet.pending !== null
    elements.walletAccountSelect.value = walletConnection.accounts[0]
    elements.walletAccountNotice.hidden = false
    elements.walletAccountNotice.textContent = walletConnection.authorizedAccounts.length === 1
      ? `钱包仅向本站返回 ${shortAccountAddress(walletConnection.accounts[0])}。若钱包首页显示另一个账户，请先在钱包中允许该账户连接本地站点，再点“刷新授权账户”。`
      : `本站已获授权 ${walletConnection.authorizedAccounts.length} 个账户。请在右上角明确选择交易账户，并在钱包交易确认页复核地址。`
  } else {
    elements.walletButton.disabled = false
    elements.walletButton.textContent = '连接钱包'
    elements.walletStatus.textContent = '未连接'
    elements.walletAccountControl.hidden = true
    elements.walletAccountNotice.hidden = true
  }
  renderTestnet()
  renderMarketHistory()
  renderMarketSignal()
  renderEvidencePanel()
  renderWinnerVerification()
  renderJudgeJourney()
}

function renderServiceSpec() {
  if (!serviceSpec) {
    elements.serviceSpecName.textContent = serviceSpecError ? '容量规格不可用' : '正在读取容量规格…'
    elements.serviceSpecCapacity.textContent = '—'
    elements.serviceSpecDelivery.textContent = '—'
    elements.serviceSpecHash.textContent = '—'
    elements.serviceBindingStatus.textContent = serviceSpecError ?? '正在计算 service-spec.json 的 SHA-256 摘要。'
    elements.serviceBindingStatus.dataset.tone = serviceSpecError ? 'error' : 'neutral'
    return
  }
  const { spec, hash } = serviceSpec
  elements.serviceSpecName.textContent = spec.serviceName
  elements.serviceSpecCapacity.textContent = `${spec.capacityUnits} 个容量单位`
  elements.serviceSpecDelivery.textContent = spec.delivery.mode
  elements.serviceSpecHash.textContent = `${hash.slice(0, 10)}…${hash.slice(-6)}`
  elements.serviceSpecHash.title = hash
  const chainServiceId = String(testnet.view?.state?.config?.service_id ?? '')
  if (!testnet.initialization) {
    elements.serviceBindingStatus.textContent = '创建新实例时会把此 SHA-256 摘要写入链上 service_id。'
    elements.serviceBindingStatus.dataset.tone = 'neutral'
  } else if (chainServiceId === hash) {
    elements.serviceBindingStatus.textContent = '已核对：链上 service_id 与这份规格摘要一致。'
    elements.serviceBindingStatus.dataset.tone = 'success'
  } else {
    elements.serviceBindingStatus.textContent = '不一致：当前实例并未绑定这份容量规格；不会用于赢家核验。'
    elements.serviceBindingStatus.dataset.tone = 'error'
  }
}

function serviceBindingMatches() {
  return Boolean(
    serviceSpec?.hash &&
    testnet.initialization &&
    String(testnet.view?.state?.config?.service_id ?? '') === serviceSpec.hash,
  )
}

function renderWinnerVerification() {
  const phase = phaseName(testnet.view?.state?.phase)
  const winners = chainWinners()
  const currentAccount = walletConnection?.accounts?.[0] ?? null
  const visible = runtime.walletActions && testnet.initialization && phase === 'Settled' && winners.includes(currentAccount)
  elements.winnerVerification.hidden = !visible
  if (!visible) return
  const bound = serviceBindingMatches()
  elements.verifyWinnerButton.disabled = !bound || testnet.busy
  if (!bound) {
    elements.winnerVerificationStatus.textContent = '当前实例的 service_id 与本地规格摘要不一致，拒绝进行赢家核验。'
    elements.winnerVerificationStatus.dataset.tone = 'error'
  } else if (!testnet.winnerVerification) {
    elements.winnerVerificationStatus.textContent = '此操作只读 Testnet，不发起钱包签名或 API 调用。'
    elements.winnerVerificationStatus.dataset.tone = 'neutral'
  }
}

function chainWinners() {
  return (testnet.view?.state?.allocations ?? [])
    .filter((entry) => entry.won === true && typeof entry.bidder === 'string' && entry.bidder.length > 0)
    .map((entry) => entry.bidder)
}

function renderSellerSettlementSummary() {
  const phase = phaseName(testnet.view?.state?.phase)
  const currentAccount = walletConnection?.accounts?.[0] ?? null
  const isSeller = currentAccount !== null && currentAccount === testnet.initialization?.sender
  const allocations = Array.isArray(testnet.view?.state?.allocations) ? testnet.view.state.allocations : []
  const winners = allocations.filter((entry) => entry.won === true)
  const visible = runtime.walletActions && phase === 'Settled' && isSeller && winners.length > 0
  elements.sellerSettlementSummary.hidden = !visible
  if (!visible) return

  const totalDeposited = BigInt(testnet.view?.state?.total_deposited ?? 0)
  const refunds = allocations.reduce((total, entry) => total + BigInt(entry.buyer_refund ?? 0), 0n)
  const platform = allocations.reduce((total, entry) => total + BigInt(entry.platform_receives ?? 0), 0n)
  const sellerReceives = totalDeposited - refunds - platform
  const totalPrice = winners.reduce((total, winner) => total + BigInt(winner.price ?? 0), 0n)
  elements.sellerSettlementPrice.textContent = `${formatMicroCcd(totalPrice / BigInt(winners.length))} CCD / 单位`
  elements.sellerSettlementProceeds.textContent = `${formatMicroCcd(sellerReceives)} CCD`
  elements.sellerSettlementBalance.textContent = `${formatMicroCcd(testnet.view?.contractBalanceMicroCcd ?? 0)} CCD`
  elements.sellerSettlementExplorer.href = testnet.initialization.contractUrl ?? `https://ccdexplorer.io/testnet/contract/${testnet.initialization.address.index}/${testnet.initialization.address.subindex}`
}

function renderRoundProgress() {
  const initialization = testnet.initialization
  const round = testnet.round
  const phase = phaseName(testnet.view?.state?.phase)
  const terminal = ['Settled', 'NoSale', 'Cancelled'].includes(phase)
  const now = Date.now()
  const commitWindowOpen = Boolean(round && phase === 'Commit' && now < Number(round.commitEnd))
  const revealWindowOpen = Boolean(round && ['Commit', 'Reveal'].includes(phase) && now >= Number(round.commitEnd) && now < Number(round.revealEnd))
  const closeWindowOpen = Boolean(round && !terminal && now >= Number(round.revealEnd))
  const statusByStep = new Map([
    ['instance', initialization ? 'complete' : 'active'],
    ['commit', !round ? 'pending' : commitWindowOpen ? 'active' : 'complete'],
    ['reveal', !round ? 'pending' : revealWindowOpen ? 'active' : terminal || closeWindowOpen ? 'complete' : 'pending'],
    ['settlement', terminal ? 'terminal' : closeWindowOpen ? 'active' : 'pending'],
  ])
  for (const step of elements.roundProgress.querySelectorAll('[data-progress-step]')) {
    step.dataset.state = statusByStep.get(step.dataset.progressStep) ?? 'pending'
  }

  elements.progressInstanceDetail.textContent = initialization
    ? `实例 <${initialization.address.index},${initialization.address.subindex}> 已确认`
    : '卖家创建 0 CCD 实例'
  elements.progressCommitDetail.textContent = round?.commitEnd
    ? `截止：${formatDate(round.commitEnd)}`
    : '发布轮次后写入链上'
  elements.progressRevealDetail.textContent = round?.revealEnd
    ? `截止：${formatDate(round.revealEnd)}`
    : '承诺期结束后开放'
  elements.progressSettlementDetail.textContent = phase === 'Settled'
    ? '已结算，合约余额应为 0 CCD'
    : phase === 'NoSale'
    ? '未成交，退款已处理'
    : phase === 'Cancelled'
    ? '已取消，退款已处理'
    : '揭示期结束后开放'
  elements.roundProgressStatus.textContent = terminal
    ? phaseLabel(phase)
    : closeWindowOpen
    ? '等待结算或超时处理'
    : revealWindowOpen
    ? '统一揭示期进行中'
    : commitWindowOpen
    ? '承诺期进行中'
    : initialization
    ? '等待卖家发布'
    : '等待实例'
}

function renderTestnet() {
  renderRoundProgress()
  if (!runtime.walletActions) {
    for (const button of [
      elements.deployModuleButton, elements.initContractButton, elements.readViewButton,
      elements.startRoundButton, elements.cancelRoundButton, elements.backupReserveButton,
      elements.commitBidButton, elements.revealReserveButton,
      elements.revealBidButton, elements.finalizeChainButton,
    ]) button.disabled = true
    elements.bidAmountInput.disabled = true
    elements.sellerAgentCard.hidden = true
    elements.sellerAgentLocked.hidden = true
    elements.sellerSettlementSummary.hidden = true
    elements.sellerPublishActions.hidden = true
    elements.buyerCommitShell.hidden = true
    elements.sellerRevealShell.hidden = true
    elements.buyerRevealShell.hidden = true
    elements.finalizeShell.hidden = true
    elements.roleLabel.textContent = '观察者'
    elements.roleStage.textContent = '公开只读'
    elements.roleGuidance.textContent = '公开页面只展示已记录的 Testnet 证据；钱包交易仅在本地完整模式开放。'
    elements.startRoundButton.textContent = '本地完整模式可发布容量窗口'
    elements.testnetStatus.textContent = '公开只读模式不会连接钱包或调用本地 API。下方真实 Testnet 记录可通过 CCDExplorer 独立核验。'
    return
  }
  const connected = walletConnection !== null
  const currentWalletAccount = walletConnection?.accounts?.[0] ?? null
  const hasStatus = testnet.status !== null
  const hasCurrentContractArtifact = testnet.status?.contractReady === true
  const hasDeployment = testnet.deployment !== null
  const hasInitialization = testnet.initialization !== null
  const hasRound = testnet.round !== null
  const isInstanceSeller = hasInitialization && currentWalletAccount === testnet.initialization.sender
  const phase = phaseName(testnet.view?.state?.phase)
  const serviceBound = serviceBindingMatches()
  const bidAddresses = new Set((testnet.view?.state?.bids ?? []).map((bid) => String(bid.bidder)))
  const selectedBidPlan = testnet.bidPlan ?? (hasInitialization && currentWalletAccount ? loadBidRevealBackup(testnet.initialization, currentWalletAccount) : null)
  const selectedBidAlreadyRevealed = hasRevealedBid(testnet.view, currentWalletAccount)
  const commitOpen = phase === 'Commit' && Date.now() < Number(testnet.round?.commitEnd)
  const revealEnd = Number(testnet.round?.revealEnd)
  const now = Date.now()
  const revealOpen = ['Commit', 'Reveal'].includes(phase) && now >= Number(testnet.round?.commitEnd) && now < revealEnd
  const reserveRevealed = optionValue(testnet.view?.state?.reserve) !== null
  const finalizeOpen = phase === 'Reveal' && reserveRevealed && now >= revealEnd
  const terminal = ['NoSale', 'Settled', 'Cancelled'].includes(phase)
  const bidCount = testnet.view?.state?.bids?.length ?? 0
  const canCancel = hasRound && ['Commit', 'Reveal'].includes(phase) && (
    (bidCount === 0 && now >= Number(testnet.round.commitEnd)) ||
    (bidCount > 0 && !reserveRevealed && now >= revealEnd)
  )
  const canCreateReplacement = !hasInitialization || phase === 'Idle' || terminal || canCancel
  const role = deriveAuctionRole({
    account: currentWalletAccount,
    initialization: testnet.initialization,
    view: testnet.view,
  })
  elements.deployModuleButton.disabled = !connected || !hasStatus || !hasCurrentContractArtifact || testnet.busy || hasDeployment || testnet.pending !== null
  // A module reference is global on Testnet. A dev-server restart must not force
  // the seller to deploy the identical Wasm again before creating another instance.
  // If this artifact has never been deployed, the initialization itself will be
  // rejected by the chain with its actual reason.
  elements.initContractButton.disabled = !connected || !hasStatus || !hasCurrentContractArtifact || testnet.busy || !canCreateReplacement || testnet.pending !== null
  elements.readViewButton.disabled = !connected || !hasInitialization || testnet.busy || testnet.pending !== null
  const decisionReady = testnet.sellerDecision !== null && isValidSellerReserveInput()
  elements.startRoundButton.disabled = !connected || !hasCurrentContractArtifact || !hasInitialization || !serviceBound || !isInstanceSeller || hasRound || !decisionReady || testnet.busy || testnet.pending !== null
  elements.cancelRoundButton.disabled = !connected || !isInstanceSeller || !canCancel || testnet.busy || testnet.pending !== null
  elements.backupReserveButton.disabled = testnet.startPlan === null
  const canCommitBid = connected && serviceBound && commitOpen && !isInstanceSeller && !bidAddresses.has(currentWalletAccount) && !testnet.busy && testnet.pending === null
  elements.bidAmountInput.disabled = !canCommitBid
  elements.commitBidButton.disabled = !canCommitBid
  elements.revealReserveButton.disabled = !connected || !serviceBound || !revealOpen || reserveRevealed || !isInstanceSeller || !testnet.startPlan || testnet.busy || testnet.pending !== null
  elements.revealBidButton.disabled = !connected || !serviceBound || !revealOpen || !selectedBidPlan || selectedBidAlreadyRevealed || testnet.busy || testnet.pending !== null
  elements.finalizeChainButton.disabled = !connected || !serviceBound || !finalizeOpen || testnet.busy || testnet.pending !== null

  const activeSellerRound = hasRound && !terminal
  const canShowSellerDecision = connected && (!hasInitialization || (isInstanceSeller && !activeSellerRound))
  elements.sellerAgentCard.hidden = !canShowSellerDecision
  elements.sellerAgentLocked.hidden = !(connected && isInstanceSeller && activeSellerRound)
  elements.sellerPublishActions.hidden = !connected || (hasInitialization && (!isInstanceSeller || (hasRound && !terminal && !canCancel)))
  elements.buyerCommitShell.hidden = !(role === 'buyer' && commitOpen)
  elements.sellerRevealShell.hidden = !(role === 'seller' && revealOpen && !reserveRevealed)
  elements.buyerRevealShell.hidden = !(role === 'committedBuyer' && revealOpen && !selectedBidAlreadyRevealed)
  elements.finalizeShell.hidden = !finalizeOpen
  const stageLabel = revealOpen
    ? '统一揭示期'
    : finalizeOpen
    ? '结算期'
    : hasInitialization
    ? phaseLabel(phase)
    : '准备容量窗口'
  renderRoleSummary({
    connected,
    role,
    stageLabel,
    hasInitialization,
    hasRound,
    commitOpen,
    revealOpen,
    finalizeOpen,
    terminal,
    serviceBound,
    revealEnd: testnet.round?.revealEnd,
    reserveRevealed,
  })
  renderSellerSettlementSummary()
  if (testnet.busy) {
    const label = testnet.pending?.kind === 'init' ? '等待初始化确认…' : testnet.pending?.kind === 'deploy' ? '等待部署确认…' : '正在准备…'
    elements.deployModuleButton.textContent = label
  } else {
    elements.deployModuleButton.textContent = hasDeployment ? '合约模块已就绪' : '首次部署合约模块'
  }
  elements.initContractButton.textContent = canCancel
    ? '准备隔离新容量窗口（旧窗口已过期）'
    : hasInitialization ? '准备下一容量窗口（0 CCD）' : '准备容量窗口（0 CCD）'
  elements.startRoundButton.textContent = hasRound ? '容量窗口已发布' : '确认发布容量窗口 · 锁定 2 CCD'
  elements.cancelRoundButton.textContent = canCancel ? '撤销过期空窗口并退款' : '过期后可撤销并退款'
  const plannedBidLabel = selectedBidPlan ? `${formatMicroCcd(selectedBidPlan.amountMicroCcd)} CCD` : '我的'
  elements.revealBidButton.textContent = selectedBidAlreadyRevealed ? '我的报价已揭示' : `揭示${plannedBidLabel}报价`
  elements.commitBidButton.textContent = '提交我的隐藏报价 · 先锁定 2 CCD'
  elements.revealReserveButton.textContent = '揭示卖家底价'
  elements.finalizeChainButton.textContent = '按固定规则结算'
}

function renderRoleSummary({ connected, role, stageLabel, hasInitialization, hasRound, commitOpen, revealOpen, finalizeOpen, terminal, serviceBound, revealEnd, reserveRevealed }) {
  if (!connected) {
    elements.roleLabel.textContent = '观察者'
    elements.roleStage.textContent = '等待连接钱包'
    elements.roleGuidance.textContent = '连接钱包后，页面会依据当前账户与合约状态显示你现在可执行的操作。'
    return
  }

  const roleLabel = {
    sellerCandidate: '卖家候选',
    seller: '卖家',
    buyer: '买家',
    committedBuyer: '已承诺买家',
    observer: '观察者',
  }[role] ?? '观察者'
  elements.roleLabel.textContent = roleLabel
  elements.roleStage.textContent = stageLabel
  const currentAccount = walletConnection?.accounts?.[0] ?? null
  const isChainWinner = currentAccount !== null && chainWinners().includes(currentAccount)

  if (!hasInitialization) {
    elements.roleGuidance.textContent = '当前尚无容量窗口。你可以作为卖家准备合约模块、创建实例，并在获得底价建议后发布。'
  } else if (!serviceBound) {
    elements.roleGuidance.textContent = '当前实例绑定的是旧规格摘要，不能继续发布或报价。它尚未开始且未锁定业务资金；请创建新的 0 CCD 容量窗口。'
  } else if (role === 'seller') {
    elements.roleGuidance.textContent = !hasRound
      ? '请获取 Seller Agent 的底价建议并确认发布；发布时会锁定 2 CCD 保证金。'
      : revealOpen && !reserveRevealed
      ? '承诺期已经结束。现在处于统一揭示期；请揭示此前承诺的卖家底价。'
      : terminal
      ? '该容量窗口已结束。你可以准备下一容量窗口，旧窗口的链上证据会被保留。'
      : '当前无需卖家操作；请等待阶段推进，或通过链上状态了解已承诺的买家数量。'
  } else if (role === 'buyer') {
    elements.roleGuidance.textContent = commitOpen
      ? '请输入你的最高愿付价格并提交隐藏报价。此时只锁定 2 CCD 保证金，报价金额不会公开。'
      : terminal
      ? isChainWinner
        ? '该容量窗口已结算。你是链上赢家，可在下方完成只读赢家核验。'
        : '该容量窗口已结束；当前账户未中标，退款已按合约规则处理。可在结算结果与 Explorer 中查看公开证据。'
      : '当前不在买家承诺期，暂时没有可执行的买家操作。'
  } else if (role === 'committedBuyer') {
    elements.roleGuidance.textContent = revealOpen
      ? reserveRevealed
        ? `统一揭示期已开放，将在 ${formatDate(revealEnd)} 截止。卖家底价已公开；现在请揭示你的报价，系统将提示需要补足的 CCD。`
        : `统一揭示期已开放，将在 ${formatDate(revealEnd)} 截止。现在可揭示你的报价；卖家底价尚未揭示不影响你提交。`
      : finalizeOpen
      ? '揭示期已结束，等待任意账户触发固定规则结算。'
      : terminal
      ? isChainWinner
        ? '当前容量窗口已结算。你是链上赢家，可在下方完成只读赢家核验。'
        : '当前容量窗口已结束；当前账户未中标，退款已按合约规则处理。'
      : '你的隐藏报价承诺已记录。请妥善保留当前浏览器中的揭示凭证，并等待揭示期。'
  } else if (finalizeOpen) {
    elements.roleGuidance.textContent = '揭示期已结束。任何已连接账户都可以触发一次固定规则结算。'
  } else {
    elements.roleGuidance.textContent = '当前账户没有可执行的交易操作，可继续观察链上阶段与公开证据。'
  }
}

async function refreshTestnetStatus() {
  const status = await requestJson('/api/testnet/status')
  const previousAddress = testnet.initialization?.address
  testnet.status = status
  testnet.deployment = status.deployment
  testnet.initialization = status.initialization
  testnet.round = status.round
  testnet.view = status.view
  if (!sameInstance(previousAddress, status.initialization?.address)) testnet.winnerVerification = null
  restoreContextEvidence(status)
  const restoredBackup = testnet.initialization ? loadReserveRevealBackup(testnet.initialization) : null
  if (restoredBackup) testnet.startPlan = restoredBackup
  if (testnet.initialization && walletConnection) testnet.bidPlan = loadBidRevealBackup(testnet.initialization, walletConnection.accounts[0])
  setTestnetStatus(
    formatStatusSummary(status),
    'success',
  )
  void loadLocalSessionHistory()
}

function restoreContextEvidence(status) {
  if (status.initialization?.hash) trackVerifiedTransaction('创建容量窗口', status.initialization)
  if (!status.round?.hash || !status.round?.explorerUrl) return
  const phase = phaseName(status.view?.state?.phase)
  const label = phase === 'Settled' || phase === 'NoSale'
    ? '链上结算'
    : phase === 'Cancelled'
    ? '取消并退款'
    : '当前容量窗口链上状态确认'
  trackVerifiedTransaction(label, {
    hash: status.round.hash,
    explorerUrl: status.round.explorerUrl,
  })
}

async function waitForContractUpdate(hash, receiveName, amountMicroCcd, expected = {}) {
  const { sender, ...verificationExpected } = expected
  return waitForFinalization('/api/testnet/verify-update', hash, {
    receiveName,
    amountMicroCcd,
    sender,
    expected: verificationExpected,
  })
}

async function waitForFinalization(endpoint, hash, extraBody = {}) {
  const sender = extraBody.sender
  if (!sender) {
    throw new ConcordiumClientError(
      'WALLET_ACCOUNT_MISSING',
      '交易核验缺少提交时的签名账户；请按交易哈希只读核验，勿重复发送。',
    )
  }
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const result = await requestJson(endpoint, {
      method: 'POST',
      // Use the sender captured from the transaction's connection object.
      // The global wallet connection may be cleared while finalization is pending.
      body: { hash, ...extraBody, sender },
    })
    if (result.final) return result
    await wait(5_000)
  }
  throw new ConcordiumClientError(
    'FINALIZATION_TIMEOUT',
    `交易尚未最终确认。请记录该哈希并稍后刷新页面后核对，勿重发：${hash}`,
  )
}

async function requestJson(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
      signal: controller.signal,
    })
    const payload = await response.json()
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? `HTTP ${response.status}`)
    return payload
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ConcordiumClientError(
        'NETWORK_TIMEOUT',
        options.timeoutMessage ?? '公共 Testnet 节点请求超时。请检查网络后重试；页面未请求钱包签名。',
      )
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function formatInitializedStatus(initialization, view) {
  const address = `<${initialization.address.index},${initialization.address.subindex}>`
  const phase = Object.keys(view.state.phase ?? {}).join('') || JSON.stringify(view.state.phase)
  return [
    `容量窗口 ${address} 已创建并最终确认；初始化未存入业务资金（0 CCD）。`,
    `链上阶段：${phase}；合约余额：${view.contractBalance} CCD`,
    initialization.contractUrl,
  ].join('\n')
}

function formatRoundStatus(round, view) {
  const phase = Object.keys(view.state.phase ?? {}).join('') || JSON.stringify(view.state.phase)
  return [
    `当前清算窗口已最终确认：链上阶段 ${phase}。`,
    `合约余额：${view.contractBalance} CCD；承诺截止：${formatDate(round.commitEnd)}`,
    `统一揭示截止：${formatDate(round.revealEnd)}`,
    round.explorerUrl,
  ].join('\n')
}

function formatLiveState(view, explorerUrl) {
  const phase = phaseName(view.state.phase)
  const bidCount = view.state.bids?.length ?? 0
  return [`链上状态：${phase}；已记录报价承诺：${bidCount}；合约余额：${view.contractBalance} CCD。`, explorerUrl].join('\n')
}

function phaseName(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return Object.keys(value)[0] ?? ''
  return ''
}

function optionValue(value) {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'Some')) {
    return value.Some
  }
  return null
}

function isValidSellerReserveInput() {
  try {
    parseCcdToMicroCcd(elements.sellerReserveInput.value)
    return true
  } catch {
    return false
  }
}

function phaseLabel(phase) {
  return {
    Idle: '等待发布',
    Commit: '承诺期开放',
    Reveal: '揭示期开放',
    Settled: '已结算',
    NoSale: '未成交',
    Cancelled: '已取消',
  }[phase] ?? phase
}

function formatStatusSummary(status) {
  if (status.contractReady !== true) {
    return `当前不能发起钱包交易：${status.contractIssue ?? 'Wasm/schema 尚未通过当前协议的构建核验。'}`
  }
  const instance = status.initialization
    ? `当前容量窗口：<${status.initialization.address.index},${status.initialization.address.subindex}>。`
    : '尚无已核验的容量窗口。'
  const terminalRound = ['NoSale', 'Settled', 'Cancelled'].includes(status.round?.phase)
  const hasCommitEnd = status.round?.commitEnd !== null && status.round?.commitEnd !== undefined && Number.isFinite(Number(status.round.commitEnd)) && Number(status.round.commitEnd) > 0
  const action = status.round && terminalRound
    ? `当前容量窗口已处于 ${status.round.phase} 终态；卖家可准备下一容量窗口（初始化金额为 0 CCD，网络费另计）。`
    : status.round && hasCommitEnd
    ? `当前容量窗口已进入 ${status.round.phase}；不会重复发布。承诺截止：${formatDate(status.round.commitEnd)}。`
    : status.round
    ? `当前容量窗口已进入 ${status.round.phase}，但公共节点未返回有效承诺截止；请刷新链上状态，页面不会重复发布。`
    : status.initialization
    ? `请切换到创建该容量窗口的卖家账户 ${shortAccountAddress(status.initialization.sender)}，再确认发布。`
    : '下一步：由已连接的卖家直接创建 0 CCD 容量窗口；只有当前 Wasm 从未部署到 Testnet 时才需要先部署模块。'
  const contextNote = status.instanceIssue ? `\n${status.instanceIssue}` : ''
  return `公共节点已确认 Concordium Testnet。\n当前 Wasm module ref: ${status.moduleReference}\n${instance}\n${action}${contextNote}`
}

function publicRoundPlan(plan) {
  return {
    contract: plan.contract,
    seller: plan.seller,
    parameters: plan.parameters,
  }
}

function setTestnetStatus(message, tone) {
  elements.testnetStatus.textContent = message
  elements.testnetStatus.dataset.tone = tone
}

function shortHash(hash) {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

function record(message, status = 'placeholder') {
  const entry = { at: new Date().toISOString(), time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), message, status }
  activity.unshift(entry)
  persistLocalSession('/api/session/activity', { message, status })
}

function trackVerifiedTransaction(label, transaction) {
  if (!transaction?.hash || !transaction?.explorerUrl) return
  if (testnet.transactions.some((item) => item.hash === transaction.hash)) return
  const instance = testnet.initialization?.address
  if (!instance) return
  testnet.transactions.push({
    label,
    hash: transaction.hash,
    explorerUrl: transaction.explorerUrl,
    confirmedAt: Date.now(),
    instance,
  })
  persistLocalSession('/api/session/evidence', {
    label,
    hash: transaction.hash,
    explorerUrl: transaction.explorerUrl,
    instance,
  })
}

function persistLocalSession(path, body) {
  if (!runtime.walletActions) return
  void fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  }).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  }).catch((error) => {
    console.error(`Could not persist local session data at ${path}:`, error)
  })
}

async function loadLocalSessionHistory() {
  if (!runtime.walletActions) return
  try {
    const history = await requestJson('/api/session/history')
    const legacyEntries = Array.isArray(history.entries) ? history.entries : []
    const savedActivity = Array.isArray(history.activity)
      ? history.activity
      : legacyEntries.filter((entry) => entry.kind === 'activity')
    const savedEvidence = Array.isArray(history.evidence)
      ? history.evidence
      : legacyEntries.filter((entry) => entry.kind === 'evidence')
    activity = savedActivity.map((entry) => ({
      ...entry,
      time: formatLocalTime(entry.at),
    }))
    testnet.transactions = savedEvidence.map((entry) => ({
      label: entry.label,
      hash: entry.hash,
      explorerUrl: entry.explorerUrl,
      confirmedAt: entry.at,
      instance: entry.instance,
    }))
    confirmedSettlements = Array.isArray(history.settlements) ? history.settlements : []
    render()
  } catch (error) {
    console.error('Could not restore local session history:', error)
  }
}

function setMessage(message, tone) {
  setTestnetStatus(message, tone)
}

async function loadEvidence() {
  renderEvidencePanel()
  renderMarketHistory()
}

async function loadJudgeJourney() {
  try {
    const response = await fetch(publicAssetUrl('evidence/judge-journey.json'), { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    if (payload?.evidenceStatus !== 'pending' && (!Array.isArray(payload?.chainJourney?.steps) || !payload?.chainJourney?.result)) {
      throw new Error('证据快照缺少链上步骤或结算结果')
    }
    judgeJourney = payload
  } catch (error) {
    judgeJourney = { error: error instanceof Error ? error.message : String(error) }
  }
  renderJudgeJourney()
}

function renderJudgeJourney() {
  if (runtime.mode !== 'public-readonly') return
  elements.judgeDecisionEvidence.replaceChildren()
  elements.judgeJourneySteps.replaceChildren()
  elements.judgeJourneyResult.replaceChildren()

  if (!judgeJourney) {
    elements.judgeJourneyBadge.textContent = '正在读取证据'
    elements.judgeJourneyBadge.className = 'badge badge-neutral'
    return
  }
  if (judgeJourney.error) {
    elements.judgeJourneyBadge.textContent = '证据不可用'
    elements.judgeJourneyBadge.className = 'badge badge-danger'
    elements.judgeJourneySummary.textContent = `无法展示评委观察路径：${judgeJourney.error}。公开页不会用占位交易补齐缺失数据。`
    const empty = document.createElement('p')
    empty.className = 'journey-empty'
    empty.textContent = '请检查随仓库提交的 evidence/judge-journey.json 是否可访问。'
    elements.judgeJourneySteps.append(empty)
    return
  }

  if (judgeJourney.evidenceStatus === 'pending') {
    elements.judgeJourneyBadge.textContent = '当前协议 · 等待 Testnet 结算'
    elements.judgeJourneyBadge.className = 'badge badge-warning'
    elements.judgeJourneySummary.textContent = judgeJourney.protocolStatus || '当前协议尚无可公开核验的完整 Testnet 交易轨迹。页面不会回退展示旧协议实例。'
    renderJudgeDecision(judgeJourney.sellerDecisionEvidence)
    const empty = document.createElement('p')
    empty.className = 'journey-empty'
    empty.textContent = '等待当前双容量协议完成初始化、承诺、统一揭示和结算，并由 Testnet view 与结算交易核对后再写入本页。'
    elements.judgeJourneySteps.append(empty)
    return
  }

  const chain = judgeJourney.chainJourney
  const decision = judgeJourney.sellerDecisionEvidence
  const address = `<${chain.instance.index},${chain.instance.subindex}>`
  const historicalProtocol = judgeJourney.protocolStatus
  elements.judgeJourneyBadge.textContent = historicalProtocol
    ? `${judgeJourney.network} · 历史证据`
    : `${judgeJourney.network} · ${address}`
  elements.judgeJourneyBadge.className = historicalProtocol ? 'badge-warning' : 'badge-success'
  elements.judgeJourneySummary.textContent = historicalProtocol
    ? `${judgeJourney.protocolStatus} 本快照：${judgeJourney.service.name} · ${judgeJourney.service.capacityUnits} 个容量单位 · 实例 ${address}。`
    : `${judgeJourney.service.name} · ${judgeJourney.service.capacityUnits} 个容量单位 · 规格指纹 ${shortHash(judgeJourney.service.serviceId)}。以下 ${chain.steps.length} 笔交易属于同一合约实例 ${address}；金额全部来自最终结算快照。`

  renderJudgeDecision(decision)
  for (const [index, step] of chain.steps.entries()) {
    elements.judgeJourneySteps.append(renderJudgeJourneyStep(step, index + 1))
  }
  renderJudgeResult(chain)
}

function renderJudgeDecision(decision) {
  if (!decision) {
    elements.judgeDecisionEvidence.textContent = 'Seller Agent 决策证据未随公开构建提供。'
    return
  }
  const heading = document.createElement('div')
  heading.className = 'decision-evidence-heading'
  const title = document.createElement('div')
  const eyebrow = document.createElement('span')
  const strong = document.createElement('strong')
  const instance = judgeJourney?.chainJourney?.instance
  const instanceLabel = instance ? `<${instance.index},${instance.subindex}>` : '本次链上交易'
  eyebrow.textContent = `独立策略评测 · 不属于本次 ${instanceLabel} 结算`
  strong.textContent = `Seller Agent 建议将底价调整为 ${formatMicroCcd(decision.finalReserveMicroCcd)} CCD`
  title.append(eyebrow, strong)
  const badge = document.createElement('span')
  badge.className = 'badge badge-success'
  badge.textContent = `${decision.evaluation.finalDecisionCorrect}/${decision.evaluation.totalRuns} 最终动作正确`
  heading.append(title, badge)

  const reason = document.createElement('p')
  const signalLabels = {
    soldRate: '成交率',
    averageBidderCount: '平均参与买家数',
    previousAverageSurplus: '历史平均交易剩余',
    supplyChange: '供给变化',
  }
  const reasons = decision.reasonSignals.map((item) => signalLabels[item] ?? item).join('、')
  reason.textContent = `本评测只验证决策层，不是当前链上底价的来源。模型判断市场偏强，理由字段为：${reasons}。代码裁决后的最终动作是 ${decision.finalAction}；模型调用失败 ${decision.evaluation.modelCallFailures} 次。`

  const meta = document.createElement('div')
  meta.className = 'decision-evidence-meta'
  const model = document.createElement('code')
  model.textContent = `${decision.model} · ${decision.promptVersion}`
  const link = document.createElement('a')
  link.href = decision.evidenceUrl
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.textContent = '查看结构化评测证据 ↗'
  meta.append(model, link)
  elements.judgeDecisionEvidence.append(heading, reason, meta)
}

function renderJudgeJourneyStep(step, number) {
  const item = document.createElement('li')
  const index = document.createElement('span')
  index.className = 'journey-step-index'
  index.textContent = String(number).padStart(2, '0')
  const content = document.createElement('div')
  content.className = 'journey-step-content'
  const heading = document.createElement('div')
  const title = document.createElement('strong')
  const time = document.createElement('time')
  title.textContent = step.label
  time.textContent = step.at ? formatDate(step.at) : '最终确认 · 时间未保留'
  heading.append(title, time)
  const detail = document.createElement('p')
  detail.textContent = step.detail
  const proof = document.createElement('a')
  proof.href = step.explorerUrl
  proof.target = '_blank'
  proof.rel = 'noreferrer'
  const proofLabel = document.createElement('span')
  const hash = document.createElement('code')
  proofLabel.textContent = '交易证据'
  hash.textContent = shortHash(step.hash)
  proof.append(proofLabel, hash)
  content.append(heading, detail, proof)
  item.append(index, content)
  return item
}

function renderJudgeResult(chain) {
  const result = chain.result
  const heading = document.createElement('div')
  heading.className = 'journey-result-heading'
  const title = document.createElement('div')
  const eyebrow = document.createElement('span')
  const strong = document.createElement('strong')
  eyebrow.textContent = '最终链上结果'
  strong.textContent = `${result.phase} · 资金核对${result.reconciled ? '通过' : '未通过'}`
  title.append(eyebrow, strong)
  const link = document.createElement('a')
  link.href = chain.instance.contractUrl
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.textContent = `打开合约 <${chain.instance.index},${chain.instance.subindex}> ↗`
  heading.append(title, link)

  const grid = document.createElement('dl')
  const winners = Array.isArray(result.winners)
    ? result.winners
    : result.winner ? [result.winner] : []
  const winnerLabel = winners.length > 0
    ? winners.map((winner) => shortAccountAddress(winner)).join('、')
    : '无赢家'
  const averageWinningBid = result.averageWinningBidMicroCcd ?? result.winningBidMicroCcd
  const averageClearingPrice = result.averageClearingPriceMicroCcd ?? result.clearingPriceMicroCcd
  const totalSurplus = result.totalSurplusMicroCcd ?? result.surplusMicroCcd
  const fields = [
    ['赢家', winnerLabel],
    ['卖家底价', `${formatMicroCcd(result.reserveMicroCcd)} CCD`],
    ['赢家报价均价', `${formatMicroCcd(averageWinningBid)} CCD / 单位`],
    ['成交均价', `${formatMicroCcd(averageClearingPrice)} CCD / 单位`],
    ['交易剩余合计', `${formatMicroCcd(totalSurplus)} CCD`],
    ['平台费', `${formatMicroCcd(result.platformFeeMicroCcd)} CCD`],
    ['买家退款合计', `${formatMicroCcd(result.totalRefundMicroCcd)} CCD`],
    ['卖家所得', `${formatMicroCcd(result.sellerReceivesMicroCcd)} CCD`],
    ['链上总托管', `${formatMicroCcd(result.totalDepositedMicroCcd)} CCD`],
    ['合约余额', `${formatMicroCcd(result.contractBalanceMicroCcd)} CCD`],
  ]
  for (const [label, value] of fields) {
    const row = document.createElement('div')
    const term = document.createElement('dt')
    const description = document.createElement('dd')
    term.textContent = label
    description.textContent = value
    row.append(term, description)
    grid.append(row)
  }
  const allocations = document.createElement('div')
  allocations.className = 'journey-allocation-grid'
  for (const [index, allocation] of (result.allocations ?? []).entries()) {
    const card = document.createElement('div')
    card.className = 'journey-allocation'
    const winner = document.createElement('strong')
    winner.textContent = `赢家 ${index + 1} · ${shortAccountAddress(allocation.winner)}`
    const formula = document.createElement('code')
    formula.textContent = `报价 ${formatMicroCcd(allocation.bidMicroCcd)} − 底价 ${formatMicroCcd(allocation.reserveMicroCcd)} = 剩余 ${formatMicroCcd(allocation.surplusMicroCcd)} CCD；中点成交价 ${formatMicroCcd(allocation.clearingPriceMicroCcd)} CCD`
    card.append(winner, formula)
    allocations.append(card)
  }
  const check = document.createElement('p')
  check.className = result.reconciled ? 'journey-reconciled' : 'journey-unreconciled'
  check.textContent = result.reconciled
    ? `资金守恒：${formatMicroCcd(result.totalDepositedMicroCcd)} CCD = 卖家所得 + 平台费 + 买家退款，结算后合约余额为 0 CCD。`
    : '资金核对未通过；不得把该快照视为已核验结算。'
  elements.judgeJourneyResult.append(heading, grid)
  if (allocations.childElementCount > 0) elements.judgeJourneyResult.append(allocations)
  elements.judgeJourneyResult.append(check)
}

async function loadPublishedMarketSettlements() {
  try {
    const response = await fetch(publicAssetUrl('evidence/confirmed-market-settlements.json'), { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    publishedSettlements = Array.isArray(payload.settlements) ? payload.settlements : []
    render()
  } catch (error) {
    console.error(`Could not load published market settlements: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function loadServiceSpec() {
  try {
    const response = await fetch(publicAssetUrl('service-spec.json'), { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const bytes = await response.arrayBuffer()
    const spec = JSON.parse(new TextDecoder().decode(bytes))
    if (
      !spec || typeof spec.serviceName !== 'string' || !Number.isInteger(spec.capacityUnits) ||
      !spec.delivery || typeof spec.delivery.mode !== 'string' || spec.delivery.mode.length === 0
    ) throw new Error('缺少最小容量规格字段')
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    serviceSpec = { spec, hash }
    serviceSpecError = null
  } catch (error) {
    serviceSpec = null
    serviceSpecError = `读取 service-spec.json 失败：${error instanceof Error ? error.message : String(error)}`
  }
  render()
}

function renderEvidencePanel() {
  if (runtime.walletActions && testnet.initialization) {
    renderCurrentSessionEvidence()
    return
  }
  elements.evidenceBadge.textContent = '等待本会话核验'
  elements.evidenceBadge.className = 'badge badge-warning'
  elements.evidenceSummary.dataset.tone = 'neutral'
  elements.evidenceSummary.textContent = '尚未选定当前协议的本地 Testnet 实例。旧协议快照不会作为当前工作台的默认交易记录。'
  elements.evidenceList.replaceChildren()
  elements.settlementBreakdown.hidden = true
}

function renderMarketHistory() {
  const records = marketHistoryRecords()
  const currentSpecRecords = currentSpecSettlementRecords(records)
  elements.marketHistoryList.replaceChildren()
  elements.marketHistoryBadge.textContent = records.length > 0 ? `已确认 ${records.length} 笔` : '暂无已确认成交'
  elements.marketHistoryBadge.className = `badge ${records.length > 0 ? 'badge-success' : 'badge-warning'}`

  if (records.length === 0) {
    elements.marketHistorySummary.textContent = '当前尚无已最终确认的容量成交。结算完成且资金核对通过后，才会写入此处；不会以 Seller Agent 的演练输入或未确认交易补充记录。'
    const empty = document.createElement('p')
    empty.className = 'market-history-empty'
    empty.textContent = '暂无可用于价格发现的已确认成交记录。'
    elements.marketHistoryList.append(empty)
    return
  }

  elements.marketHistorySummary.textContent = `已确认 ${records.length} 笔成交；其中 ${currentSpecRecords.length} 笔与当前容量市场标识一致，可作为当前市场的价格信号。其余记录保留为独立历史证据，不混入当前市场。`
  for (const record of records) elements.marketHistoryList.append(renderMarketHistoryEntry(record))
}

function marketHistoryRecords() {
  const records = []
  const liveRecord = currentSettlementRecord()
  if (liveRecord) records.push(liveRecord)
  for (const record of confirmedSettlements) {
    if (!records.some((entry) => sameInstance(entry.instance, record.instance))) records.push(record)
  }
  for (const record of publishedSettlements) {
    if (!records.some((entry) => sameInstance(entry.instance, record.instance))) records.push(record)
  }
  return records
    .map((record) => ({
      ...record,
      service: {
        ...record.service,
        matchesCurrentSpec: Boolean(serviceSpec?.hash && record.service?.id === serviceSpec.hash),
      },
    }))
    .sort((left, right) => String(right.settledAt).localeCompare(String(left.settledAt)))
}

function currentSpecSettlementRecords(records = marketHistoryRecords()) {
  return records.filter((record) => record.reconciled === true && record.service?.matchesCurrentSpec === true && record.outcome !== 'no_sale')
}

function renderMarketSignal() {
  const records = currentSpecSettlementRecords().sort((left, right) => String(left.settledAt).localeCompare(String(right.settledAt)))
  const sampleCount = records.length
  const allocatedUnits = records.reduce((total, record) => total + BigInt(historyAllocatedUnits(record)), 0n)
  elements.marketSignalMetrics.replaceChildren()
  elements.marketSignalBadge.textContent = sampleCount >= 3 ? `已确认样本 n = ${sampleCount}` : `样本 n = ${sampleCount}`
  elements.marketSignalBadge.className = `badge ${sampleCount >= 3 ? 'badge-success' : 'badge-warning'}`

  if (sampleCount === 0) {
    elements.marketSignalReading.textContent = '当前容量市场尚无已确认且资金核对通过的成交，暂不形成价格信号。'
    renderMarketSignalEmpty('等待当前容量市场的已确认成交。')
    return
  }

  const prices = records.map((record) => BigInt(historyAveragePrice(record))).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  const middle = Math.floor(prices.length / 2)
  const median = prices.length % 2 === 1 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2n
  const latest = records.at(-1)
  const lowest = prices[0]
  const highest = prices.at(-1)
  const weightedAveragePrice = records.reduce((total, record) => total + BigInt(historyAveragePrice(record)) * BigInt(historyAllocatedUnits(record)), 0n) / allocatedUnits
  const averageSurplus = records.reduce((total, record) => total + BigInt(historyTotalSurplus(record)), 0n) / allocatedUnits
  const metrics = [
    ['已确认窗口', `n = ${sampleCount}`],
    ['已售容量', `${allocatedUnits} 单位`],
    ['最新成交均价', `${formatMicroCcd(historyAveragePrice(latest))} CCD / 单位`],
    ['加权成交均价', `${formatMicroCcd(weightedAveragePrice)} CCD / 单位`],
    ['成交均价区间', `${formatMicroCcd(lowest)}–${formatMicroCcd(highest)} CCD / 单位`],
    ['每单位平均剩余', `${formatMicroCcd(averageSurplus)} CCD`],
    ['最新 / 中位数', relativeToMedian(historyAveragePrice(latest), median)],
  ]
  for (const [label, value] of metrics) {
    const metric = document.createElement('div')
    const metricLabel = document.createElement('span')
    const metricValue = document.createElement('strong')
    metricLabel.textContent = label
    metricValue.textContent = value
    metric.append(metricLabel, metricValue)
    elements.marketSignalMetrics.append(metric)
  }
  elements.marketSignalReading.textContent = sampleCount < 3
    ? `仅有 ${sampleCount} 笔样本，暂不形成稳定判断；以下图表只展示已确认事实。`
    : `早期观察：最新成交均价为 ${formatMicroCcd(historyAveragePrice(latest))} CCD / 单位，${relativeToMedian(historyAveragePrice(latest), median, 'text')}；样本仅 ${sampleCount} 窗口，继续观察，不代表稳定趋势或公允价格。`
  renderMarketSignalChart(records)
}

function relativeToMedian(value, median, format = 'short') {
  const amount = BigInt(value)
  if (median === 0n) return format === 'text' ? '中位成交价为 0，无法比较' : '—'
  const difference = amount - median
  const basisPoints = (difference * 10_000n) / median
  const percent = `${basisPoints < 0n ? '-' : '+'}${formatMicroPercent(basisPoints < 0n ? -basisPoints : basisPoints)}%`
  return format === 'text' ? `较中位成交价 ${percent}` : percent
}

function formatMicroPercent(basisPoints) {
  const whole = basisPoints / 100n
  const fraction = (basisPoints % 100n).toString().padStart(2, '0')
  return `${whole}.${fraction}`
}

function renderMarketSignalEmpty(message) {
  elements.marketSignalChart.replaceChildren()
  const empty = document.createElement('p')
  empty.className = 'signal-chart-empty'
  empty.textContent = message
  elements.marketSignalChart.append(empty)
}

function renderMarketSignalChart(records) {
  if (records.length === 0) {
    renderMarketSignalEmpty('等待当前容量市场的已确认成交。')
    return
  }
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 760 218')
  svg.setAttribute('preserveAspectRatio', 'none')
  const series = [
    ['reserveMicroCcd', (record) => String(record.reserveMicroCcd), '#ffd37a'],
    ['clearingPriceMicroCcd', historyAveragePrice, '#86f7b8'],
    ['winningBidMicroCcd', historyAverageBid, '#98c7ff'],
  ]
  const values = records.flatMap((record) => series.map(([, amountFor]) => Number(BigInt(amountFor(record)))))
  const lower = Math.min(...values)
  const upper = Math.max(...values)
  const padding = Math.max(Math.round((upper - lower) * 0.16), 100_000)
  const min = Math.max(0, lower - padding)
  const max = upper + padding
  const left = 62
  const right = 18
  const top = 16
  const bottom = 38
  const width = 760 - left - right
  const height = 218 - top - bottom
  const y = (value) => top + ((max - value) / (max - min || 1)) * height
  const x = (index) => left + (records.length === 1 ? width / 2 : (index / (records.length - 1)) * width)
  for (let line = 0; line < 4; line += 1) {
    const value = min + ((max - min) * line) / 3
    const lineY = y(value)
    const grid = document.createElementNS(ns, 'line')
    grid.setAttribute('x1', String(left))
    grid.setAttribute('x2', String(left + width))
    grid.setAttribute('y1', String(lineY))
    grid.setAttribute('y2', String(lineY))
    grid.setAttribute('stroke', '#2d4f3b')
    grid.setAttribute('stroke-width', '1')
    svg.append(grid)
    const label = document.createElementNS(ns, 'text')
    label.setAttribute('x', '0')
    label.setAttribute('y', String(lineY + 4))
    label.setAttribute('fill', '#89958e')
    label.setAttribute('font-size', '10')
    label.textContent = `${formatMicroCcd(BigInt(Math.round(value)))} CCD`
    svg.append(label)
  }
  for (const [key, amountFor, color] of series) {
    const points = records.map((record, index) => `${x(index)},${y(Number(BigInt(amountFor(record))))}`).join(' ')
    const path = document.createElementNS(ns, 'polyline')
    path.setAttribute('points', points)
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', color)
    path.setAttribute('stroke-width', '2')
    path.setAttribute('stroke-linejoin', 'round')
    svg.append(path)
    records.forEach((record, index) => {
      const point = document.createElementNS(ns, 'circle')
      point.setAttribute('cx', String(x(index)))
      point.setAttribute('cy', String(y(Number(BigInt(amountFor(record))))) )
      point.setAttribute('r', '4')
      point.setAttribute('fill', color)
      const title = document.createElementNS(ns, 'title')
      title.textContent = `<${record.instance.index},${record.instance.subindex}> · ${formatMicroCcd(amountFor(record))} CCD`
      point.append(title)
      svg.append(point)
    })
  }
  records.forEach((record, index) => {
    const label = document.createElementNS(ns, 'text')
    label.setAttribute('x', String(x(index)))
    label.setAttribute('y', '207')
    label.setAttribute('text-anchor', 'middle')
    label.setAttribute('fill', '#89958e')
    label.setAttribute('font-size', '10')
    label.textContent = `<${record.instance.index},${record.instance.subindex}>`
    svg.append(label)
  })
  elements.marketSignalChart.replaceChildren(svg)
}

function currentSettlementRecord() {
  if (!testnet.initialization || !['Settled', 'NoSale'].includes(phaseName(testnet.view?.state?.phase))) return null
  const transaction = testnet.transactions.find((entry) => (
    entry.label === '链上结算' && sameInstance(entry.instance, testnet.initialization.address)
  ))
  if (!transaction) return null
  try {
    return createConfirmedSettlement({
      initialization: testnet.initialization,
      view: testnet.view,
      transaction: {
        hash: transaction.hash,
        explorerUrl: transaction.explorerUrl,
        confirmedAt: transaction.confirmedAt,
      },
      serviceSpec,
    })
  } catch (error) {
    console.error('Could not create current settlement record:', error)
    return null
  }
}

function historyAllocatedUnits(record) {
  const value = Number(record?.allocatedUnits ?? record?.winners?.length ?? 1)
  return Number.isInteger(value) && value >= 0 ? value : 1
}

function historyAveragePrice(record) {
  return String(record?.averageClearingPriceMicroCcd ?? record?.clearingPriceMicroCcd ?? '0')
}

function historyAverageBid(record) {
  return String(record?.averageWinningBidMicroCcd ?? record?.winningBidMicroCcd ?? '0')
}

function historyTotalSurplus(record) {
  return String(record?.totalSurplusMicroCcd ?? record?.surplusMicroCcd ?? '0')
}

function historyWinners(record) {
  if (Array.isArray(record?.winners)) return record.winners
  if (record?.winner) {
    return [{
      bidder: record.winner,
      bidMicroCcd: record.winningBidMicroCcd,
      clearingPriceMicroCcd: record.clearingPriceMicroCcd,
      buyerRefundMicroCcd: record.buyerRefundMicroCcd,
    }]
  }
  return []
}

function renderMarketHistoryEntry(record) {
  const entry = document.createElement('details')
  entry.className = 'market-history-entry'
  const summary = document.createElement('summary')
  const capacity = document.createElement('span')
  const capacityName = record.service?.capacityUnits === null
    ? record.service?.name ?? '已绑定的容量规格'
    : `${record.service?.name ?? '已绑定的容量规格'} · ${record.service.capacityUnits} 单位`
  const capacityLabel = document.createElement('small')
  capacityLabel.textContent = '容量规格'
  const capacityValue = document.createElement('strong')
  capacityValue.textContent = capacityName
  capacity.append(capacityLabel, capacityValue)
  summary.append(capacity)
  const allocated = historyAllocatedUnits(record)
  const noSale = record.outcome === 'no_sale'
  for (const [label, value] of [
    ['结算时间', record.settledAt ? formatDate(record.settledAt) : '已确认'],
    ['已售 / 成交均价', noSale ? '0 单位 · 未成交' : `${allocated} 单位 · ${formatMicroCcd(historyAveragePrice(record))} CCD`],
    ['交易剩余', noSale ? '—' : `${formatMicroCcd(historyTotalSurplus(record))} CCD`],
    ['平台费', `${formatMicroCcd(record.platformFeeMicroCcd)} CCD`],
  ]) {
    const item = document.createElement('span')
    const itemLabel = document.createElement('small')
    const itemValue = document.createElement('strong')
    itemLabel.textContent = label
    itemValue.textContent = value
    item.append(itemLabel, itemValue)
    summary.append(item)
  }
  const result = document.createElement('strong')
  result.className = 'history-result'
  result.textContent = record.reconciled ? (noSale ? '未成交 · 资金核对通过' : '资金核对通过') : '资金核对失败'
  summary.append(result)

  const detail = document.createElement('div')
  detail.className = 'history-detail'
  const fields = document.createElement('dl')
  const winners = historyWinners(record)
  const winnerSummary = winners.length > 0
    ? winners.map((winner) => `${shortAccountAddress(String(winner.bidder))} · ${formatMicroCcd(winner.clearingPriceMicroCcd)} CCD`).join('；')
    : noSale ? '无赢家' : '已脱敏'
  for (const [label, value] of [
    ['容量窗口', `<${record.instance.index},${record.instance.subindex}>`],
    ['卖家底价', `${formatMicroCcd(record.reserveMicroCcd)} CCD`],
    ['赢家数 / 已售容量', `${winners.length || allocated} / ${allocated} 单位`],
    ['赢家成交均价', `${formatMicroCcd(historyAveragePrice(record))} CCD / 单位`],
    ['赢家明细（地址 · 成交价）', winnerSummary],
    ['赢家报价均价', `${formatMicroCcd(historyAverageBid(record))} CCD / 单位`],
    ['赢家退款合计', `${formatMicroCcd(record.buyerRefundMicroCcd)} CCD`],
    ['买家退款合计', `${formatMicroCcd(record.totalRefundMicroCcd)} CCD`],
    ['卖家所得', `${formatMicroCcd(record.sellerReceivesMicroCcd)} CCD`],
    ['链上总托管', `${formatMicroCcd(record.totalDepositedMicroCcd)} CCD`],
  ]) {
    const row = document.createElement('div')
    const term = document.createElement('dt')
    const description = document.createElement('dd')
    term.textContent = label
    description.textContent = value
    row.append(term, description)
    fields.append(row)
  }
  const links = document.createElement('div')
  links.className = 'history-links'
  const qualification = document.createElement('p')
  qualification.textContent = noSale && record.service?.matchesCurrentSpec
    ? '该轮未成交：计入供给与未成交信号，不计入成交价格统计。'
    : record.service?.matchesCurrentSpec
    ? '规格指纹与当前 service-spec.json 一致：该记录可用于当前容量规格的价格信号。'
    : record.protocol ?? '规格指纹与当前 service-spec.json 不一致：保留为独立历史证据，不混入当前价格信号。'
  const fingerprint = document.createElement('code')
  fingerprint.textContent = record.service?.id ? `规格指纹：${record.service.id}` : '规格指纹：历史快照未保存'
  const transaction = document.createElement('a')
  transaction.href = record.transaction.explorerUrl
  transaction.target = '_blank'
  transaction.rel = 'noreferrer'
  transaction.textContent = `在 CCDExplorer 核验结算交易 ${shortHash(record.transaction.hash)} ↗`
  links.append(qualification, fingerprint, transaction)
  detail.append(fields, links)
  entry.append(summary, detail)
  return entry
}

function renderCurrentSessionEvidence() {
  const initialization = testnet.initialization
  const address = `<${initialization.address.index},${initialization.address.subindex}>`
  const entries = testnet.transactions.filter((item) => sameInstance(item.instance, initialization.address))
  const phase = phaseName(testnet.view?.state?.phase) || '未读回'
  const balance = testnet.view?.contractBalance ? `${testnet.view.contractBalance} CCD` : '未读回'
  elements.evidenceBadge.textContent = entries.length > 0 ? `已核验 ${entries.length} 笔` : '尚无本地证据'
  elements.evidenceBadge.className = `badge ${entries.length > 0 ? 'badge-success' : 'badge-warning'}`
  elements.evidenceSummary.dataset.tone = 'success'
  elements.evidenceSummary.textContent = `本地完整模式 · 当前实例 ${address} · 本地已核验 ${entries.length} 笔交易 · 链上阶段 ${phase} · 合约余额 ${balance}`
  renderEvidenceRows(entries, '本地确认时间')
  renderSettlementBreakdown(testnet.view)
  if (entries.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'evidence-empty'
    empty.textContent = '当前实例尚没有本会话最终确认的交易记录。完成初始化或后续链上操作后，核验记录会出现在这里。'
    elements.evidenceList.append(empty)
  }
}

function sameInstance(left, right) {
  return left && right && String(left.index) === String(right.index) && String(left.subindex) === String(right.subindex)
}

function renderSettlementBreakdown(view) {
  const phase = phaseName(view?.state?.phase)
  const allocations = Array.isArray(view?.state?.allocations) ? view.state.allocations : []
  if (!['Settled', 'NoSale', 'Cancelled'].includes(phase) || allocations.length === 0) {
    elements.settlementBreakdown.hidden = true
    return
  }
  const toMicro = (value) => BigInt(value ?? 0)
  const totalDeposited = toMicro(view.state.total_deposited)
  const refunds = allocations.reduce((total, item) => total + toMicro(item.buyer_refund), 0n)
  const platform = allocations.reduce((total, item) => total + toMicro(item.platform_receives), 0n)
  const seller = totalDeposited - refunds - platform
  const winners = allocations.filter((item) => item.won === true)
  const rows = [
    ['链上总托管', `${formatMicroCcd(totalDeposited)} CCD`],
    ['买家退款合计', `${formatMicroCcd(refunds)} CCD`],
    ['平台所得', `${formatMicroCcd(platform)} CCD`],
    ['卖家所得（总托管减退款与平台费）', `${formatMicroCcd(seller)} CCD`],
  ]
  if (winners.length > 0) {
    const totalPrice = winners.reduce((total, winner) => total + toMicro(winner.price), 0n)
    const winnerRows = winners.map((winner, index) => [
      `赢家 ${index + 1}`,
      `${shortAccountAddress(String(winner.bidder))} · ${formatMicroCcd(toMicro(winner.price))} CCD`,
    ])
    rows.splice(1, 0,
      ['已售容量', `${winners.length} 单位`],
      ['赢家成交均价', `${formatMicroCcd(totalPrice / BigInt(winners.length))} CCD / 单位`],
      ...winnerRows,
    )
  } else {
    rows.splice(1, 0, ['成交结果', phase === 'NoSale' ? '无合格报价' : '已取消'])
  }
  const reconciled = seller >= 0n && seller + refunds + platform === totalDeposited
  rows.push(['资金核对', reconciled ? '通过：托管 = 卖家 + 平台 + 退款' : '未通过：请勿视为已核验', reconciled ? 'success' : 'error'])
  elements.settlementBreakdownList.replaceChildren()
  for (const [label, value, tone] of rows) {
    const term = document.createElement('dt')
    const description = document.createElement('dd')
    term.textContent = label
    description.textContent = value
    if (tone) description.dataset.tone = tone
    elements.settlementBreakdownList.append(term, description)
  }
  elements.settlementBreakdown.hidden = false
}

function renderEvidenceRows(rows, timeLabel) {
  elements.evidenceList.replaceChildren()
  for (const item of rows) {
    const wrapper = document.createElement('div')
    wrapper.className = 'evidence-row'
    const row = document.createElement('a')
    row.href = item.explorerUrl
    row.target = '_blank'
    row.rel = 'noreferrer'
    const label = document.createElement('span')
    const hash = document.createElement('code')
    const time = document.createElement('time')
    label.textContent = item.label
    hash.textContent = `${item.hash.slice(0, 10)}…${item.hash.slice(-6)}`
    time.textContent = item.confirmedAt ? formatDate(item.confirmedAt) : timeLabel
    time.title = item.confirmedAt ? `${timeLabel}：${formatDate(item.confirmedAt)}` : timeLabel
    row.append(label, hash, time)
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'copy-hash'
    copy.textContent = '复制哈希'
    copy.title = item.hash
    copy.addEventListener('click', () => { void copyTransactionHash(item.hash, copy) })
    wrapper.append(row, copy)
    elements.evidenceList.append(wrapper)
  }
}

async function copyTransactionHash(hash, button) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(hash)
    button.textContent = '已复制'
  } catch {
    button.textContent = '复制失败'
    button.title = `请手动复制：${hash}`
  }
  setTimeout(() => { button.textContent = '复制哈希' }, 1_800)
}

async function loadAgentEvaluation() {
  if (runtime.agentApi) return
  try {
    const response = await fetch(publicAssetUrl('evidence/seller-agent-evaluation.json'), { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const evidence = await response.json()
    const decision = evidence.representativeDecision
    elements.sellerDecisionStatus.textContent = [
      `真实 API 固定评测：${evidence.model} · ${evidence.promptVersion}`,
      `模型分类 ${evidence.modelSignalCorrect}/${evidence.totalRuns}；最终动作 ${evidence.finalDecisionCorrect}/${evidence.totalRuns}；调用失败 ${evidence.modelCallFailures}/${evidence.totalRuns}`,
      `代表性 demo data：${decision.marketSignal} → ${decision.finalAction}，最终底价 ${formatMicroCcd(decision.finalReserveMicroCcd)} CCD。该评测与当前 Testnet 拍卖不是同一轮。`,
    ].join('\n')
    elements.sellerDecisionStatus.dataset.tone = 'success'
  } catch (error) {
    elements.sellerDecisionStatus.textContent = `Agent 评测证据读取失败：${error instanceof Error ? error.message : String(error)}`
    elements.sellerDecisionStatus.dataset.tone = 'error'
  }
}

async function loadRuntimeConfig() {
  try {
    const response = await fetch(publicAssetUrl('runtime-config.json'), { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const value = await response.json()
    if (value?.mode !== 'local-live' && value?.mode !== 'public-readonly') throw new Error('mode 无效')
    return {
      mode: value.mode,
      agentApi: value.agentApi === true,
      walletActions: value.walletActions === true,
    }
  } catch {
    return { mode: 'public-readonly', agentApi: false, walletActions: false }
  }
}

function renderRuntimeMode() {
  const local = runtime.mode === 'local-live'
  document.body.dataset.runtimeMode = runtime.mode
  elements.runtimeModeBadge.textContent = local ? 'Local live mode' : 'Public evidence mode'
  elements.runtimeModeBadge.className = `badge ${local ? 'badge-warning' : 'badge-success'}`
}

function formatDate(value) {
  const normalized = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  const date = new Date(normalized)
  if (!Number.isFinite(date.getTime())) return '未返回'
  return new Intl.DateTimeFormat('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function formatLocalTime(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '未知时间'
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

function formatMicroCcd(value) {
  return formatCcd(BigInt(value))
}

function byId(id) {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing UI element: ${id}`)
  return element
}

renderRuntimeMode()
render()
void loadLocalSessionHistory()
void loadServiceSpec()
loadEvidence()
loadJudgeJourney()
loadPublishedMarketSettlements()
loadAgentEvaluation()
