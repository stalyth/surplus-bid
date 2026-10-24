# SurplusBid

SurplusBid 的目标是在 Concordium Testnet 上实现 Agent-to-Agent 密封竞价与 CCD 结算。多个买家 Agent 竞争一份数字服务容量，智能合约通过 commit-reveal 隐藏承诺期内的底价和报价，再按照预先固定的规则选择赢家、计算成交价、分配交易剩余，并执行收款与退款。

## 当前阶段

项目处于 W2 行走骨架阶段。

- 已验证旧版拍卖合约的部署、空轮结束、单买家成交、CCD 分账与退款。
- W2D2 `surplus_bid` 合约已实现 commit-reveal、保证金、报价补足、赢家选择、交易剩余费用、分账与退款。
- 双买家闭环、费用阈值与取整、卖家未揭示赔付、错误阶段和重复结算已通过本地 Wasm 测试。
- 旧 `auction-spike` 已在 Testnet 验证，但只采用买卖双方各固定 0.2 CCD 的历史费用规则。
- 浏览器 Web App 已接入 `@concordium/web-sdk` 12.0.2；已在 Testnet 部署当前 Wasm、创建 0 CCD 实例 [`<13006,0>`](https://ccdexplorer.io/testnet/contract/13006/0)，并通过 `view` 读回 `Idle` 状态。

不要使用旧合约的链上交易证明目标费用规则已经完成。

## 核心演示场景

卖家以 2 CCD 底价出售一份 Priority AI Analysis；买家 A 报价 4 CCD，买家 B 报价 6 CCD。当前演示暂用中点定价。目标结果、费用规则与资金流见父工作区的 [范围表](../docs/scope.md) 和 [演示故事板](../docs/storyboard.md)。

## 仓库结构

- `app/`：无框架、无新增依赖的浏览器行走骨架。
- `src/rules.mjs`：页面与测试共用的固定演示规则。
- `test/`：成功路径、失败路径、费用阈值与未定舍入规则测试。
- `contracts/sealed-auction/`：当前 W2D2 commit-reveal 合约与 Wasm 集成测试。
- `contracts/auction-spike/`：保留的旧费用规则合约与历史验证代码。
- 父工作区 `../docs/`：唯一的产品文档来源，包含 Brief、范围、故事板、架构、验证记录和公开 Testnet 证据。

## 启动行走骨架

本地需要 Node.js。当前机器使用 Node 26.5.0 完成验证；目标基线 Node 22 尚待单独验证，不能据此声称已经兼容。
页面用仓库锁定的 `@concordium/web-sdk` 12.0.2 加载浏览器 SDK；静态服务器只公开该 SDK 的浏览器构建，不公开整个 `node_modules`。

```sh
pnpm dev
```

浏览器打开 `http://127.0.0.1:4173`。页面可以依次完成：

1. Seller Agent 提交底价承诺与保证金；
2. Buyer Agent A、B 分别提交报价承诺与保证金；
3. 卖家先揭示底价，买家再揭示并补足到完整报价；
4. 验证提前结算被拒绝，并在揭示期结束后展示目标分账；
5. 读取仓库内已有的真实 Testnet 旧规则证据。

点击右上角“连接钱包”会请求 Concordium Wallet 账户，并核对选中的网络是 Testnet。页面已提供“部署 → 0 CCD 创建 → view”的最小真实链路；承诺、揭示和结算仍是本地预览，不发送交易。金额使用整数 microCCD；中点与单方平台费均向下取整。

运行浏览器规则测试：

```sh
pnpm test
```

运行浏览器规则测试与现有 Concordium 合约构建测试：

```sh
pnpm check
```

## 验证现有合约

需要 Rust 1.85.1、cargo-concordium 4.2.0，以及锁文件中的 Concordium crates。若工具已位于 `/private/tmp/concordium-toolchain`，脚本会自动使用它们：

```sh
./scripts/check-contract.sh
```

该命令构建当前 `surplus_bid` Wasm 并运行合约集成测试。它证明本地执行行为，不能代替真实 Testnet 验证。

## 下一步

1. 用已连接的钱包调用 `start_round`，验证卖家 2 CCD 保证金和链上阶段边界。
2. 在 Concordium Testnet 跑通双买家承诺、揭示、结算和资金对账。
3. 记录同一轮交易的 CCDExplorer 链接，并把三分钟 Demo 固定到这组证据。

项目仅使用测试网与测试 CCD，尚未经过安全审计。
