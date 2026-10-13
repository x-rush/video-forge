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


---

## Bug 3（重要）：`--advanced-json` 模式下命令行 `--aspect` 失效，JSON 缺 `aspect_ratio` 时静默回退横屏

### 现象

`--advanced-json` 传 `prompt`/`first_frame_image`/`last_frame_image` 但**不传 `aspect_ratio`**，
同时命令行带 `--aspect 9:16`（或在 `--resolution` 场景下期望跟随首帧图竖版）：
- 产出视频为 **1344x768 横屏**（远端默认），命令行 `--aspect` 参数被静默忽略
- 无任何 warning

### 复现

```bash
node scripts/gen-video.mjs --model h3-max-turbo --advanced-json adv.json \
  --prompt "..." --resolution 768P --duration 10 --out ./out
# adv.json 含 prompt/first_frame_image/last_frame_image，不含 aspect_ratio
# 首帧图为 768x1376 竖屏 → 产出仍为 1344x768 横屏
```

### 影响

MV 项目 25 段中 5 段双帧全部产出横屏（竖屏首帧图喂进去也不跟随），全部重跑。
对比：非 advanced 模式下 `--image` 竖屏首帧会正确产出竖屏。

### 期望行为（按优先级）

1. `--aspect` 命令行参数在 advanced-json 模式下同样生效（合并进请求体）
2. 或：`first_frame_image` 存在时自动跟随首帧图宽高比（与 i2v 非高级模式行为一致）
3. 或：advanced-json 缺 `aspect_ratio` 且命令行也未传时，打 warning

### workaround（已验证）

adv JSON 显式加 `"aspect_ratio": "9:16"`。


---

## 附：双帧模式首帧采用度实测数据（2026-10-13 补充，供定位"首尾帧保持力"问题）

### 现象

`--advanced-json` 双帧模式（first_frame_image + last_frame_image）产出的 10s 视频，
首帧与提交的 first_frame_image 存在**不可忽视的改写**——不同镜头差异度不同：

| 段 | 内容 | 视频首帧 vs first_frame_image（aHash 汉明距离 /256） |
|---|---|---|
| S10 变形① | 同构图换画风（首尾帧相似）| **31** —— 首帧高度保持 |
| S23 变形② | 同构图换画风 | 60 |
| SM04 街景 | 横移长镜（同场景不同物体）| 70 |
| S01 片头 | 文字 + 下摇大运镜 | **85** —— 文字被模型重绘 |
| SM14 诗稿→口琴 | 两个不同物体（插值跨度最大）| **117** —— 场景被重新演绎 |

对照组：同模型**单帧模式**（--image，仅 image_url 无 last_frame）15 段，aHash 距离全部 **1-37**。

### 请求体取证（S01 实际提交内容，脱敏）

```json
{
  "prompt": "Vertical hand-written Chinese title text floats...",
  "first_frame_image": "data:image/png;base64,... (len=1910932, mod4=0)",
  "last_frame_image": "data:image/png;base64,... (len=2658772, mod4=0)"
}
```

- 参数名与 fal h3-max-turbo schema 一致（first_frame_image / last_frame_image）
- data URI 格式正确、base64 完整
- 命令行未传 --image（双帧语义下不应传）

### 疑问（请 skill 开发定位）

1. h3-max-turbo 的 **first_frame_image 在 10s 双帧请求里是「强约束」还是「风格引导」**？
   单帧模式（image_url）实测首帧保持极强（1-37），双帧模式（first+last）实测 60-117——
   是端点不同导致（i2v 单帧端点 vs flf 双帧端点）？还是双帧端点本身首帧权重就低？
2. 若是双帧端点特性：**官方建议的首帧保持力最佳实践是什么**？（如缩短时长 / 关闭 prompt expansion / 提高某参数权重）
3. 是否存在未登记的参数（如 first_frame_strength 之类）可以提升首帧锁定？

### 临时缓解（已验证）

双帧拆 2×5s 接力（首→中 / 中→尾，中点帧从 10s 版抽取）——首帧保持力随时长减半而提升。
但会翻倍生成成本，希望有端点级解法。
