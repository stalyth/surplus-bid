export const SELLER_AGENT_IDENTITY = Object.freeze({
  network: 'testnet',
  agentId: 979,
  badge: 'JyP9XsMYjJ5UWf4PpVfN5',
  canonicalBadge: 'ccd:4221332d34e1694168c2a0c0b3fd0f27/cis-2:JyP9XsMYjJ5UWf4PpVfN5',
  owner: '4L6swfbApoVxnvxz1oyEpg3vyjLZjr8AZg2ofEn2ze6mRgbRdb',
  agentCardUrl: 'https://surplus-bid.netlify.app/.well-known/agent-card.json',
  metadataHash: '2a680d5d0019f7da8c2abf352f86927352937b1527560dd48ccde61d902c288a',
  verifyUrl: 'https://agent-registry-mcp.concordium.com/v1/badge-check/JyP9XsMYjJ5UWf4PpVfN5',
  registrationTransaction: '09879807cd5438efafcc40ae6d2480496c2b5250c0ec3e5eaf8c32c749cfd9ca',
  cardAnchorTransaction: '4abba0c55c03564d791dcb1194f2bae968c115ff6fbbca3fa336f1f8d9e12b17',
})

const requiredChecks = Object.freeze([
  'on_chain_agent_found',
  'status_active',
  'has_agent_uri',
  'card_fetched',
  'hash_matches_on_chain',
  'badge_present',
  'badge_well_formed',
  'token_address_matches',
  'owner_matches',
  'contracts_match',
  'verify_present',
  'extension_conformant',
  'verification_present',
  'verify_url_matches',
])

export function normalizeSellerBadgeVerification(payload, { verifiedAt = new Date().toISOString() } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Agent Registry 返回的核验结果不是对象。')
  }
  const checks = payload.checks && typeof payload.checks === 'object' ? payload.checks : {}
  const failedChecks = requiredChecks.filter((name) => checks[name] !== true)
  const owner = payload.on_chain?.owner_account
  const hash = payload.on_chain?.metadata_hash_hex
  const issues = Array.isArray(payload.issues) ? payload.issues.filter((item) => typeof item === 'string') : []
  if (payload.network !== SELLER_AGENT_IDENTITY.network) issues.push('WRONG_NETWORK')
  if (payload.token_address !== SELLER_AGENT_IDENTITY.badge) issues.push('BADGE_MISMATCH')
  if (owner !== SELLER_AGENT_IDENTITY.owner) issues.push('OWNER_MISMATCH')
  if (hash !== SELLER_AGENT_IDENTITY.metadataHash) issues.push('CARD_HASH_MISMATCH')
  for (const name of failedChecks) issues.push(`CHECK_FAILED:${name}`)
  if (payload.badge_valid !== true) issues.push('BADGE_INVALID')

  return {
    ok: issues.length === 0,
    network: payload.network ?? null,
    status: checks.status_active === true ? 'Active' : 'Invalid',
    badgeValid: payload.badge_valid === true,
    cardHashMatched: checks.hash_matches_on_chain === true && hash === SELLER_AGENT_IDENTITY.metadataHash,
    registeredSeller: typeof owner === 'string' ? owner : null,
    badge: typeof payload.token_address === 'string' ? payload.token_address : null,
    agentCardUrl: typeof payload.agent_uri === 'string' ? payload.agent_uri : null,
    metadataHash: typeof hash === 'string' ? hash : null,
    verifiedAt,
    issues: [...new Set(issues)],
  }
}

export function sellerIdentityAllowsPublish(verification, walletAccount) {
  return Boolean(
    verification?.ok === true &&
    verification.status === 'Active' &&
    verification.badgeValid === true &&
    verification.cardHashMatched === true &&
    verification.registeredSeller === SELLER_AGENT_IDENTITY.owner &&
    walletAccount === SELLER_AGENT_IDENTITY.owner,
  )
}
