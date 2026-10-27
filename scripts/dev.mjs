import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AccountAddress,
  BlockHash,
  CcdAmount,
  ContractAddress,
  ContractName,
  Energy,
  EntrypointName,
  Parameter,
  ReceiveName,
  ReturnValue,
  TransactionHash,
  deserializeReceiveReturnValue,
} from '@concordium/web-sdk'
import { ConcordiumGRPCNodeClient, credentials } from '@concordium/web-sdk/nodejs'
import { decideNextReserve } from '../src/decision.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
loadLocalEnv(resolve(repoRoot, '.env'))
const host = '127.0.0.1'
const port = parsePort(process.env.PORT)
const testnetGenesis = '4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796'
const contractName = ContractName.fromString('surplus_bid')
const platformAddress = '4aWGujk9C4b1wF2FPPaVaxVkXA6cQV82kewgzRnK9GQnBSDjP4'
const protocolVersion = 'shared-reveal-v2'
const sessionHistoryPath = resolve(repoRoot, 'runtime', 'session-activity.json')
const testnetClient = new ConcordiumGRPCNodeClient(
  'grpc.testnet.concordium.com', 20_000, credentials.createSsl(), { timeout: 10_000 },
)

const publicRoots = new Map([
  ['/app/', resolve(repoRoot, 'app')],
  ['/src/', resolve(repoRoot, 'src')],
  ['/evidence/', resolve(repoRoot, 'public', 'evidence')],
  ['/vendor/', resolve(repoRoot, 'node_modules', '@concordium', 'web-sdk', 'lib', 'min')],
  ['/artifacts/', resolve(repoRoot, 'contracts', 'sealed-auction')],
])

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.v1', 'application/wasm'],
  ['.bin', 'application/octet-stream'],
])

const verified = loadRecordedVerification()

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${host}:${port}`)
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true, service: 'surplus-bid-walking-skeleton' })
      return
    }
    if (request.method === 'GET' && url.pathname === '/runtime-config.json') {
      sendJson(response, 200, { mode: 'local-live', agentApi: true, walletActions: true })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/agent/decide') {
      const body = await readJson(request)
      const decision = await decideNextReserve(body.taskId, body.input)
      sendJson(response, 200, { ok: true, decision })
      return
    }
    if (url.pathname.startsWith('/api/session/')) {
      await handleSessionApi(request, response, url)
      return
    }
    if (url.pathname.startsWith('/api/testnet/')) {
      await handleTestnetApi(request, response, url)
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { ok: false, error: 'Only GET and HEAD are supported.' })
      return
    }
    const filePath = resolvePublicFile(url.pathname)
    if (!filePath) {
      sendJson(response, 404, { ok: false, error: 'Page not found.' })
      return
    }
    let stats
    try {
      stats = statSync(filePath)
    } catch {
      sendJson(response, 404, { ok: false, error: 'File not found. Run pnpm check to build the contract artifact.' })
      return
    }
    if (!stats.isFile()) {
      sendJson(response, 404, { ok: false, error: 'File not found.' })
      return
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': mimeTypes.get(extname(filePath)) ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    const stream = createReadStream(filePath)
    stream.on('error', (error) => {
      console.error(`Could not read ${filePath}:`, error.message)
      if (!response.headersSent) sendJson(response, 500, { ok: false, error: 'Could not read file.' })
      else response.destroy(error)
    })
    stream.pipe(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Request failed:', message)
    if (!response.headersSent) sendJson(response, 400, { ok: false, error: message })
    else response.destroy()
  }
})

server.requestTimeout = 30_000
server.headersTimeout = 10_000
server.on('error', (error) => {
  console.error(`Could not start SurplusBid: ${error.message}`)
  process.exitCode = 1
})
server.listen(port, host, () => console.log(`SurplusBid walking skeleton: http://${host}:${port}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))

async function handleSessionApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/session/history') {
    sendJson(response, 200, { ok: true, ...readSessionHistory() })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/session/activity') {
    const entry = validateActivityEntry(await readJson(request))
    const history = readSessionHistory()
    history.entries.unshift({ kind: 'activity', ...entry })
    history.entries = history.entries.slice(0, 10)
    writeSessionHistory(history)
    sendJson(response, 200, { ok: true, count: history.entries.length })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/session/evidence') {
    const entry = validateEvidenceEntry(await readJson(request))
    const history = readSessionHistory()
    history.entries = [{ kind: 'evidence', ...entry }, ...history.entries.filter((item) => item.kind !== 'evidence' || item.hash !== entry.hash)].slice(0, 10)
    writeSessionHistory(history)
    sendJson(response, 200, { ok: true, count: history.entries.length })
    return
  }
  sendJson(response, 405, { ok: false, error: 'Unsupported local session endpoint.' })
}

function readSessionHistory() {
  try {
    const parsed = JSON.parse(readFileSync(sessionHistoryPath, 'utf8'))
    return {
      version: 1,
      entries: Array.isArray(parsed.entries) ? parsed.entries.slice(0, 10) : [],
    }
  } catch {
    return { version: 1, entries: [] }
  }
}

function writeSessionHistory(history) {
  mkdirSync(resolve(repoRoot, 'runtime'), { recursive: true })
  const temporaryPath = `${sessionHistoryPath}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(history, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporaryPath, sessionHistoryPath)
}

function validateActivityEntry(value) {
  if (!value || typeof value !== 'object' || typeof value.message !== 'string' || typeof value.status !== 'string') {
    throw new Error('本地操作记录格式无效。')
  }
  if (value.message.length === 0 || value.message.length > 500 || !/^[a-z_]+$/i.test(value.status) || value.status.length > 32) {
    throw new Error('本地操作记录内容无效。')
  }
  return { at: new Date().toISOString(), message: value.message, status: value.status }
}

function validateEvidenceEntry(value) {
  if (!value || typeof value !== 'object' || typeof value.label !== 'string' || typeof value.hash !== 'string' || !value.instance) {
    throw new Error('本地链上证据格式无效。')
  }
  const hash = value.hash.toLowerCase()
  const expectedUrl = `https://ccdexplorer.io/testnet/transaction/${hash}`
  const index = String(value.instance.index)
  const subindex = String(value.instance.subindex)
  if (
    value.label.length === 0 || value.label.length > 100 || !/^[0-9a-f]{64}$/.test(hash) || value.explorerUrl !== expectedUrl ||
    !/^\d+$/.test(index) || !/^\d+$/.test(subindex)
  ) {
    throw new Error('本地链上证据内容无效。')
  }
  return { at: new Date().toISOString(), label: value.label, hash, explorerUrl: expectedUrl, instance: { index, subindex } }
}

async function handleTestnetApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/testnet/status') {
    const artifactStatus = inspectArtifacts()
    const consensus = await getTestnetConsensus()
    const view = artifactStatus.ready && verified.initialization ? await readInitializedState() : null
    if (view) restoreObservedRound(view)
    sendJson(response, 200, {
      ok: true,
      network: 'Concordium Testnet',
      moduleReference: artifactStatus.artifact?.moduleReference ?? null,
      contractReady: artifactStatus.ready,
      contractIssue: artifactStatus.issue,
      protocolVersion,
      contractName: 'surplus_bid',
      platformAddress,
      lastFinalizedBlock: String(consensus.lastFinalizedBlock),
      deployment: verified.deployment,
      initialization: verified.initialization,
      round: verified.round,
      view,
    })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/testnet/verify-deployment') {
    sendJson(response, 200, { ok: true, ...await verifyDeployment(await readJson(request)) })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/testnet/verify-init') {
    sendJson(response, 200, { ok: true, ...await verifyInitialization(await readJson(request)) })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/testnet/verify-start-round') {
    sendJson(response, 200, { ok: true, ...await verifyStartRound(await readJson(request)) })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/testnet/verify-cancel-round') {
    sendJson(response, 200, { ok: true, ...await verifyCancelRound(await readJson(request)) })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/testnet/verify-update') {
    sendJson(response, 200, { ok: true, ...await verifyContractUpdate(await readJson(request)) })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/testnet/view') {
    sendJson(response, 200, { ok: true, ...await readInitializedState() })
    return
  }
  sendJson(response, 404, { ok: false, error: 'Testnet endpoint not found.' })
}

async function verifyDeployment({ hash, sender }) {
  const artifact = loadArtifacts()
  const senderAddress = parseAccount(sender)
  const outcome = await finalizedOutcome(hash)
  if (!outcome) return { final: false }
  const summary = outcome.summary
  if (summary.transactionType === 'failed') {
    throw new Error(`模块部署被链拒绝（${transactionRejectName(summary.rejectReason)}），未产生模块引用。`)
  }
  if (summary.type !== 'accountTransaction' || AccountAddress.toBase58(summary.sender) !== AccountAddress.toBase58(senderAddress)) {
    throw new Error('最终交易的签名账户与页面连接账户不一致。')
  }
  if (summary.transactionType !== 'deployModule' || summary.moduleDeployed?.contents !== artifact.moduleReference) {
    throw new Error('最终交易不是当前 surplus_bid Wasm 的模块部署。')
  }
  verified.deployment = {
    hash,
    moduleReference: artifact.moduleReference,
    blockHash: String(outcome.blockHash),
    explorerUrl: `https://ccdexplorer.io/testnet/transaction/${hash}`,
  }
  return { final: true, deployment: verified.deployment }
}

async function verifyInitialization({ hash, sender }) {
  const artifact = loadArtifacts()
  const senderAddress = parseAccount(sender)
  const outcome = await finalizedOutcome(hash)
  if (!outcome) return { final: false }
  const summary = outcome.summary
  if (summary.transactionType === 'failed') {
    throw new Error(`0 CCD 合约初始化被链拒绝（${transactionRejectName(summary.rejectReason)}），未创建实例。`)
  }
  if (summary.type !== 'accountTransaction' || AccountAddress.toBase58(summary.sender) !== AccountAddress.toBase58(senderAddress)) {
    throw new Error('最终交易的签名账户与页面连接账户不一致。')
  }
  if (summary.transactionType !== 'initContract') throw new Error('最终交易不是合约初始化。')
  const initialized = summary.contractInitialized
  if (
    !initialized ||
    String(initialized.ref) !== artifact.moduleReference ||
    String(initialized.initName) !== 'init_surplus_bid'
  ) {
    throw new Error('初始化交易没有引用当前 surplus_bid 模块。')
  }
  if (CcdAmount.toMicroCcd(initialized.amount).toFixed(0) !== '0') {
    throw new Error('本轮验证只允许 0 CCD 的合约初始化。')
  }
  const address = { index: String(initialized.address.index), subindex: String(initialized.address.subindex) }
  verified.initialization = {
    hash,
    sender: AccountAddress.toBase58(senderAddress),
    address,
    blockHash: String(outcome.blockHash),
    explorerUrl: `https://ccdexplorer.io/testnet/transaction/${hash}`,
    contractUrl: `https://ccdexplorer.io/testnet/contract/${address.index}/${address.subindex}`,
  }
  return { final: true, initialization: verified.initialization, view: await readInitializedState() }
}

async function verifyStartRound({ hash, sender, plan }) {
  if (!verified.initialization) throw new Error('没有已核验的 surplus_bid 实例。')
  const senderAddress = parseAccount(sender)
  const expectedSeller = parseAccount(verified.initialization.sender)
  if (AccountAddress.toBase58(senderAddress) !== AccountAddress.toBase58(expectedSeller)) {
    throw new Error('只有当前实例的初始化签名账户可以开始本轮。')
  }
  const expected = validatePublicRoundPlan(plan, verified.initialization)
  const outcome = await finalizedOutcome(hash)
  if (!outcome) return { final: false }
  const summary = outcome.summary
  if (summary.type !== 'accountTransaction' || AccountAddress.toBase58(summary.sender) !== AccountAddress.toBase58(senderAddress)) {
    throw new Error('最终交易的签名账户与页面连接账户不一致。')
  }
  if (summary.transactionType !== 'update') throw new Error('最终交易不是合约更新。')
  const update = summary.events?.find((event) => event.tag === 'Updated')
  if (
    !update ||
    String(update.address?.index) !== verified.initialization.address.index ||
    String(update.address?.subindex) !== verified.initialization.address.subindex ||
    String(update.receiveName) !== 'surplus_bid.start_round' ||
    CcdAmount.toMicroCcd(update.amount).toFixed(0) !== '2000000'
  ) {
    throw new Error('最终交易不是向当前实例支付 2 CCD 的 surplus_bid.start_round 调用。')
  }
  const view = await readInitializedState()
  if (variantName(view.state.phase) !== 'Commit') throw new Error('链上 view 未进入 Commit 阶段。')
  if (String(view.state.total_deposited) !== '2000000' || view.contractBalanceMicroCcd !== '2000000') {
    throw new Error('链上合约余额与 2 CCD 卖家保证金不一致。')
  }
  const actualRound = optionValue(view.state.round)
  if (!actualRound) throw new Error('链上 view 未记录本轮参数。')
  if (
    normalizeTimestamp(actualRound.commit_end) !== expected.commitEnd ||
    normalizeTimestamp(actualRound.reveal_end) !== expected.revealEnd ||
    Number(actualRound.max_bids) !== expected.maxBids ||
    !equalNumberArrays(actualRound.reserve_commitment, expected.reserveCommitment)
  ) {
    throw new Error('链上记录的本轮参数与钱包提交参数不一致。')
  }
  verified.round = {
    hash,
    roundId: '1',
    commitEnd: expected.commitEnd,
    revealEnd: expected.revealEnd,
    maxBids: expected.maxBids,
    reserveCommitment: expected.reserveCommitment,
    blockHash: String(outcome.blockHash),
    explorerUrl: `https://ccdexplorer.io/testnet/transaction/${hash}`,
  }
  return { final: true, round: verified.round, view }
}

async function verifyCancelRound({ hash, sender }) {
  if (!verified.initialization) throw new Error('没有已核验的 surplus_bid 实例。')
  const senderAddress = parseAccount(sender)
  const outcome = await finalizedOutcome(hash)
  if (!outcome) return { final: false }
  const summary = outcome.summary
  if (summary.transactionType === 'failed') {
    throw new Error(`cancel 被合约拒绝（${contractRejectName(summary.rejectReason?.rejectReason)}），未发送退款。`)
  }
  if (summary.type !== 'accountTransaction' || AccountAddress.toBase58(summary.sender) !== AccountAddress.toBase58(senderAddress)) {
    throw new Error('最终交易的签名账户与页面连接账户不一致。')
  }
  const update = summary.events?.find((event) => event.tag === 'Updated')
  if (
    summary.transactionType !== 'update' || !update ||
    String(update.address?.index) !== verified.initialization.address.index ||
    String(update.address?.subindex) !== verified.initialization.address.subindex ||
    String(update.receiveName) !== 'surplus_bid.cancel' ||
    CcdAmount.toMicroCcd(update.amount).toFixed(0) !== '0'
  ) throw new Error('最终交易不是当前实例的 0 CCD surplus_bid.cancel 调用。')
  const view = await readInitializedState()
  const phase = variantName(view.state.phase)
  if (!['NoSale', 'Cancelled'].includes(phase) || view.contractBalanceMicroCcd !== '0') {
    throw new Error('cancel 后链上状态或余额不符合退款规则。')
  }
  restoreObservedRound(view)
  verified.round = {
    ...verified.round,
    hash,
    phase,
    explorerUrl: `https://ccdexplorer.io/testnet/transaction/${hash}`,
  }
  return { final: true, round: verified.round, view }
}

async function verifyContractUpdate({ hash, sender, receiveName, amountMicroCcd, expected = {} }) {
  if (!verified.initialization) throw new Error('没有已核验的 surplus_bid 实例。')
  if (typeof receiveName !== 'string' || !receiveName.startsWith('surplus_bid.')) throw new Error('合约入口无效。')
  if (!/^\d+$/.test(String(amountMicroCcd))) throw new Error('调用金额无效。')
  const senderAddress = parseAccount(sender)
  const outcome = await finalizedOutcome(hash)
  if (!outcome) return { final: false }
  const summary = outcome.summary
  if (summary.transactionType === 'failed') throw new Error(`${receiveName} 被合约拒绝（${contractRejectName(summary.rejectReason?.rejectReason)}），未发生业务转账。`)
  const update = summary.events?.find((event) => event.tag === 'Updated')
  if (
    summary.type !== 'accountTransaction' ||
    AccountAddress.toBase58(summary.sender) !== AccountAddress.toBase58(senderAddress) ||
    summary.transactionType !== 'update' || !update ||
    String(update.address?.index) !== verified.initialization.address.index ||
    String(update.address?.subindex) !== verified.initialization.address.subindex ||
    String(update.receiveName) !== receiveName ||
    CcdAmount.toMicroCcd(update.amount).toFixed(0) !== String(amountMicroCcd)
  ) throw new Error('最终交易与页面请求的合约入口、实例或金额不一致。')
  const view = await readInitializedState()
  verifyUpdateState(receiveName, view, sender, expected)
  restoreObservedRound(view)
  return {
    final: true,
    view,
    round: verified.round,
    explorerUrl: `https://ccdexplorer.io/testnet/transaction/${hash}`,
    transactionHash: hash,
  }
}

function verifyUpdateState(receiveName, view, sender, expected) {
  const state = view.state
  const round = optionValue(state.round)
  if (!round) throw new Error('链上 view 没有当前 round；无法证明此更新属于同一轮。')
  if (variantName(state.phase) === 'Idle') throw new Error('链上 view 意外回到 Idle；无法证明此更新属于当前 round。')
  const bids = Array.isArray(state.bids) ? state.bids : []
  const senderAddress = AccountAddress.toBase58(parseAccount(sender))

  if (receiveName === 'surplus_bid.commit_bid') {
    if (variantName(state.phase) !== 'Commit') throw new Error('commit_bid 后链上 view 未保持 Commit 阶段。')
    const bid = bids.find((item) => sameAccountAddress(item.bidder, senderAddress))
    if (!bid) throw new Error('commit_bid 后链上 view 未记录当前买家。')
    if (!sameAccountAddress(expected.bidder, senderAddress)) throw new Error('页面承诺中的买家与交易签名账户不一致。')
    if (!equalNumberArrays(bid.commitment, expected.commitment)) throw new Error('链上承诺哈希与页面提交值不一致。')
    if (String(bid.escrow) !== '2000000' || optionValue(bid.revealed_bid) !== null) {
      throw new Error('commit_bid 后链上保证金或揭示状态不符合规则。')
    }
    if (String(state.total_deposited) !== String(2_000_000 * (bids.length + 1))) {
      throw new Error('commit_bid 后链上托管总额与卖家及买家保证金不一致。')
    }
    return
  }

  if (receiveName === 'surplus_bid.reveal_reserve') {
    if (variantName(state.phase) !== 'Reveal') throw new Error('reveal_reserve 后链上 view 未进入 Reveal。')
    if (String(optionValue(state.reserve)) !== String(expected.reserveMicroCcd)) {
      throw new Error('链上揭示的底价与页面承诺值不一致。')
    }
    return
  }

  if (receiveName === 'surplus_bid.reveal_bid') {
    if (variantName(state.phase) !== 'Reveal') throw new Error('reveal_bid 后链上 view 未保持 Reveal。')
    const bid = bids.find((item) => sameAccountAddress(item.bidder, senderAddress))
    if (!bid || !sameAccountAddress(expected.bidder, senderAddress)) {
      throw new Error('reveal_bid 的签名账户与同一 round 的买家承诺不一致。')
    }
    if (String(optionValue(bid.revealed_bid)) !== String(expected.bidMicroCcd) || String(bid.escrow) !== String(expected.bidMicroCcd)) {
      throw new Error('链上揭示报价或对应托管额与页面值不一致。')
    }
    return
  }

  if (receiveName === 'surplus_bid.finalize') {
    if (expected.requireSettlement !== true) throw new Error('结算缺少页面的明确核验要求。')
    const phase = variantName(state.phase)
    if (!['Settled', 'NoSale'].includes(phase) || view.contractBalanceMicroCcd !== '0') {
      throw new Error('finalize 后链上状态或合约余额不符合结算规则。')
    }
    const allocations = Array.isArray(state.allocations) ? state.allocations : []
    const winnerCount = allocations.filter((item) => item.won === true).length
    if (allocations.length !== bids.length || (phase === 'Settled' && winnerCount !== 1) || (phase === 'NoSale' && winnerCount !== 0)) {
      throw new Error('finalize 后链上赢家分配与同一 round 的报价记录不一致。')
    }
    return
  }

  throw new Error(`没有 ${receiveName} 的状态核验规则。`)
}

async function readInitializedState() {
  if (!verified.initialization) throw new Error('请先完成当前页面发起的 0 CCD 合约初始化。')
  const artifact = loadArtifacts()
  const consensus = await getTestnetConsensus()
  const blockHash = consensus.lastFinalizedBlock
  const address = ContractAddress.create(BigInt(verified.initialization.address.index), BigInt(verified.initialization.address.subindex))
  const invoker = AccountAddress.fromBase58(verified.initialization.sender)
  const [instance, invoked] = await Promise.all([
    testnetClient.getInstanceInfo(address, blockHash),
    testnetClient.invokeContract({
      invoker,
      contract: address,
      method: ReceiveName.fromString('surplus_bid.view'),
      parameter: Parameter.empty(),
      energy: Energy.create(100_000),
    }, BlockHash.fromHexString(String(blockHash))),
  ])
  if (String(instance.sourceModule) !== artifact.moduleReference) throw new Error('读取到的实例不属于当前 surplus_bid 模块。')
  if (invoked.tag !== 'success' || !invoked.returnValue) throw new Error('Testnet 对 surplus_bid.view 的只读调用失败。')
  const bytes = ReturnValue.toBuffer(invoked.returnValue)
  const schema = artifact.schema.buffer.slice(artifact.schema.byteOffset, artifact.schema.byteOffset + artifact.schema.byteLength)
  const state = deserializeReceiveReturnValue(bytes.slice().buffer, schema, contractName, EntrypointName.fromString('view'))
  return {
    blockHash: String(blockHash),
    state,
    contractBalance: String(instance.amount),
    contractBalanceMicroCcd: CcdAmount.toMicroCcd(instance.amount).toFixed(0),
  }
}

async function finalizedOutcome(hash) {
  const status = await testnetClient.getBlockItemStatus(TransactionHash.fromHexString(requireTransactionHash(hash)))
  return status.status === 'finalized' ? status.outcome : null
}

async function getTestnetConsensus() {
  const consensus = await testnetClient.getConsensusStatus()
  if (String(consensus.genesisBlock) !== testnetGenesis) throw new Error('公共节点返回的网络不是 Concordium Testnet。')
  return consensus
}

function loadArtifacts() {
  const module = readFileSync(resolve(repoRoot, 'contracts', 'sealed-auction', 'module.wasm.v1'))
  const schema = readFileSync(resolve(repoRoot, 'contracts', 'sealed-auction', 'schema.bin'))
  const moduleReference = createHash('sha256').update(module).digest('hex')
  const manifestPath = resolve(repoRoot, 'contracts', 'sealed-auction', 'artifact-manifest.json')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new Error('当前 Wasm/schema 没有 shared-reveal-v2 构建清单。请先运行 ./scripts/check-contract.sh 生成并验证新合约，旧顺序揭示 artifact 不可用于开始新轮次。')
  }
  if (manifest.protocolVersion !== protocolVersion || manifest.moduleReference !== moduleReference) {
    throw new Error('当前 Wasm/schema 与 shared-reveal-v2 构建清单不一致。请重新运行 ./scripts/check-contract.sh；不要用旧 schema 发起 start_round。')
  }
  return { moduleReference, schema }
}

function inspectArtifacts() {
  try {
    return { ready: true, artifact: loadArtifacts(), issue: null }
  } catch (error) {
    return { ready: false, artifact: null, issue: error instanceof Error ? error.message : String(error) }
  }
}

function loadRecordedVerification() {
  try {
    const artifact = loadArtifacts()
    const evidence = JSON.parse(readFileSync(resolve(repoRoot, 'public/evidence/sealed-auction-testnet.json'), 'utf8'))
    if (evidence.module?.reference !== artifact.moduleReference) throw new Error('记录的模块引用与当前 Wasm 不一致。')
    const current = evidence.currentCoreRound
    const address = current?.instance?.address ?? evidence.instance?.address
    const initialization = current?.transactions?.initialization ?? evidence.instance?.initialization
    const sender = current?.instance?.seller ?? evidence.instance?.viewAtInitializationBlock?.seller
    const contractUrl = current?.instance?.contractUrl ?? evidence.instance?.contractUrl
    if (!address || !initialization || typeof sender !== 'string') throw new Error('记录的实例信息不完整。')
    parseAccount(sender)
    return {
      deployment: {
        hash: evidence.module.deployment.hash,
        moduleReference: artifact.moduleReference,
        blockHash: evidence.module.deployment.blockHash,
        explorerUrl: evidence.module.deployment.explorerUrl,
      },
      initialization: {
        hash: initialization.hash,
        sender,
        address: { index: String(address.index), subindex: String(address.subindex) },
        blockHash: initialization.blockHash ?? null,
        explorerUrl: initialization.explorerUrl,
        contractUrl,
      },
      round: null,
    }
  } catch (error) {
    console.error(`Could not restore recorded Testnet instance: ${error instanceof Error ? error.message : String(error)}`)
    return { deployment: null, initialization: null, round: null }
  }
}

function validatePublicRoundPlan(plan, initialization) {
  if (!plan || typeof plan !== 'object' || !plan.contract || !plan.parameters) {
    throw new Error('缺少本轮公开参数。')
  }
  if (
    String(plan.contract.index) !== initialization.address.index ||
    String(plan.contract.subindex) !== initialization.address.subindex ||
    plan.seller !== initialization.sender
  ) {
    throw new Error('本轮参数没有绑定到当前实例和卖家。')
  }
  const parameters = plan.parameters
  const reserveCommitment = parameters.reserve_commitment
  const commitEnd = normalizeTimestamp(parameters.commit_end)
  const revealEnd = normalizeTimestamp(parameters.reveal_end)
  const maxBids = Number(parameters.max_bids)
  if (!commitEnd || !revealEnd) {
    throw new Error('本轮截止时间格式无效。')
  }
  if (!(BigInt(commitEnd) < BigInt(revealEnd))) {
    throw new Error('本轮截止时间顺序无效。')
  }
  if (maxBids < 1 || maxBids > 16 || !Number.isInteger(maxBids)) throw new Error('本轮最大报价数量无效。')
  if (!Array.isArray(reserveCommitment) || reserveCommitment.length !== 32 || reserveCommitment.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error('底价承诺必须是 32 字节。')
  }
  return { commitEnd, revealEnd, maxBids, reserveCommitment }
}

function restoreObservedRound(view) {
  const actual = optionValue(view.state.round)
  if (!actual) {
    verified.round = null
    return
  }
  verified.round = {
    ...verified.round,
    hash: verified.round?.hash ?? null,
    roundId: '1',
    phase: variantName(view.state.phase),
    commitEnd: normalizeTimestamp(actual.commit_end),
    revealEnd: normalizeTimestamp(actual.reveal_end),
    maxBids: Number(actual.max_bids),
    reserveCommitment: Array.from(actual.reserve_commitment, Number),
    explorerUrl: verified.round?.explorerUrl ?? verified.initialization.contractUrl,
  }
}

function normalizeTimestamp(value) {
  if (typeof value === 'bigint') return value.toString()
  const text = String(value)
  if (/^\d+$/.test(text)) return text
  const milliseconds = Date.parse(text)
  return Number.isFinite(milliseconds) ? String(milliseconds) : null
}

function contractRejectName(code) {
  const names = new Map([
    [-1, 'Parse'], [-2, 'InvalidRules'], [-3, 'OnlyAccount'], [-4, 'Unauthorized'],
    [-5, 'WrongPhase'], [-6, 'WrongTime'], [-7, 'WrongDeposit'], [-8, 'SellerCannotBid'],
    [-9, 'BidLimit'], [-10, 'DuplicateBid'], [-11, 'MissingCommitment'], [-12, 'AlreadyRevealed'],
    [-13, 'CommitmentMismatch'], [-14, 'InvalidFeeRecipient'], [-15, 'Arithmetic'],
    [-16, 'TransferFailed'], [-17, 'BalanceMismatch'],
  ])
  return names.get(Number(code)) ?? `合约拒绝码 ${String(code)}`
}

function transactionRejectName(reason) {
  const contractCode = reason?.rejectReason
  if (typeof contractCode === 'number' || (typeof contractCode === 'string' && /^-?\d+$/.test(contractCode))) {
    return contractRejectName(contractCode)
  }
  if (reason && typeof reason === 'object') {
    const name = Object.keys(reason)[0]
    if (name) return `链原生拒绝：${name}`
  }
  return '链未返回可识别的拒绝原因'
}

function variantName(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return Object.keys(value)[0] ?? ''
  return ''
}

function optionValue(value) {
  if (!value || typeof value !== 'object' || variantName(value) !== 'Some') return null
  const contents = value.Some
  return Array.isArray(contents) ? contents[0] : contents
}

function equalNumberArrays(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => Number(value) === Number(right[index]))
}

function sameAccountAddress(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  try {
    return AccountAddress.toBase58(parseAccount(left)) === AccountAddress.toBase58(parseAccount(right))
  } catch {
    return false
  }
}

function parseAccount(value) {
  if (typeof value !== 'string') throw new Error('缺少发送账户。')
  try { return AccountAddress.fromBase58(value) } catch { throw new Error('发送账户格式无效。') }
}

function requireTransactionHash(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error('钱包没有返回有效的交易哈希；请在钱包活动中核对原请求，勿重复发送。')
  }
  return value
}

function parsePort(value) {
  if (value === undefined) return 4173
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    console.error('PORT must be an integer between 1 and 65535.')
    process.exit(1)
  }
  return parsed
}

function loadLocalEnv(path) {
  try {
    process.loadEnvFile(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

function resolvePublicFile(pathname) {
  if (pathname === '/') return resolve(repoRoot, 'app/index.html')
  if (pathname === '/run' || pathname === '/run/') return resolve(repoRoot, 'app/run/index.html')
  let decoded
  try { decoded = decodeURIComponent(pathname) } catch { return null }
  for (const [prefix, root] of publicRoots) {
    if (!decoded.startsWith(prefix)) continue
    const relativePath = decoded.slice(prefix.length)
    const resolved = resolve(root, relativePath)
    if (resolved === root || !resolved.startsWith(`${root}${sep}`)) return null
    return resolved
  }
  return null
}

function readJson(request) {
  return new Promise((resolveBody, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 32_768) reject(new Error('请求体过大。'))
    })
    request.on('end', () => {
      try { resolveBody(JSON.parse(body)) } catch { reject(new Error('请求体必须是 JSON。')) }
    })
    request.on('error', reject)
  })
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(`${JSON.stringify(body, (_key, value) => typeof value === 'bigint' ? value.toString() : value)}\n`)
}
