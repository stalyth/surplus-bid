export const CONCORDIUM_TESTNET_GENESIS_HASH =
  '4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796'
export const PLATFORM_ACCOUNT = '4aWGujk9C4b1wF2FPPaVaxVkXA6cQV82kewgzRnK9GQnBSDjP4'
export const INITIAL_MARKET = Object.freeze({
  service_id: 'surplus-bid-w2d2',
  guarantee: '2000000',
  fee_recipient: PLATFORM_ACCOUNT,
})

export const START_ROUND_RULES = Object.freeze({
  guaranteeCcd: 2,
  commitDurationMs: 20 * 60_000,
  sellerRevealDurationMs: 5 * 60_000,
  buyerRevealDurationMs: 5 * 60_000,
  maxBids: 2,
})
export const REAL_BID_OPTIONS = Object.freeze([
  { id: 'buyer-a', label: '买家 A', amountCcd: 4 },
  { id: 'buyer-b', label: '买家 B', amountCcd: 6 },
])

export class ConcordiumClientError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ConcordiumClientError'
    this.code = code
  }
}

export function assertConcordiumTestnet(chain) {
  if (chain !== CONCORDIUM_TESTNET_GENESIS_HASH) {
    throw new ConcordiumClientError(
      'WRONG_NETWORK',
      '请先在 Concordium Wallet 切换到 Testnet，再连接 SurplusBid。',
    )
  }
}

export function shortAccountAddress(address) {
  if (typeof address !== 'string' || address.length < 12) return '未知账户'
  return `${address.slice(0, 6)}…${address.slice(-6)}`
}

export function assertTransactionHash(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new ConcordiumClientError(
      'INVALID_TRANSACTION_HASH',
      '钱包没有返回有效交易哈希；请在钱包活动中核对原请求，勿重复发送。',
    )
  }
  return value
}

export function getTransactionSender(connection) {
  const sender = connection?.accounts?.[0]
  if (typeof sender !== 'string' || sender.length === 0) {
    throw new ConcordiumClientError(
      'WALLET_ACCOUNT_MISSING',
      '钱包没有返回交易签名账户；请按交易哈希只读核验，勿重复发送。',
    )
  }
  return sender
}

export async function connectConcordiumWallet({ timeoutMs = 15_000 } = {}) {
  const provider = globalThis.window?.concordium
  if (!provider || (typeof provider.connect !== 'function' && typeof provider.requestAccounts !== 'function') || typeof provider.getSelectedChain !== 'function') {
    throw new ConcordiumClientError(
      'WALLET_NOT_FOUND',
      '未检测到 Concordium 浏览器钱包。请安装扩展、解锁钱包后重试。',
    )
  }

  const sdk = globalThis.window?.concordiumSDK
  if (!sdk?.ContractName?.fromString || !sdk?.ReceiveName?.fromString) {
    throw new ConcordiumClientError(
      'SDK_NOT_READY',
      'Concordium SDK 未加载完成。请刷新页面后重试。',
    )
  }

  const accounts = await getCurrentWalletAccounts(
    provider,
    timeoutMs,
    '钱包站点授权超时，请检查扩展弹窗后重试。',
  )
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new ConcordiumClientError('NO_ACCOUNT', '钱包没有返回已授权账户。请在扩展中允许此站点访问当前 Testnet 账户后重试。')
  }

  const chain = await withTimeout(
    provider.getSelectedChain(),
    timeoutMs,
    '读取钱包网络超时，请确认钱包已解锁。',
  )
  assertConcordiumTestnet(chain)

  // Build the names through the installed SDK now, so later transaction calls use
  // the same validated contract/receive-name boundary rather than raw strings.
  sdk.ContractName.fromString('surplus_bid')
  sdk.ReceiveName.fromString('surplus_bid.view')

  return {
    provider,
    accounts,
    chain,
    contractName: 'surplus_bid',
    viewReceiveName: 'surplus_bid.view',
  }
}

function normalizeConnectedAccounts(connected) {
  if (Array.isArray(connected)) return connected.filter((account) => typeof account === 'string')
  if (typeof connected === 'string') return [connected]
  if (connected && typeof connected.account === 'string') return [connected.account]
  if (connected && Array.isArray(connected.accounts)) return connected.accounts.filter((account) => typeof account === 'string')
  return []
}

export async function submitModuleDeployment(connection, { timeoutMs = 120_000 } = {}) {
  const sdk = requireTransactionSdk()
  await refreshWalletAuthorization(connection, timeoutMs)
  const response = await fetchWithTimeout('/artifacts/module.wasm.v1', 10_000)
  if (!response.ok) {
    throw new ConcordiumClientError('ARTIFACT_UNAVAILABLE', '无法读取当前 Wasm 构建。请先运行 pnpm check。')
  }
  const source = new Uint8Array(await response.arrayBuffer())
  if (source.byteLength === 0) throw new ConcordiumClientError('ARTIFACT_EMPTY', '当前 Wasm 构建为空。')
  const hash = await withTimeout(
    connection.provider.sendTransaction(
      connection.accounts[0],
      sdk.AccountTransactionType.DeployModule,
      { source },
    ),
    timeoutMs,
    '等待钱包确认部署超时。请在钱包活动中检查原请求，勿重复发送。',
  )
  return assertTransactionHash(hash)
}

export async function submitMarketInitialization(connection, moduleReference, { timeoutMs = 120_000 } = {}) {
  const sdk = requireTransactionSdk()
  if (typeof moduleReference !== 'string' || !/^[0-9a-f]{64}$/i.test(moduleReference)) {
    throw new ConcordiumClientError('INVALID_MODULE_REFERENCE', '部署模块引用无效，无法创建实例。')
  }
  await refreshWalletAuthorization(connection, timeoutMs)
  const response = await fetchWithTimeout('/artifacts/schema.bin', 10_000)
  if (!response.ok) {
    throw new ConcordiumClientError('SCHEMA_UNAVAILABLE', '无法读取当前合约 schema。请先运行 pnpm check。')
  }
  const schemaBase64 = bytesToBase64(new Uint8Array(await response.arrayBuffer()))
  const payload = {
    amount: sdk.CcdAmount.fromCcd(0),
    moduleRef: sdk.ModuleReference.fromHexString(moduleReference),
    initName: sdk.ContractName.fromString('surplus_bid'),
    maxContractExecutionEnergy: sdk.Energy.create(50_000),
  }
  const hash = await withTimeout(
    connection.provider.sendTransaction(
      connection.accounts[0],
      sdk.AccountTransactionType.InitContract,
      payload,
      INITIAL_MARKET,
      schemaBase64,
    ),
    timeoutMs,
    '等待钱包确认创建实例超时。请在钱包活动中检查原请求，勿重复发送。',
  )
  return assertTransactionHash(hash)
}

export async function prepareStartRound(connection, initialization, {
  now = Date.now(),
  reserveMicroCcd = '2000000',
} = {}) {
  const sdk = requireTransactionSdk()
  if (!initialization?.address || typeof initialization.sender !== 'string') {
    throw new ConcordiumClientError('INSTANCE_UNAVAILABLE', '当前实例信息不完整，无法创建轮次。')
  }
  const account = connection.accounts[0]
  if (account !== initialization.sender) {
    throw new ConcordiumClientError(
      'WRONG_SELLER_ACCOUNT',
      `实例 <${initialization.address.index},${initialization.address.subindex}> 的初始化签名账户是 ${shortAccountAddress(initialization.sender)}；请在钱包切换到该账户后再开始本轮。`,
    )
  }
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new ConcordiumClientError('INVALID_CLOCK', '本机时间无效，无法设置链上截止时间。')
  }
  if (typeof reserveMicroCcd !== 'string' || !/^(0|[1-9][0-9]*)$/.test(reserveMicroCcd)) {
    throw new ConcordiumClientError('INVALID_RESERVE', 'Seller Agent 的最终底价必须是非负整数 microCCD。')
  }

  const reserveSalt = new Uint8Array(32)
  crypto.getRandomValues(reserveSalt)
  const commitEnd = now + START_ROUND_RULES.commitDurationMs
  const sellerRevealEnd = commitEnd + START_ROUND_RULES.sellerRevealDurationMs
  const buyerRevealEnd = sellerRevealEnd + START_ROUND_RULES.buyerRevealDurationMs
  const reserveCommitment = await createCommitment({
    sdk,
    domain: 'SURPLUS_BID_RESERVE_V1',
    contract: initialization.address,
    account,
    amountMicroCcd: BigInt(reserveMicroCcd),
    salt: reserveSalt,
  })

  return {
    contract: initialization.address,
    seller: account,
    reserveMicroCcd,
    reserveSaltHex: bytesToHex(reserveSalt),
    reserveCommitment: Array.from(reserveCommitment),
    parameters: {
      reserve_commitment: Array.from(reserveCommitment),
      commit_end: String(commitEnd),
      seller_reveal_end: String(sellerRevealEnd),
      buyer_reveal_end: String(buyerRevealEnd),
      max_bids: START_ROUND_RULES.maxBids,
    },
  }
}

export async function submitStartRound(connection, initialization, plan, { timeoutMs = 120_000 } = {}) {
  const sdk = requireTransactionSdk()
  if (!plan?.parameters || !initialization?.address) {
    throw new ConcordiumClientError('ROUND_PLAN_UNAVAILABLE', '本轮承诺参数缺失，未发送交易。')
  }
  await refreshWalletAuthorization(connection, timeoutMs)
  if (connection.accounts[0] !== initialization.sender || connection.accounts[0] !== plan.seller) {
    throw new ConcordiumClientError('WRONG_SELLER_ACCOUNT', '当前钱包账户不是本实例的卖家，未发送交易。')
  }
  const payload = {
    amount: sdk.CcdAmount.fromCcd(START_ROUND_RULES.guaranteeCcd),
    address: sdk.ContractAddress.create(BigInt(initialization.address.index), BigInt(initialization.address.subindex)),
    receiveName: sdk.ReceiveName.fromString('surplus_bid.start_round'),
    maxContractExecutionEnergy: sdk.Energy.create(100_000),
  }
  const hash = await withTimeout(
    connection.provider.sendTransaction(
      connection.accounts[0],
      sdk.AccountTransactionType.Update,
      payload,
      plan.parameters,
      await getSchemaBase64(),
    ),
    timeoutMs,
    '等待钱包确认开始本轮超时。请在钱包活动中检查原请求，勿重复发送。',
  )
  return assertTransactionHash(hash)
}

export async function submitCancelRound(connection, initialization, { timeoutMs = 120_000 } = {}) {
  const sdk = requireTransactionSdk()
  if (!initialization?.address) throw new ConcordiumClientError('INSTANCE_UNAVAILABLE', '当前实例信息不完整，未发送取消交易。')
  await refreshWalletAuthorization(connection, timeoutMs)
  const payload = {
    amount: sdk.CcdAmount.fromCcd(0),
    address: sdk.ContractAddress.create(BigInt(initialization.address.index), BigInt(initialization.address.subindex)),
    receiveName: sdk.ReceiveName.fromString('surplus_bid.cancel'),
    maxContractExecutionEnergy: sdk.Energy.create(100_000),
  }
  const hash = await withTimeout(
    connection.provider.sendTransaction(connection.accounts[0], sdk.AccountTransactionType.Update, payload),
    timeoutMs,
    '等待钱包确认取消空轮次超时。请在钱包活动中检查原请求，勿重复发送。',
  )
  return assertTransactionHash(hash)
}

export async function prepareBidCommitment(connection, initialization, amountCcd) {
  const sdk = requireTransactionSdk()
  if (!initialization?.address || !Number.isInteger(amountCcd) || amountCcd < START_ROUND_RULES.guaranteeCcd) {
    throw new ConcordiumClientError('INVALID_BID', '报价必须是不低于 2 CCD 的整数测试报价。')
  }
  const bidder = connection.accounts[0]
  if (bidder === initialization.sender) {
    throw new ConcordiumClientError('SELLER_CANNOT_BID', '当前实例的卖家账户不能提交买家报价。')
  }
  const salt = new Uint8Array(32)
  crypto.getRandomValues(salt)
  const amountMicroCcd = BigInt(amountCcd) * 1_000_000n
  const commitment = await createCommitment({
    sdk,
    domain: 'SURPLUS_BID_BID_V1',
    contract: initialization.address,
    account: bidder,
    amountMicroCcd,
    salt,
  })
  return {
    format: 'surplus-bid-bid-reveal-v1',
    contract: initialization.address,
    bidder,
    amountMicroCcd: amountMicroCcd.toString(),
    amountCcd,
    saltHex: bytesToHex(salt),
    commitment: Array.from(commitment),
  }
}

export async function submitBidCommitment(connection, initialization, plan, { timeoutMs = 120_000 } = {}) {
  if (!plan?.commitment || !initialization?.address || plan.bidder !== connection.accounts[0]) {
    throw new ConcordiumClientError('BID_PLAN_UNAVAILABLE', '报价承诺参数缺失，未发送交易。')
  }
  return submitSchemaUpdate(connection, initialization, 'surplus_bid.commit_bid', START_ROUND_RULES.guaranteeCcd, plan.commitment, timeoutMs)
}

export async function submitReserveReveal(connection, initialization, plan, { timeoutMs = 120_000 } = {}) {
  if (!plan?.reserveSaltHex || !/^(0|[1-9][0-9]*)$/.test(plan.reserveMicroCcd ?? '') || connection.accounts[0] !== initialization?.sender) {
    throw new ConcordiumClientError('RESERVE_BACKUP_UNAVAILABLE', '当前账户或本地底价揭示备份无效，未发送交易。')
  }
  return submitSchemaUpdate(connection, initialization, 'surplus_bid.reveal_reserve', 0, {
    amount: plan.reserveMicroCcd, salt: hexToBytes(plan.reserveSaltHex),
  }, timeoutMs)
}

export async function submitBidReveal(connection, initialization, plan, { timeoutMs = 120_000 } = {}) {
  if (!plan?.saltHex || plan.bidder !== connection.accounts[0]) {
    throw new ConcordiumClientError('BID_BACKUP_UNAVAILABLE', '当前账户或本地报价揭示备份无效，未发送交易。')
  }
  const topUpCcd = plan.amountCcd - START_ROUND_RULES.guaranteeCcd
  return submitSchemaUpdate(connection, initialization, 'surplus_bid.reveal_bid', topUpCcd, {
    amount: String(plan.amountMicroCcd), salt: hexToBytes(plan.saltHex),
  }, timeoutMs)
}

export async function submitFinalizeRound(connection, initialization, { timeoutMs = 120_000 } = {}) {
  const sdk = requireTransactionSdk()
  if (!initialization?.address) throw new ConcordiumClientError('INSTANCE_UNAVAILABLE', '当前实例信息不完整，未发送结算交易。')
  await refreshWalletAuthorization(connection, timeoutMs)
  const payload = updatePayload(sdk, initialization, 'surplus_bid.finalize', 0)
  const hash = await withTimeout(connection.provider.sendTransaction(connection.accounts[0], sdk.AccountTransactionType.Update, payload), timeoutMs, '等待钱包确认结算超时。请检查原请求，勿重复发送。')
  return assertTransactionHash(hash)
}

export function saveBidRevealBackup(plan) {
  if (!plan?.saltHex || !plan?.bidder || !plan?.contract) throw new ConcordiumClientError('BID_PLAN_UNAVAILABLE', '没有可保存的报价揭示备份。')
  try { localStorage.setItem(bidBackupKey(plan), JSON.stringify(plan)) } catch { throw new ConcordiumClientError('BACKUP_UNAVAILABLE', '浏览器无法保存本地报价揭示备份；未发送交易。') }
  return plan
}

export function loadBidRevealBackup(initialization, bidder) {
  if (!initialization?.address || typeof bidder !== 'string') return null
  try {
    const value = JSON.parse(localStorage.getItem(`surplus-bid:bid-reveal:v1:${initialization.address.index}:${initialization.address.subindex}:${bidder}`) ?? 'null')
    if (value?.format !== 'surplus-bid-bid-reveal-v1' || value.bidder !== bidder || String(value.contract?.index) !== String(initialization.address.index) || String(value.contract?.subindex) !== String(initialization.address.subindex) || !/^[0-9a-f]{64}$/i.test(value.saltHex ?? '') || !Array.isArray(value.commitment)) return null
    return value
  } catch { return null }
}

export function saveReserveRevealBackup(plan) {
  if (!plan?.reserveSaltHex || !/^(0|[1-9][0-9]*)$/.test(plan.reserveMicroCcd ?? '') || !plan?.parameters || !plan?.contract) {
    throw new ConcordiumClientError('ROUND_PLAN_UNAVAILABLE', '没有可保存的底价揭示备份。')
  }
  const backup = {
    format: 'surplus-bid-reserve-reveal-v1',
    contract: plan.contract,
    seller: plan.seller,
    reserveMicroCcd: plan.reserveMicroCcd,
    reserveSaltHex: plan.reserveSaltHex,
    reserveCommitment: plan.reserveCommitment,
    parameters: plan.parameters,
  }
  try {
    localStorage.setItem(reserveBackupKey(plan), JSON.stringify(backup))
  } catch {
    throw new ConcordiumClientError('BACKUP_UNAVAILABLE', '浏览器无法保存本地底价揭示备份；未发送交易。')
  }
  return backup
}

export function loadReserveRevealBackup(initialization) {
  if (!initialization?.address || typeof initialization.sender !== 'string') return null
  try {
    const raw = localStorage.getItem(`surplus-bid:reserve-reveal:v1:${initialization.address.index}:${initialization.address.subindex}`)
    if (!raw) return null
    const backup = JSON.parse(raw)
    if (
      backup.format !== 'surplus-bid-reserve-reveal-v1' ||
      backup.seller !== initialization.sender ||
      String(backup.contract?.index) !== String(initialization.address.index) ||
      String(backup.contract?.subindex) !== String(initialization.address.subindex) ||
      typeof backup.reserveSaltHex !== 'string' || !/^[0-9a-f]{64}$/i.test(backup.reserveSaltHex) ||
      typeof backup.reserveMicroCcd !== 'string' || !/^(0|[1-9][0-9]*)$/.test(backup.reserveMicroCcd) ||
      !Array.isArray(backup.reserveCommitment) || backup.reserveCommitment.length !== 32 ||
      !backup.parameters
    ) return null
    return backup
  } catch {
    return null
  }
}

export function downloadReserveRevealBackup(plan) {
  const backup = saveReserveRevealBackup(plan)
  const file = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: 'application/json' })
  const href = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = href
  link.download = `surplus-bid-reserve-${plan.contract.index}-${plan.contract.subindex}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(href), 0)
}

function requireTransactionSdk() {
  const sdk = globalThis.window?.concordiumSDK
  if (
    sdk?.AccountTransactionType?.DeployModule === undefined ||
    sdk?.AccountTransactionType?.InitContract === undefined ||
    sdk?.AccountTransactionType?.Update === undefined ||
    !sdk?.CcdAmount?.fromCcd ||
    !sdk?.ContractAddress?.create ||
    !sdk?.ModuleReference?.fromHexString ||
    !sdk?.ReceiveName?.fromString ||
    !sdk?.AccountAddress?.fromBase58 ||
    !sdk?.AccountAddress?.toBuffer ||
    !sdk?.Energy?.create
  ) {
    throw new ConcordiumClientError('SDK_NOT_READY', 'Concordium SDK 不具备部署交易所需接口。请刷新页面后重试。')
  }
  return sdk
}

async function getSchemaBase64() {
  const response = await fetchWithTimeout('/artifacts/schema.bin', 10_000)
  if (!response.ok) {
    throw new ConcordiumClientError('SCHEMA_UNAVAILABLE', '无法读取当前合约 schema。请先运行 pnpm check。')
  }
  return bytesToBase64(new Uint8Array(await response.arrayBuffer()))
}

async function createCommitment({ sdk, domain, contract, account, amountMicroCcd, salt }) {
  const domainBytes = new TextEncoder().encode(domain)
  const accountBytes = sdk.AccountAddress.toBuffer(sdk.AccountAddress.fromBase58(account))
  const pieces = [
    domainBytes,
    uint64Bytes(BigInt(contract.index)),
    uint64Bytes(BigInt(contract.subindex)),
    uint64Bytes(1n),
    new Uint8Array(accountBytes),
    uint64Bytes(amountMicroCcd),
    salt,
  ]
  const payload = new Uint8Array(pieces.reduce((total, value) => total + value.length, 0))
  let offset = 0
  for (const value of pieces) {
    payload.set(value, offset)
    offset += value.length
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', payload))
}

function uint64Bytes(value) {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, value, false)
  return bytes
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function reserveBackupKey(plan) {
  return `surplus-bid:reserve-reveal:v1:${plan.contract.index}:${plan.contract.subindex}`
}

function bidBackupKey(plan) {
  return `surplus-bid:bid-reveal:v1:${plan.contract.index}:${plan.contract.subindex}:${plan.bidder}`
}

async function submitSchemaUpdate(connection, initialization, receiveName, amountCcd, parameters, timeoutMs) {
  const sdk = requireTransactionSdk()
  await refreshWalletAuthorization(connection, timeoutMs)
  const payload = updatePayload(sdk, initialization, receiveName, amountCcd)
  const hash = await withTimeout(connection.provider.sendTransaction(connection.accounts[0], sdk.AccountTransactionType.Update, payload, parameters, await getSchemaBase64()), timeoutMs, `等待钱包确认 ${receiveName} 超时。请检查原请求，勿重复发送。`)
  return assertTransactionHash(hash)
}

async function refreshWalletAuthorization(connection, timeoutMs) {
  const provider = connection?.provider
  if (!provider || (typeof provider.connect !== 'function' && typeof provider.requestAccounts !== 'function')) {
    throw new ConcordiumClientError('WALLET_NOT_FOUND', '钱包站点授权接口不可用，未发送交易。')
  }
  const accounts = await getCurrentWalletAccounts(
    provider,
    timeoutMs,
    '刷新钱包站点授权超时。请检查扩展弹窗；未发送交易。',
  )
  if (accounts.length === 0) {
    throw new ConcordiumClientError('NO_ACCOUNT', '钱包没有返回当前站点已授权账户，未发送交易。')
  }
  const chain = await withTimeout(provider.getSelectedChain(), timeoutMs, '读取钱包网络超时；未发送交易。')
  assertConcordiumTestnet(chain)
  connection.accounts = accounts
}

async function getCurrentWalletAccounts(provider, timeoutMs, timeoutMessage) {
  // The wallet returns the active account only when that account is also
  // allowlisted for this origin. Prefer it to the complete allowlist returned
  // by requestAccounts, whose first item may be an older account.
  if (typeof provider.getMostRecentlySelectedAccount === 'function') {
    const selected = await withTimeout(
      provider.getMostRecentlySelectedAccount(),
      timeoutMs,
      '读取钱包当前账户超时，请检查扩展后重试。',
    )
    const selectedAccounts = normalizeConnectedAccounts(selected)
    if (selectedAccounts.length > 0) return selectedAccounts
  }

  // The interactive connection request remains the fallback when this origin
  // has no currently selected account available yet.
  const connected = await withTimeout(
    typeof provider.requestAccounts === 'function' ? provider.requestAccounts() : provider.connect(),
    timeoutMs,
    timeoutMessage,
  )
  return normalizeConnectedAccounts(connected) ?? []
}

function updatePayload(sdk, initialization, receiveName, amountCcd) {
  return {
    amount: sdk.CcdAmount.fromCcd(amountCcd),
    address: sdk.ContractAddress.create(BigInt(initialization.address.index), BigInt(initialization.address.subindex)),
    receiveName: sdk.ReceiveName.fromString(receiveName),
    maxContractExecutionEnergy: sdk.Energy.create(100_000),
  }
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  return Array.from(bytes)
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ConcordiumClientError('TIMEOUT', '读取本地构建文件超时。')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function bytesToBase64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new ConcordiumClientError('TIMEOUT', timeoutMessage)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
