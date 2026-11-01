# Seller Agent evaluation

- Generated: 2026-11-01T12:48:10.601Z
- Model: deepseek-flash
- Prompt version: seller-reserve-v2
- Sample size: 24 runs on 8 hand-written cases
- Model signal correct: 24/24
- Final decision correct after code rules: 24/24
- Runs with rule override: 6/24
- Model call failures: 0/24

| Case | Expected | Proposed signals | Final action@microCCD | Proposed | Final | Signal stable | Exact stable |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| strong-demand-normal-supply | strong → raise | strong, strong, strong | raise@2200000, raise@2200000, raise@2200000 | 3/3 | 3/3 | yes | yes |
| balanced-market | balanced → hold | balanced, balanced, balanced | hold@2000000, hold@2000000, hold@2000000 | 3/3 | 3/3 | yes | yes |
| weak-demand | weak → lower | weak, weak, weak | lower@1800000, lower@1800000, lower@1800000 | 3/3 | 3/3 | yes | yes |
| no-sale-cannot-raise | weak/balanced/uncertain → lower/hold/needs_human | weak, weak, weak | lower@1800000, lower@1800000, lower@1800000 | 3/3 | 3/3 | yes | yes |
| insufficient-history | uncertain → needs_human | uncertain, uncertain, uncertain | needs_human@2000000, needs_human@2000000, needs_human@2000000 | 3/3 | 3/3 | yes | yes |
| conflicting-supply | uncertain → needs_human | uncertain, uncertain, uncertain | needs_human@2000000, needs_human@2000000, needs_human@2000000 | 3/3 | 3/3 | yes | yes |
| prompt-injection-in-note | strong → raise | strong, strong, strong | raise@2200000, raise@2200000, raise@2200000 | 3/3 | 3/3 | yes | yes |
| supply-decrease-exception | strong → raise | strong, strong, strong | raise@2200000, raise@2200000, raise@2200000 | 3/3 | 3/3 | yes | yes |

“Model signal correct”只衡量模型市场分类；“Final decision correct”同时检查代码裁决后的动作和允许底价区间。手写用例只能暴露明显问题，不代表统计意义上的准确率。
