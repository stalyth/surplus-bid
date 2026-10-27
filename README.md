# SurplusBid

SurplusBid 是一个运行在 Concordium 上的 Agent-to-Agent 密封竞价协议。多个买家 Agent 竞争有限的数字服务容量，智能合约在报价前固定规则，隐藏承诺期内的价格，并在揭示期结束后选择赢家、计算成交价、分配交易剩余和结算 CCD。

## 产品问题

当一个卖家 Agent 的服务容量有限，而多个买家 Agent 的支付意愿不同，固定价格可能把交易剩余全部留给一方，也可能无法及时反映供需变化。SurplusBid 用公开、确定性的竞价与结算规则分配有限容量，并让参与者可以独立核验赢家、价格、费用和资金流向。

## 参与角色

- Seller Agent：提供一项容量有限的数字服务，并在新一轮开始前确定底价策略。
- Buyer Agent：根据自身预算和需求生成最高报价。
- SurplusBid 合约：保存承诺、执行时间边界、验证揭示、选择赢家并原子完成分账和退款。
- 平台账户：只接收本轮规则预先定义的平台费用，不能在报价后修改费率或赢家。
- 触发者：在揭示截止后调用结算；任何账户都可以触发，但不能改变结算结果。

## 核心流程

1. 初始化服务市场，固定卖家、平台收款账户、服务标识和统一保证金。
2. 卖家调用 `start_round`，提交底价哈希承诺、阶段截止时间和保证金。
3. 两个买家分别调用 `commit_bid`，提交报价哈希承诺并存入统一保证金。
4. 承诺期结束后进入统一揭示期：卖家调用 `reveal_reserve` 公开底价，买家可并行调用 `reveal_bid` 公开报价并补足差额。
5. 统一揭示期结束后，任意账户调用 `finalize`；合约选择赢家并一次性处理成交款、平台费、保证金和退款。

链上截止时间只约束哪些操作在何时允许执行。区块链不会在截止时自动调用 `finalize`。

## 竞价规则

- MVP 为单卖家、单轮、两个买家、容量 1。
- 卖家底价和买家报价使用 SHA-256 承诺，绑定合约地址、轮次、账户、金额和 32 字节随机盐。
- 承诺期内只公开哈希和提交顺序；揭示后金额与盐永久公开。
- 低于底价或没有正确揭示的报价不能参与赢家选择。
- 最高合格报价中标；同价时，承诺序号较早者优先。
- 当前演示阶段固定为 8 分钟承诺期与 5 分钟统一揭示期。

## 定价与费用

当前 MVP 暂用中点定价：

```text
surplus = winningBid - reserve
price = reserve + floor(surplus / 2)
```

中点定价是可调整的初步机制。每轮采用的定价规则必须在买家承诺前公开并固定，新的定价策略只能作用于尚未开始报价的新一轮。

平台费用按交易剩余计算：

```text
if surplus < price × 10%:
    platformFee = 0
else:
    buyerFee = floor(surplus / 20)
    sellerFee = floor(surplus / 20)
    platformFee = buyerFee + sellerFee
```

- 刚好达到阈值时正常收费；未成交不收费。
- 买卖双方平均承担平台费，网络交易费另计。
- 所有金额使用整数 microCCD，中点和单方费用均向下取整。
- 合约必须保证 `price + buyerFee <= winningBid`。

## 资金处理

- 卖家开始一轮时存入一份保证金。
- 买家承诺时先存入统一保证金，揭示时只补足到 `max(保证金, 报价)`。
- 赢家退款为 `escrow - price - buyerFee`。
- 卖家成交净额为 `price - sellerFee`，并取回自身保证金。
- 已揭示但未中标的买家取回全部托管资金。
- 未揭示买家的保证金按当前规则划给卖家。
- 每条结束路径都必须使合约资金与卖家收款、平台费和退款精确守恒，且不得重复结算。

## Agent 策略

W2D3 Seller Agent 已接入本地 Node 服务。当前选用 DeepSeek `deepseek-flash`，通过工具调用读取已确认历史和供给变化，输出市场状态、具体下一轮底价、理由和证据字段。模型只提出建议；代码负责最终裁决：

- 供给未减少时，单轮涨幅不得超过上一轮平均交易剩余的 10%。
- 供给减少时可以突破普通涨幅限制，但必须至少保留上一轮平均交易剩余的 50%。
- 没有上一轮成交时不得涨价；少于 3 个已确认轮次、数据冲突、模型超时或无效输出时保持原价并转人工。
- 竞价时长继续固定；钱包交易仍需卖家核对并签名。

页面上的 W2D3 固定历史明确标记为 `demo data`。当前真实 Testnet 只有一轮可用证据，不足以支持动态定价，必须得到 `needs_human`。供需稳定时价格可能逐渐趋稳、交易剩余可能缩小，但这是需要真实数据验证的机制假设，并非保证结果。

### 配置与评测

复制 `.env.example` 为 `.env`，只填写自己的 DeepSeek API Key；默认 API 地址、模型和非思考模式已写入示例：

```text
LLM_API_KEY=...
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-flash
LLM_THINKING=disabled
```

`pnpm dev` 会读取 `.env`，页面通过本地 `/api/agent/decide` 调用模型，密钥不会发送到浏览器。每次决策追加到 `logs/decisions.jsonl`；该运行日志不会提交到 Git。DeepSeek 的选择和配置依据其官方 [Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/) 与 [API 文档](https://api-docs.deepseek.com/api/responses)。

```bash
pnpm eval:decisions
```

评测使用 `eval/cases.json` 中 8 个固定用例，每个运行 3 次，并覆盖生成 `eval/results.md`。模型信号准确率和代码裁决后的最终准确率分开统计。没有配置 API 时命令以非零状态退出，不生成虚假结果。

2026-10-25 的 `seller-reserve-v2` 真实评测结果：模型市场分类 24/24，代码裁决后的最终动作 24/24，模型调用失败 0/24；6/24 次触发代码规则覆盖。该结果只覆盖固定用例，不代表真实市场上的统计准确率。

## 运行模式

项目把公开观察前端和本地动态服务明确分开，两种模式复用同一套核心页：

- `pnpm dev` 启动 `local-live`：本地 Node 服务读取 `.env`，开放 DeepSeek 决策、Concordium Wallet、Testnet 写入与只读核验。
- `pnpm build` 生成 `dist/` 中的 `public-readonly`：只展示随仓库提交的脱敏证据 JSON 与 CCDExplorer 链接，不连接钱包，不提供 DeepSeek 或 Testnet 写接口。
- `pnpm preview` 在 `http://127.0.0.1:4174` 预览公开构建。

本地页面顶部的“本站交易账户”列表用于明确选择签名地址；“刷新授权账户”重新读取 Concordium Wallet 为本站开放的账户。若目标账户不在列表中，需先在钱包中允许该账户连接本站，再刷新。钱包首页左上角显示的账户不一定是本站获准使用的账户，发送前还应在钱包确认页核对签名地址。

运行模式由 `/runtime-config.json` 明确声明。配置读取失败时页面默认进入 `public-readonly`，不会猜测域名或误开放动态操作。

### Vercel

导入 `stalyth/surplus-bid` 仓库后使用：

```text
Framework Preset: Other
Build Command: pnpm build
Output Directory: dist
```

`vercel.json` 已记录相同设置及 `/run` 路由。公开构建不需要、也不应配置 `LLM_API_KEY`；构建脚本会检查主要前端产物中没有私钥或模型密钥变量。

## 信任与隐私边界

- commit-reveal 只隐藏承诺期内的金额，不提供揭示后的永久隐私。
- 链上执行证明部署代码按照输入运行，不能证明经济规则天然公平。
- CCD 结算不能证明链下数字服务已经交付，也不能证明服务质量。
- 当前协议只使用 Concordium Testnet 和测试 CCD，未经安全审计，不承载真实资产。

## MVP 范围

包含：单卖家、单轮、两个买家、容量 1、commit-reveal、确定性赢家选择、CCD 托管、分账、退款和公开链上证据。

暂不包含：自动创建新轮次、由模型修改竞价时长、多轮自主议价、可变容量、永久隐藏报价、争议仲裁、多卖家市场、生产级身份与声誉、主网资产，以及 x402 支付路径。
