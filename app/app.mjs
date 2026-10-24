import {
  DEMO_AGENTS,
  DemoRuleError,
  closeBuyerReveal,
  closeCommitAndReveal,
  commitDemoBid,
  contractBalanceMicro,
  createDemoAuction,
  finalizeDemoAuction,
  formatCcd,
  revealDemoBid,
} from '/src/rules.mjs'
import {
  ConcordiumClientError,
  connectConcordiumWallet,
  shortAccountAddress,
  submitMarketInitialization,
  submitModuleDeployment,
} from '/src/concordium.mjs'

let auction = null
let activity = []
let walletConnection = null
let testnet = { status: null, deployment: null, initialization: null, pending: null, busy: false }

const elements = {
  auctionPhase: byId('auction-phase'),
  auctionId: byId('auction-id'),
  auctionDeadline: byId('auction-deadline'),
  walletButton: byId('wallet-button'),
  walletStatus: byId('wallet-status'),
  deployModuleButton: byId('deploy-module-button'),
  initContractButton: byId('init-contract-button'),
  readViewButton: byId('read-view-button'),
  testnetStatus: byId('testnet-status'),
  createButton: byId('create-button'),
  resetButton: byId('reset-button'),
  contractDeposit: byId('contract-deposit'),
  depositFill: byId('deposit-fill'),
  deadlineStatus: byId('deadline-status'),
  earlyFinalizeButton: byId('early-finalize-button'),
  deadlineButton: byId('deadline-button'),
  finalizeButton: byId('finalize-button'),
  inlineMessage: byId('inline-message'),
  resultShell: byId('result-shell'),
  activityLog: byId('activity-log'),
  evidenceSummary: byId('evidence-summary'),
  evidenceList: byId('evidence-list'),
}

elements.walletButton.addEventListener('click', async () => {
  if (walletConnection) return
  elements.walletButton.disabled = true
  elements.walletButton.textContent = '等待钱包…'
  try {
    walletConnection = await connectConcordiumWallet()
    const account = walletConnection.accounts[0]
    record(`已连接 Testnet 钱包 ${shortAccountAddress(account)}；本次未发送交易。`)
    await refreshTestnetStatus()
    setMessage('钱包与公共 Testnet 节点均已核验。可继续部署当前 Wasm；拍卖按钮仍只运行本地预览。', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const tone = error instanceof ConcordiumClientError ? 'warning' : 'error'
    setMessage(message, tone)
    record(`钱包连接未完成：${message}`, 'rejected')
  } finally {
    render()
  }
})

elements.deployModuleButton.addEventListener('click', () => {
  runTestnetAction('deploy', async () => {
    const hash = await submitModuleDeployment(walletConnection)
    testnet.pending = { kind: 'deploy', hash }
    setTestnetStatus(`钱包已返回部署交易哈希：${hash}\n正在等待 Testnet 最终确认。`, 'success')
    const verified = await waitForFinalization('/api/testnet/verify-deployment', hash)
    testnet.deployment = verified.deployment
    testnet.pending = null
    record(`当前 surplus_bid Wasm 已在 Testnet 部署：${shortHash(hash)}。`, 'chain')
    setTestnetStatus(`模块部署已最终确认。\nmodule ref: ${verified.deployment.moduleReference}\n${verified.deployment.explorerUrl}`, 'success')
  })
})

elements.initContractButton.addEventListener('click', () => {
  runTestnetAction('init', async () => {
    const hash = await submitMarketInitialization(walletConnection, testnet.status.moduleReference)
    testnet.pending = { kind: 'init', hash }
    setTestnetStatus(`钱包已返回初始化交易哈希：${hash}\n交易创建的是 0 CCD 空实例，正在等待最终确认。`, 'success')
    const verified = await waitForFinalization('/api/testnet/verify-init', hash)
    testnet.initialization = verified.initialization
    testnet.pending = null
    record(`Testnet 新实例 <${verified.initialization.address.index},${verified.initialization.address.subindex}> 已创建，并读回 view。`, 'chain')
    setTestnetStatus(formatInitializedStatus(verified.initialization, verified.view), 'success')
  })
})

elements.readViewButton.addEventListener('click', () => {
  runTestnetAction('view', async () => {
    const result = await requestJson('/api/testnet/view')
    setTestnetStatus(formatInitializedStatus(testnet.initialization, result), 'success')
    record(`从 Testnet 读回实例 <${testnet.initialization.address.index},${testnet.initialization.address.subindex}> 的 view 状态。`, 'chain')
  })
})

elements.createButton.addEventListener('click', () => {
  auction = createDemoAuction()
  activity = []
  record('Seller Agent 提交底价承诺和 2 CCD 保证金；底价仍隐藏。')
  setMessage('承诺期已开始。现在由两个 Buyer Agent 提交报价承诺。', 'success')
  render()
})

elements.resetButton.addEventListener('click', () => {
  auction = null
  activity = []
  setMessage('先创建拍卖并提交两份报价承诺。', 'neutral')
  render()
})

for (const button of document.querySelectorAll('[data-bid-agent]')) {
  button.addEventListener('click', () => {
    const agent = DEMO_AGENTS.find((candidate) => candidate.id === button.dataset.bidAgent)
    if (!agent || !auction) return
    runAction(() => {
      auction = commitDemoBid(auction, agent)
      record(`${agent.name} 提交 SHA-256 报价承诺和 2 CCD 保证金；金额仍隐藏。`)
      setMessage('承诺已记录。底价和报价要到各自揭示阶段才公开。', 'success')
    })
  })
}

elements.earlyFinalizeButton.addEventListener('click', () => {
  if (!auction) return
  runAction(() => {
    finalizeDemoAuction(auction)
  }, true)
})

elements.deadlineButton.addEventListener('click', () => {
  if (!auction) return
  runAction(() => {
    auction = closeCommitAndReveal(auction)
    record('承诺期结束：卖家先揭示底价 2 CCD。')
    for (const agent of DEMO_AGENTS) auction = revealDemoBid(auction, agent)
    record('买家揭示 4 CCD 与 6 CCD，并把托管金额补足到完整报价。')
    auction = closeBuyerReveal(auction)
    setMessage('买家揭示期结束，可以触发结算。', 'success')
  })
})

elements.finalizeButton.addEventListener('click', () => {
  if (!auction) return
  runAction(() => {
    auction = finalizeDemoAuction(auction)
    record('确定性规则选出 Buyer Agent B，并完成目标资金分配预览。')
    setMessage('结算完成。结果是本地规则预览，尚未发送 Testnet 交易。', 'success')
  })
})

function runAction(action, expectedFailure = false) {
  try {
    action()
    if (expectedFailure) setMessage('该失败路径没有按预期拒绝，需要检查。', 'error')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setMessage(message, error instanceof DemoRuleError ? 'warning' : 'error')
    record(`拒绝：${message}`, 'rejected')
  }
  render()
}

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
  const created = auction !== null
  const bidCount = auction?.bids.length ?? 0
  const finalized = auction?.phase === 'Finalized' || auction?.phase === 'NoSale'
  const commitOpen = auction?.phase === 'Commit'
  const readyToFinalize = auction?.phase === 'ReadyToFinalize'

  elements.createButton.disabled = created && !finalized
  elements.createButton.textContent = finalized ? '创建下一轮演示' : created ? '规则已固定' : '运行 Seller Agent 并创建'
  elements.auctionPhase.textContent = auction?.phase ?? 'Draft'
  elements.auctionId.textContent = auction?.id ?? '创建后生成'
  elements.auctionDeadline.textContent = auction ? formatDate(auction.commitEnd) : '创建后生成'
  if (walletConnection) {
    elements.walletButton.textContent = `已连接 ${shortAccountAddress(walletConnection.accounts[0])}`
    elements.walletStatus.textContent = `Testnet · ${shortAccountAddress(walletConnection.accounts[0])}`
  } else {
    elements.walletButton.disabled = false
    elements.walletButton.textContent = '连接钱包'
    elements.walletStatus.textContent = '未连接'
  }
  renderTestnet()
  elements.deadlineStatus.textContent = readyToFinalize || finalized ? '揭示结束' : '承诺期'

  for (const button of document.querySelectorAll('[data-bid-agent]')) {
    const hasBid = auction?.bids.some((bid) => bid.agentId === button.dataset.bidAgent) ?? false
    button.disabled = !created || !commitOpen || hasBid
    button.textContent = hasBid ? '承诺已提交' : '提交承诺 + 2 CCD'
    document.querySelector(`[data-agent-card="${button.dataset.bidAgent}"]`)?.classList.toggle('complete', hasBid)
  }

  const balanceMicro = contractBalanceMicro(auction)
  elements.contractDeposit.textContent = `${formatCcd(balanceMicro)} CCD`
  elements.depositFill.style.width = `${Math.min(Number(balanceMicro / 100_000n), 100)}%`

  elements.earlyFinalizeButton.disabled = !created || finalized || readyToFinalize
  elements.deadlineButton.disabled = !commitOpen || bidCount < 2
  elements.finalizeButton.disabled = !readyToFinalize
  elements.resultShell.hidden = auction?.phase !== 'Finalized'

  if (auction?.phase === 'Finalized') {
    const buyerA = auction.settlement.allocations.find((item) => item.agentId === 'buyer-a')
    const buyerB = auction.settlement.allocations.find((item) => item.agentId === 'buyer-b')
    const winner = auction.settlement.allocations.find((item) => item.won)
    byId('winner-mark').textContent = winner.name.slice(-1)
    byId('winner-name').textContent = winner.name
    byId('winner-price').textContent = `成交价 ${formatCcd(winner.priceMicro)} CCD`
    byId('result-reserve').textContent = `底价 ${formatCcd(auction.reserveMicro)}`
    byId('result-surplus').textContent = `交易剩余 ${formatCcd(winner.surplusMicro)} CCD`
    byId('result-bid').textContent = `报价 ${formatCcd(winner.amountMicro)}`
    byId('buyer-a-refund').textContent = `${formatCcd(buyerA.refundMicro)} CCD`
    byId('buyer-b-refund').textContent = `${formatCcd(buyerB.refundMicro)} CCD`
    byId('seller-receives').textContent = `${formatCcd(auction.settlement.sellerReceivesMicro)} CCD`
    byId('platform-receives').textContent = `${formatCcd(auction.settlement.platformReceivesMicro)} CCD`
    byId('conservation').textContent = `12 = 4 + 1.8 + 3.8 + 0.4 + 2（卖家保证金退回）CCD`
  }

  updateProgress({ created, bidCount, readyToFinalize, finalized })
  renderActivity()
}

function renderTestnet() {
  const connected = walletConnection !== null
  const hasStatus = testnet.status !== null
  const hasDeployment = testnet.deployment !== null
  const hasInitialization = testnet.initialization !== null
  elements.deployModuleButton.disabled = !connected || !hasStatus || testnet.busy || hasDeployment || testnet.pending !== null
  elements.initContractButton.disabled = !connected || !hasStatus || !hasDeployment || testnet.busy || hasInitialization || testnet.pending !== null
  elements.readViewButton.disabled = !connected || !hasInitialization || testnet.busy || testnet.pending !== null
  if (testnet.busy) {
    const label = testnet.pending?.kind === 'init' ? '等待初始化确认…' : testnet.pending?.kind === 'deploy' ? '等待部署确认…' : '正在准备…'
    elements.deployModuleButton.textContent = label
  } else {
    elements.deployModuleButton.textContent = hasDeployment ? '模块已部署' : '1. 部署模块'
  }
  elements.initContractButton.textContent = hasInitialization ? '实例已创建' : '2. 创建 0 CCD 实例'
}

async function refreshTestnetStatus() {
  const status = await requestJson('/api/testnet/status')
  testnet.status = status
  testnet.deployment = status.deployment
  testnet.initialization = status.initialization
  setTestnetStatus(
    `公共节点已确认 Concordium Testnet。\n当前 Wasm module ref: ${status.moduleReference}\n下一步可由已连接账户请求部署。`,
    'success',
  )
}

async function waitForFinalization(endpoint, hash) {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const result = await requestJson(endpoint, {
      method: 'POST',
      body: { hash, sender: walletConnection.accounts[0] },
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
  const timeout = setTimeout(() => controller.abort(), 15_000)
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
      throw new ConcordiumClientError('NETWORK_TIMEOUT', '公共 Testnet 节点请求超时。请检查网络后重试；页面未请求钱包签名。')
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
    `0 CCD 实例 ${address} 已最终确认。`,
    `view phase: ${phase}; contract balance: ${view.contractBalance} CCD`,
    initialization.contractUrl,
  ].join('\n')
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

function updateProgress({ created, bidCount, readyToFinalize, finalized }) {
  document.querySelector('[data-progress="create"]')?.classList.toggle('active', created)
  document.querySelector('[data-progress="bid"]')?.classList.toggle('active', bidCount === 2)
  document.querySelector('[data-progress="settle"]')?.classList.toggle('active', readyToFinalize || finalized)
  document.querySelector('[data-progress="evidence"]')?.classList.toggle('active', finalized)
}

function record(message, status = 'placeholder') {
  activity.unshift({ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), message, status })
}

function renderActivity() {
  elements.activityLog.replaceChildren()
  const entries = activity.length
    ? activity
    : [{ time: '等待', message: '创建演示拍卖后，步骤会在这里串起来。', status: 'placeholder' }]

  for (const entry of entries) {
    const item = document.createElement('li')
    const time = document.createElement('time')
    const message = document.createElement('span')
    const status = document.createElement('em')
    time.textContent = entry.time
    message.textContent = entry.message
    status.textContent = entry.status
    item.append(time, message, status)
    elements.activityLog.append(item)
  }
}

function setMessage(message, tone) {
  elements.inlineMessage.textContent = message
  elements.inlineMessage.dataset.tone = tone
}

async function loadEvidence() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4_000)
  try {
    const response = await fetch('/docs/evidence/auction-testnet.json', {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const evidence = await response.json()
    renderEvidence(evidence)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    elements.evidenceSummary.textContent = `证据读取失败：${detail}`
    elements.evidenceSummary.dataset.tone = 'error'
  } finally {
    clearTimeout(timeout)
  }
}

function renderEvidence(evidence) {
  const address = `<${evidence.address.index},${evidence.address.subindex}>`
  elements.evidenceSummary.textContent = `${evidence.network} · 合约 ${address} · 单买家旧规则已结算，余额归零`
  elements.evidenceList.replaceChildren()

  const labels = new Map([
    ['deploy', '部署模块'],
    ['init', '创建拍卖'],
    ['bidA', '买家 A 报价'],
    ['finalizeSingle', '单买家结算'],
  ])

  for (const item of evidence.done) {
    const row = document.createElement('a')
    row.href = `https://ccdexplorer.io/testnet/transaction/${item.hash}`
    row.target = '_blank'
    row.rel = 'noreferrer'
    const label = document.createElement('span')
    const hash = document.createElement('code')
    const status = document.createElement('strong')
    label.textContent = labels.get(item.step) ?? item.step
    hash.textContent = `${item.hash.slice(0, 10)}…${item.hash.slice(-6)}`
    status.textContent = item.finalized ? 'Finalized ↗' : 'Unconfirmed'
    row.append(label, hash, status)
    elements.evidenceList.append(row)
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function byId(id) {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing UI element: ${id}`)
  return element
}

render()
loadEvidence()
