# SurplusBid

SurplusBid 是一个运行在 Concordium Testnet 上的 Agent-to-Agent 公开竞价与 CCD 结算项目。多个买家 Agent 竞争有限的数字服务容量，智能合约按照报价前固定的规则选择赢家、计算成交价、分配交易剩余，并执行收款与退款。

## 当前阶段

项目处于 spike 之后、W2 行走骨架开始之前。

- 已验证旧版拍卖合约的部署、空轮结束、单买家成交、CCD 分账与退款。
- 双买家闭环已通过本地 Wasm 测试，尚未完成真实 Testnet 验证。
- 当前合约仍使用买卖双方各固定 0.2 CCD 的旧费用规则。
- 目标规则是按交易剩余的 10% 收费并由买卖双方均摊；该规则尚未实现或验证。
- Web App、固定规则 Agent 和 x402 服务交付链路尚未实现。

不要使用旧合约的链上交易证明目标费用规则已经完成。

## 核心演示场景

卖家以 2 CCD 底价出售一份 Priority AI Analysis；买家 A 报价 4 CCD，买家 B 报价 6 CCD。当前演示暂用中点定价。目标结果、费用规则与资金流见 [范围表](docs/scope.md) 和 [演示故事板](docs/storyboard.md)。

## 仓库结构

- `contracts/auction-spike/`：已验证的旧费用规则 Concordium 合约与 Wasm 测试。
- `docs/brief.md`：产品定位、核心流程与验收条件。
- `docs/scope.md`：本周范围、目标费用规则与当前验证状态。
- `docs/storyboard.md`：四幕、三分钟 Demo 分镜。
- `docs/architecture.md`：从 Demo 流程反推的 MVP 架构。
- `docs/validation.md`：现有本地与 Testnet 验证记录。
- `docs/evidence/`：可机器读取的 Testnet 公开证据。

## 验证现有合约

需要 Rust 1.85.1、cargo-concordium 4.2.0，以及锁文件中的 Concordium crates。若工具已位于 `/private/tmp/concordium-toolchain`，脚本会自动使用它们：

```sh
./scripts/check-contract.sh
```

该命令构建实际 Wasm 并运行合约测试。它只验证当前旧费用规则；目标百分比费用规则完成后必须新增相应测试并重新部署到 Testnet。

## 下一步

1. 建立能由一条命令启动的 Web App 行走骨架。
2. 实现按交易剩余收费的合约规则和 microCCD 舍入规则。
3. 完成本地测试及双买家 Testnet 资金对账。
4. 验证 x402 是否能承担赢家服务交付授权，并避免与 CCD 合约结算重复收费。

项目仅使用测试网与测试 CCD，尚未经过安全审计。
