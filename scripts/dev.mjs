import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, statSync } from 'node:fs'
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

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const host = '127.0.0.1'
const port = parsePort(process.env.PORT)
const testnetGenesis = '4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796'
const contractName = ContractName.fromString('surplus_bid')
const platformAddress = '4aWGujk9C4b1wF2FPPaVaxVkXA6cQV82kewgzRnK9GQnBSDjP4'
const testnetClient = new ConcordiumGRPCNodeClient(
  'grpc.testnet.concordium.com', 20_000, credentials.createSsl(), { timeout: 10_000 },
)

const publicRoots = new Map([
  ['/app/', resolve(repoRoot, 'app')],
  ['/src/', resolve(repoRoot, 'src')],
  ['/docs/evidence/', resolve(repoRoot, '../docs/evidence')],
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

const verified = { deployment: null, initialization: null }

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${host}:${port}`)
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true, service: 'surplus-bid-walking-skeleton' })
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

server.requestTimeout = 15_000
server.headersTimeout = 10_000
server.on('error', (error) => {
  console.error(`Could not start SurplusBid: ${error.message}`)
  process.exitCode = 1
})
server.listen(port, host, () => console.log(`SurplusBid walking skeleton: http://${host}:${port}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))

async function handleTestnetApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/testnet/status') {
    const artifact = loadArtifacts()
    const consensus = await getTestnetConsensus()
    sendJson(response, 200, {
      ok: true,
      network: 'Concordium Testnet',
      moduleReference: artifact.moduleReference,
      contractName: 'surplus_bid',
      platformAddress,
      lastFinalizedBlock: String(consensus.lastFinalizedBlock),
      deployment: verified.deployment,
      initialization: verified.initialization,
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
  return { blockHash: String(blockHash), state, contractBalance: String(instance.amount) }
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
  return { moduleReference: createHash('sha256').update(module).digest('hex'), schema }
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

function resolvePublicFile(pathname) {
  if (pathname === '/') return resolve(repoRoot, 'app/index.html')
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
