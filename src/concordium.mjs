export const CONCORDIUM_TESTNET_GENESIS_HASH =
  '4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796'
export const PLATFORM_ACCOUNT = '4aWGujk9C4b1wF2FPPaVaxVkXA6cQV82kewgzRnK9GQnBSDjP4'
export const INITIAL_MARKET = Object.freeze({
  service_id: 'surplus-bid-w2d2',
  guarantee: '2000000',
  fee_recipient: PLATFORM_ACCOUNT,
})

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

export async function connectConcordiumWallet({ timeoutMs = 15_000 } = {}) {
  const provider = globalThis.window?.concordium
  if (!provider || typeof provider.requestAccounts !== 'function' || typeof provider.getSelectedChain !== 'function') {
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

  const accounts = await withTimeout(
    provider.requestAccounts(),
    timeoutMs,
    '钱包账户授权超时，请检查扩展弹窗后重试。',
  )
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new ConcordiumClientError('NO_ACCOUNT', '钱包没有返回可用账户。请在钱包中选择 Testnet 账户。')
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

export async function submitModuleDeployment(connection, { timeoutMs = 120_000 } = {}) {
  const sdk = requireTransactionSdk()
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

function requireTransactionSdk() {
  const sdk = globalThis.window?.concordiumSDK
  if (
    sdk?.AccountTransactionType?.DeployModule === undefined ||
    sdk?.AccountTransactionType?.InitContract === undefined ||
    !sdk?.CcdAmount?.fromCcd ||
    !sdk?.ModuleReference?.fromHexString ||
    !sdk?.Energy?.create
  ) {
    throw new ConcordiumClientError('SDK_NOT_READY', 'Concordium SDK 不具备部署交易所需接口。请刷新页面后重试。')
  }
  return sdk
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
