import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { ModuleReference, TransactionHash } from '@concordium/web-sdk'
import { ConcordiumGRPCNodeClient, credentials } from '@concordium/web-sdk/nodejs'

const moduleReference = 'ee08ed962106a54a9bdb872ef9cb86c34bb68343297a46b94accac524aac7746'
const deploymentHash = '3b52fe6c23cc16c43fa6c92c74b444bd50160c1fc2aaad7d61e653fb8a9d0c28'
const sourceArchiveHash = 'b0f04d2af862bc6c5bfdc246f5f584e43e9ce59ceb737adc86af88709e2b7799'
const releaseBase = 'https://github.com/stalyth/surplus-bid/releases/download/verifiable-v3-3cbea1429e6c-42352242563-1'
const testnetGenesis = '4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796'
const outputIndex = process.argv.indexOf('--out')

if (outputIndex >= 0 && (!process.argv[outputIndex + 1] || process.argv.length !== 4)) {
  throw new Error('Usage: node scripts/verify-onchain-module.mjs [--out path/to/module.wasm.v1]')
}
if (outputIndex < 0 && process.argv.length !== 2) {
  throw new Error('Usage: node scripts/verify-onchain-module.mjs [--out path/to/module.wasm.v1]')
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const requireMatch = (condition, message) => {
  if (!condition) throw new Error(message)
}
const download = async (name) => {
  const response = await fetch(`${releaseBase}/${name}`, { signal: AbortSignal.timeout(30_000) })
  requireMatch(response.ok, `Cannot download ${name}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

const client = new ConcordiumGRPCNodeClient(
  'grpc.testnet.concordium.com', 20_000, credentials.createSsl(), { timeout: 15_000 },
)
const [consensus, deployment, onchain, moduleFile, sourceArchive] = await Promise.all([
  client.getConsensusStatus(),
  client.getBlockItemStatus(TransactionHash.fromHexString(deploymentHash)),
  client.getModuleSource(ModuleReference.fromHexString(moduleReference)),
  download('module.wasm.v1'),
  download('module.wasm.v1.tar'),
])

requireMatch(String(consensus.genesisBlock) === testnetGenesis, 'Public node is not Concordium Testnet')
requireMatch(deployment.status === 'finalized', 'Module deployment is not finalized')
requireMatch(deployment.outcome?.summary?.transactionType === 'deployModule', 'Transaction did not deploy a module')
requireMatch(deployment.outcome.summary.moduleDeployed?.contents === moduleReference, 'Deployment points to another module')
requireMatch(sha256(moduleFile) === moduleReference, 'Released module reference does not match its bytes')
requireMatch(sha256(sourceArchive) === sourceArchiveHash, 'Published source archive hash changed')
requireMatch(moduleFile.length >= 8 && moduleFile.readUInt32BE(0) === 1, 'Released file is not a V1 module')
requireMatch(moduleFile.readUInt32BE(4) === moduleFile.length - 8, 'Released module length header is invalid')
requireMatch(onchain.version === 1, 'On-chain module is not V1')
requireMatch(Buffer.from(onchain.source).equals(moduleFile.subarray(8)), 'On-chain module bytes differ from released module')

if (outputIndex >= 0) await writeFile(process.argv[outputIndex + 1], moduleFile)

console.log(JSON.stringify({
  network: 'Concordium Testnet',
  moduleReference,
  deploymentHash,
  deploymentBlock: String(deployment.outcome.blockHash),
  releasedModuleSha256: sha256(moduleFile),
  onchainSourceSha256: sha256(Buffer.from(onchain.source)),
  publishedSourceArchiveSha256: sha256(sourceArchive),
  onchainBytesEqualReleasedModule: true,
}, null, 2))
