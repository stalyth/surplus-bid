import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { DEFAULT_LLM_MODEL, PROMPT_VERSION, decideNextReserve } from '../src/decision.mjs'

const casesPath = fileURLToPath(new URL('./cases.json', import.meta.url))
const resultsPath = fileURLToPath(new URL('./results.md', import.meta.url))
const runsPerCase = 3

try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

for (const name of ['LLM_API_KEY']) {
  if (!process.env[name]) {
    console.error(`缺少 ${name}；未调用外部模型，也没有生成评测结果。`)
    process.exitCode = 1
    process.exit()
  }
}

const cases = JSON.parse(await readFile(casesPath, 'utf8'))
const rows = []
let proposedCorrect = 0
let finalCorrect = 0
let overrideCount = 0
let modelFailureCount = 0

for (const evalCase of cases) {
  const outputs = []
  for (let run = 1; run <= runsPerCase; run += 1) {
    const result = await decideNextReserve(`${evalCase.id}-${run}`, evalCase.input)
    const proposedPass = evalCase.expected.signals.includes(result.proposed.marketSignal)
    const finalPass = finalMatches(result, evalCase.expected)
    proposedCorrect += Number(proposedPass)
    finalCorrect += Number(finalPass)
    overrideCount += Number(result.ruleOverride !== null)
    modelFailureCount += Number(result.modelError !== null)
    outputs.push({ result, proposedPass, finalPass })
  }
  const signals = new Set(outputs.map(({ result }) => result.proposed.marketSignal))
  const finalOutputs = new Set(outputs.map(({ result }) => `${result.final.action}:${result.final.reserveMicroCcd}`))
  rows.push({
    id: evalCase.id,
    expected: `${evalCase.expected.signals.join('/')} → ${evalCase.expected.actions.join('/')}`,
    proposed: outputs.map(({ result }) => result.proposed.marketSignal).join(', '),
    final: outputs.map(({ result }) => `${result.final.action}@${result.final.reserveMicroCcd}`).join(', '),
    proposedScore: outputs.filter(({ proposedPass }) => proposedPass).length,
    finalScore: outputs.filter(({ finalPass }) => finalPass).length,
    signalStable: signals.size === 1,
    exactStable: finalOutputs.size === 1,
  })
}

const total = cases.length * runsPerCase
const markdown = [
  '# Seller Agent evaluation',
  '',
  `- Generated: ${new Date().toISOString()}`,
  `- Model: ${process.env.LLM_MODEL ?? DEFAULT_LLM_MODEL}`,
  `- Prompt version: ${PROMPT_VERSION}`,
  `- Sample size: ${total} runs on ${cases.length} hand-written cases`,
  `- Model signal correct: ${proposedCorrect}/${total}`,
  `- Final decision correct after code rules: ${finalCorrect}/${total}`,
  `- Runs with rule override: ${overrideCount}/${total}`,
  `- Model call failures: ${modelFailureCount}/${total}`,
  '',
  '| Case | Expected | Proposed signals | Final action@microCCD | Proposed | Final | Signal stable | Exact stable |',
  '| --- | --- | --- | --- | ---: | ---: | --- | --- |',
  ...rows.map((row) => `| ${row.id} | ${row.expected} | ${row.proposed} | ${row.final} | ${row.proposedScore}/3 | ${row.finalScore}/3 | ${yesNo(row.signalStable)} | ${yesNo(row.exactStable)} |`),
  '',
  '“Model signal correct”只衡量模型市场分类；“Final decision correct”同时检查代码裁决后的动作和允许底价区间。手写用例只能暴露明显问题，不代表统计意义上的准确率。',
  '',
].join('\n')

await writeFile(resultsPath, markdown)
console.log(markdown)

function finalMatches(result, expected) {
  const reserve = BigInt(result.final.reserveMicroCcd)
  return expected.actions.includes(result.final.action) &&
    reserve >= BigInt(expected.minReserveMicroCcd) &&
    reserve <= BigInt(expected.maxReserveMicroCcd)
}

function yesNo(value) {
  return value ? 'yes' : 'no'
}
