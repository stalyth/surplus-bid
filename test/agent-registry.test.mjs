import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  SELLER_AGENT_IDENTITY,
  normalizeSellerBadgeVerification,
  sellerIdentityAllowsPublish,
} from '../src/agent-registry.mjs'

function validPayload() {
  return {
    network: 'testnet',
    token_address: SELLER_AGENT_IDENTITY.badge,
    agent_uri: SELLER_AGENT_IDENTITY.agentCardUrl,
    badge_valid: true,
    issues: [],
    on_chain: {
      owner_account: SELLER_AGENT_IDENTITY.owner,
      status: 'Active',
      metadata_hash_hex: SELLER_AGENT_IDENTITY.metadataHash,
    },
    checks: {
      on_chain_agent_found: true,
      status_active: true,
      has_agent_uri: true,
      card_fetched: true,
      hash_matches_on_chain: true,
      badge_present: true,
      badge_well_formed: true,
      token_address_matches: true,
      owner_matches: true,
      contracts_match: true,
      verify_present: true,
      extension_conformant: true,
      verification_present: true,
      verify_url_matches: true,
    },
  }
}

test('valid active badge and matching registered wallet allow a new capacity window', () => {
  const verification = normalizeSellerBadgeVerification(validPayload(), { verifiedAt: '2026-10-31T12:21:03.957Z' })
  assert.equal(verification.ok, true)
  assert.equal(verification.cardHashMatched, true)
  assert.equal(sellerIdentityAllowsPublish(verification, SELLER_AGENT_IDENTITY.owner), true)
})

test('revocation, card mismatch, or another wallet safely block publishing', () => {
  const revoked = validPayload()
  revoked.checks.status_active = false
  revoked.badge_valid = false
  assert.equal(normalizeSellerBadgeVerification(revoked).ok, false)

  const mismatchedCard = validPayload()
  mismatchedCard.on_chain.metadata_hash_hex = '00'.repeat(32)
  assert.equal(normalizeSellerBadgeVerification(mismatchedCard).cardHashMatched, false)

  const verified = normalizeSellerBadgeVerification(validPayload())
  assert.equal(sellerIdentityAllowsPublish(verified, '36pDdmDey4q2iDGTUa4ZgVGybT4khHsCwv2ztLhn188vJkfkyp'), false)
})

test('invalid Registry response cannot silently enable publishing', () => {
  assert.throws(() => normalizeSellerBadgeVerification(null), /不是对象/)
  const missingChecks = normalizeSellerBadgeVerification({})
  assert.equal(missingChecks.ok, false)
  assert.equal(sellerIdentityAllowsPublish(missingChecks, SELLER_AGENT_IDENTITY.owner), false)
})

test('submitted identity evidence records only real Registry transactions and marks the post-identity window pending', async () => {
  const evidence = JSON.parse(await readFile(new URL('../public/evidence/seller-agent-registry.json', import.meta.url), 'utf8'))
  assert.equal(evidence.evidenceStatus, 'verified')
  assert.equal(evidence.badge, SELLER_AGENT_IDENTITY.badge)
  assert.equal(evidence.metadataHash, SELLER_AGENT_IDENTITY.metadataHash)
  assert.match(evidence.registrationTransaction.hash, /^[0-9a-f]{64}$/)
  assert.match(evidence.cardAnchorTransaction.hash, /^[0-9a-f]{64}$/)
  assert.equal(evidence.postIdentityCapacityWindow, null)
})
