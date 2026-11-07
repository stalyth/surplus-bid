import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { ContractAddress, ModuleReference } from '@concordium/web-sdk'
import { ConcordiumGRPCNodeClient, credentials } from '@concordium/web-sdk/nodejs'

const moduleReference = 'be590d158aa7bdd6cf6a69b7746de4329d4832ff14b2164f894d277c4b73d060'
const testnetGenesis = '4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796'
if (process.argv.length !== 4 || process.argv[2] !== '--out') {
  throw new Error('Usage: node scripts/fetch-primary-module.mjs --out path/to/module.wasm.v1')
}

const client = new ConcordiumGRPCNodeClient(
  'grpc.testnet.concordium.com', 20_000, credentials.createSsl(), { timeout: 15_000 },
)
const [consensus, instance, module] = await Promise.all([
  client.getConsensusStatus(),
  client.getInstanceInfo(ContractAddress.create(13041n, 0n)),
  client.getModuleSource(ModuleReference.fromHexString(moduleReference)),
])
if (String(consensus.genesisBlock) !== testnetGenesis) throw new Error('Public node is not Concordium Testnet')
if (String(instance.sourceModule) !== moduleReference) throw new Error('Primary instance uses another module')
if (module.version !== 1) throw new Error('Primary module is not V1')

const source = Buffer.from(module.source)
const header = Buffer.alloc(8)
header.writeUInt32BE(1, 0)
header.writeUInt32BE(source.length, 4)
const versionedModule = Buffer.concat([header, source])
const digest = createHash('sha256').update(versionedModule).digest('hex')
if (digest !== moduleReference) throw new Error('Public node returned bytes that do not match the module reference')
await writeFile(process.argv[3], versionedModule)

console.log(JSON.stringify({
  network: 'Concordium Testnet',
  primaryInstance: '<13041,0>',
  sourceModuleReference: moduleReference,
  onchainModuleSha256: digest,
  onchainSourceBytes: source.length,
}, null, 2))
