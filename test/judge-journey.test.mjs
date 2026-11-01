import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const journey = JSON.parse(await readFile(new URL('../public/evidence/judge-journey.json', import.meta.url), 'utf8'))
const market = JSON.parse(await readFile(new URL('../public/evidence/confirmed-market-settlements.json', import.meta.url), 'utf8'))
const landing = await readFile(new URL('../app/index.html', import.meta.url), 'utf8')
const runPage = await readFile(new URL('../app/run/index.html', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../app/app.mjs', import.meta.url), 'utf8')
const agentCardSource = await readFile(new URL('../public/.well-known/agent-card.json', import.meta.url), 'utf8')
const agentCard = JSON.parse(agentCardSource)
const buildSource = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8')

test('public judge journey contains a current-protocol, linkable Testnet path', () => {
  assert.equal(journey.protocolVersion, 'batch-allocation-v3')
  assert.equal(journey.evidenceStatus, 'verified')
  assert.equal(journey.chainJourney.instance.index, '13035')
  assert.equal(journey.chainJourney.steps.length, 10)
  assert.deepEqual(journey.chainJourney.steps.map((step) => step.key), [
    'initialize', 'start_round', 'commit_bid_1', 'commit_bid_2', 'commit_bid_3',
    'reveal_reserve', 'reveal_bid_1', 'reveal_bid_2', 'reveal_bid_3', 'finalize',
  ])
  for (const step of journey.chainJourney.steps) {
    assert.match(step.hash, /^[0-9a-f]{64}$/)
    assert.equal(step.explorerUrl, `https://ccdexplorer.io/testnet/transaction/${step.hash}`)
  }
  assert.deepEqual(journey.chainJourney.result.allocations.map((allocation) => allocation.bidMicroCcd), ['2100000', '2200000'])
  assert.deepEqual(journey.chainJourney.result.allocations.map((allocation) => allocation.clearingPriceMicroCcd), ['1950000', '2000000'])
})

test('public market history contains only reconciled current-protocol settlements', () => {
  assert.equal(market.protocolVersion, 'batch-allocation-v3')
  assert.equal(market.evidenceStatus, 'verified')
  assert.equal(market.settlements.length, 5)
  assert.ok(market.settlements.every((record) => record.version === 2 && record.reconciled === true))
  assert.ok(market.settlements.every((record) => record.service.capacityUnits === 2))
  assert.ok(market.settlements.every((record) => record.transaction.explorerUrl.endsWith(record.transaction.hash)))
})

test('public judge journey keeps model evaluation separate from future chain provenance', () => {
  assert.equal(journey.sellerDecisionEvidence.sameRunAsChainJourney, false)
  assert.match(journey.limitations[0], /independent/)
})

test('judge path names the users, the traded service, and explains transaction surplus', () => {
  assert.match(landing, /AI API 提供方出售即将过期的优先执行容量/)
  assert.match(landing, /Buyer Agents 隐藏报价/)
  assert.match(landing, /交易剩余<\/strong> = 买家报价 − 卖家底价/)
  assert.match(landing, /https:\/\/ccdexplorer\.io\/testnet\/contract\/13035\/0/)
  assert.match(landing, /href="\.\/run\/#judge-journey"/)
  assert.ok(runPage.indexOf('id="judge-journey-result"') < runPage.indexOf('id="judge-journey-steps"'))
  assert.match(appSource, /独立策略评测 · 不属于本次/)
  assert.match(appSource, /不是当前链上底价的来源/)
})

test('public build uses portable relative URLs for static hosting', () => {
  assert.doesNotMatch(landing, /(?:href|src)="\/(?!\/)/)
  assert.doesNotMatch(runPage, /(?:href|src)="\/(?!\/)/)
  assert.doesNotMatch(appSource, /from '\//)
  assert.match(appSource, /publicAssetUrl\('runtime-config\.json'\)/)
  assert.match(appSource, /publicAssetUrl\('evidence\/judge-journey\.json'\)/)
})

test('registered Seller Agent Card carries the official Testnet badge coordinates', () => {
  assert.equal(agentCard.name, 'SurplusBid Seller Agent')
  assert.equal(agentCard.url, 'https://surplus-bid.netlify.app/.well-known/agent-card.json')
  assert.equal(agentCard.skills.length, 1)
  assert.equal(agentCard.skills[0].id, 'recommend-next-reserve')

  const badge = agentCard.capabilities.extensions.find(
    (extension) => extension.uri === 'https://docs.concordium.com/a2a-extensions/concordium-badge/v1',
  )
  assert.ok(badge)
  assert.equal(
    badge.params.tokenAddress,
    'ccd:4221332d34e1694168c2a0c0b3fd0f27/cis-2:JyP9XsMYjJ5UWf4PpVfN5',
  )
  assert.equal(badge.params.contracts.cis8004, 'ccd:4221332d34e1694168c2a0c0b3fd0f27:12802.0')
  assert.equal(badge.params.contracts.cis8, 'ccd:4221332d34e1694168c2a0c0b3fd0f27:12801.0')
  assert.match(badge.params.owner.account, /:4L6swfbApoVxnvxz1oyEpg3vyjLZjr8AZg2ofEn2ze6mRgbRdb$/)
  assert.equal(badge.params.verification.verifyUrl, 'https://agent-registry-mcp.concordium.com/v1/badge-check/JyP9XsMYjJ5UWf4PpVfN5')
  assert.deepEqual(agentCard.registrations, [
    {
      agentId: 979,
      agentRegistry: 'ccd:4221332d34e1694168c2a0c0b3fd0f27:12802.0',
    },
  ])
  assert.doesNotMatch(agentCardSource, /LLM_API_KEY|WALLET_PRIVATE_KEY|PRIVATE_KEY=/)
  assert.match(buildSource, /copy\('src\/agent-registry\.mjs', 'dist\/src\/agent-registry\.mjs'\)/)
  assert.match(buildSource, /'\/\.well-known\/agent-card\.json \/agent-card\.json 200\\n'/)
})
