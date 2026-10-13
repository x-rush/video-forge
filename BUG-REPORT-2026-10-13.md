# video-forge Bug 反馈

**日期**：2026-10-13
**报告人**：小拾（x-rush 的制作 agent，经小拾/MV 项目实测发现）
**严重级**：中（功能性缺陷，有 workaround，但会误导自动化脚本开发）

---

## Bug 1：`--advanced-json` 模式下 CLI 仍强制要求 `--prompt` 参数，且两处 prompt 可能不一致

### 现象

使用 `--advanced-json`（JSON 内含 `prompt` / `first_frame_image` / `last_frame_image`）时，
若不同时传命令行 `--prompt`，CLI 直接报错退出：

```
❌ 缺 --prompt（总得告诉它拍什么）
```

### 复现

```bash
# JSON 内已有 prompt 字段，但缺命令行 --prompt → 报错
node scripts/gen-video.mjs --model h3-max-turbo --advanced-json adv.json \
  --resolution 768P --duration 10 --out ./out
```

### 期望行为（二选一）

1. `--advanced-json` 内的 `prompt` 字段被识别，无需命令行 `--prompt`（推荐——JSON 本身就是完整请求体）
2. 或文档明确说明：`--advanced-json` 模式下 `--prompt` 仍为必填参数，JSON 中的 prompt 字段会被忽略/仅作记录

### 实际影响

自动化脚本（批量生成）按 API 文档直觉把 prompt 放进 JSON，导致整批双帧任务失败。
本次 MV 项目 25 段中 5 段双帧全部因此失败重跑。

### 当前 workaround

`--advanced-json adv.json --prompt "..."` 同传——命令行 --prompt 覆盖/兜底。

### 附加建议

若两个 prompt 来源都存在（JSON + 命令行），建议 CLI 在不一致时打 warning（哪个生效），
避免"JSON 里写了 A、命令行传了 B、实际用 B"的静默覆盖。

---

## Bug 2（次要）：预算拦截发生在「💳 估算」打印之后，自动化脚本难以区分「估算打印」与「实际提交」

### 现象

月预算将满时，CLI 打印 `💳 本发估算 $0.19` 后以 exit 2 退出并提示「继续须用户明示同意」。
自动化脚本只能靠 exit code + stderr 文本匹配来区分「已提交但失败」与「未提交被拦截」。

### 影响

本次实测确认拦截发生在提交前、fal 未计费——**无资金损失**（这点设计得好）。
但自动化脚本若把「💳 估算」行误读为「已提交」，会错误地把该段标记为已完成。

### 建议

- 被预算拦截时输出一行机器可读标记，如 `[BLOCKED:BUDGET]`
- 或区分 exit code（如预算拦截 exit 3，其他错误 exit 2）
- 文档 `budget` 相关章节说明「估算打印 ≠ 已提交」

---

## 环境信息

- video-forge 版本：本地 ~/.agents/skills/video-forge（2026-10 时点）
- 模型：fal/h3-max-turbo 768P
- 场景：MV 批量生成 25 段（12 成功 / 5 段双帧失败 / 8 段预算拦截）
- 预算拦截机制工作正常（提交前拦截，无资金损失）——本反馈仅针对可观测性
