import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const distRoot = resolve(repoRoot, 'dist')

await rm(distRoot, { recursive: true, force: true })

await Promise.all([
  mkdir(resolve(distRoot, 'app'), { recursive: true }),
  mkdir(resolve(distRoot, 'run'), { recursive: true }),
  mkdir(resolve(distRoot, 'src'), { recursive: true }),
  mkdir(resolve(distRoot, 'vendor'), { recursive: true }),
])

await Promise.all([
  copy('app/index.html', 'dist/index.html'),
  copy('app/run/index.html', 'dist/run/index.html'),
  copy('app/styles.css', 'dist/app/styles.css'),
  copy('app/app.mjs', 'dist/app/app.mjs'),
  copy('src/concordium.mjs', 'dist/src/concordium.mjs'),
  copy('src/market-history.mjs', 'dist/src/market-history.mjs'),
  copy('src/rules.mjs', 'dist/src/rules.mjs'),
  copy('public/service-spec.json', 'dist/service-spec.json'),
  copy('public/.nojekyll', 'dist/.nojekyll'),
  copyTree('public/evidence', 'dist/evidence'),
  copy('node_modules/@concordium/web-sdk/lib/min/concordium.web.min.js', 'dist/vendor/concordium.web.min.js'),
  writeFile(resolve(distRoot, 'runtime-config.json'), `${JSON.stringify({
    mode: 'public-readonly',
    agentApi: false,
    walletActions: false,
  }, null, 2)}\n`),
])

await assertNoSecretConfiguration([
  'dist/index.html',
  'dist/run/index.html',
  'dist/app/app.mjs',
  'dist/runtime-config.json',
])

console.log('Built public-readonly site in dist/. No API key or wallet transaction endpoint is enabled.')

async function copy(source, destination) {
  await copyFile(resolve(repoRoot, source), resolve(repoRoot, destination))
}

async function copyTree(source, destination) {
  await cp(resolve(repoRoot, source), resolve(repoRoot, destination), { recursive: true, force: true })
}

async function assertNoSecretConfiguration(paths) {
  const forbidden = ['LLM_API_KEY', 'WALLET_PRIVATE_KEY', 'PRIVATE_KEY=', 'api.deepseek.com/chat/completions']
  for (const path of paths) {
    const content = await readFile(resolve(repoRoot, path), 'utf8')
    const match = forbidden.find((value) => content.includes(value))
    if (match) throw new Error(`公开构建 ${path} 包含禁止的敏感配置标记：${match}`)
  }
}
