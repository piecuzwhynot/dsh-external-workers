# dsh-external-workers 使用说明

[English](USAGE.md) | 中文

---

## 1. 三十秒心智模型

- **DSH agent = 统筹者。** 它仍然是大脑：做计划、做决定、跟你说话。
- **worker = 三个产品；泳道（lane）= 外包。** 一条**泳道** = 一个产品 + 一个模型 + 一个分工，
  有自己的办公室（工作目录 `~/.dsh/workers/<lane id>`）、自己的记忆（持久会话）、自己的工具。
  你不把东西交给它们，它们就看不见你的项目。
- **一次作业 = 一份契约。** 你递过去一个任务包，拿回来结果、决策清单、产物清单、阻塞清单。
  作业记录落盘，所以什么都不会丢。
- **没有隐含行为。** 不自动路由，不偷偷传上下文。你想让 worker 知道什么，就写进任务包。

---

## 2. 第一次使用

### 2.1 看谁准备好了

跟 agent 说：

```
列出外部 worker 工具，然后跑 check_external_job 给我看泳道清单
```

`check_external_job` 会打印一份 **Lanes** 清单 —— 每条泳道一行：

```
- main [claude] example lane: planning and code review · opus effort high · state=ready · session=7d41f9b2-… · cli=C:\Users\you\.local\bin\claude.exe
- quick [gpt] example lane: fast edits and scripted chores · gpt-6-luna effort medium · state=ready · session=3c8ae501-… · last ran gpt-6-luna · cli=C:\Users\you\AppData\Local\OpenAI\Codex\bin\…\codex.exe
- research [google] example lane: research and data gathering · gemini-3.1-pro-high effort high · state=needs-login · session=none · cli=(unresolved)
```

每行依次是：泳道 id、方括号里的产品、分工、它被设定要跑的模型 + 档位、**状态**、它**自己的**会话号、
跑过之后附上上次**实际**跑的模型，最后是**它解析到的 CLI 可执行文件**（或解析报错、或 `(unresolved)`）。
`state` 取值：`ready`、`idle`、`needs-login`、`cli-missing`、`error`；
只要不是 ready/idle，后面都会附上原因 —— 那就是你该修的地方，而这一行上的路径就是用来核对修好没有的。
每个列表都会带上这份清单（哪怕一个作业都没有）；
`check_external_job(lane: "quick")` 可以把作业收窄到某一条泳道。

### 2.2 把泳道建好（只做一次）

```
把三个外部 worker 的可用模型列出来
```

这会调 `worker_config(action: "models")`，它是从**产品本身**读的（Codex 自己的模型缓存、
`agy models`、Claude 文档里的别名）—— 不会编造模型名。
某个产品刚发了新模型、不想用它的缓存时，加 `fresh: true`。

然后在一条消息里把分工说清楚：

```
分工这样设，一种活一条泳道：
- 在 gpt 上开一条泳道 "lore"：分工"写 lore"，模型 gpt-6-luna，effort medium，speed priority
- 在 gpt 上开一条泳道 "models"：分工"做 3D 模型"，模型 gpt-6.1-sol，effort xhigh，speed priority
- 把 "main" 泳道（claude）的分工设成 "UI / 前端"，模型 opus，effort high
```

一条泳道 = 一个产品 + 一个模型 + 一个分工，各自有独立的持久会话。为什么不一个产品一个会话？
因为 Codex 和 Claude 都把会话绑在**一个**模型上，用别的模型去续接那个 thread 就会退化 ——
所以 `gpt` 需要泳道 `lore`（luna）和泳道 `models`（sol）两个各自独立的会话。

每次 `worker_config(action: "set", …)` 都会把分工**写进磁盘、也写进那个产品的工具描述**，
所以之后统筹者不用被提醒就知道谁干什么。
用 `action: "add"` 在产品上新建泳道，用 `action: "remove"` 把运行时建的泳道从清单里删掉
（写在 `config.json` 里的泳道还会从那个文件里回来 —— 要删得改那个文件）；
`clear: true` 会把你点名的字段清掉，一个都不点名就四个一起清。
用 `worker_config(action: "show")` 确认 —— 它会给出泳道、产品、分工、模型、档位、速度、会话，
以及每条泳道上次实际跑的模型。

泳道 id 写成裸的产品名时，只要那个产品已经有具名泳道，就会被拒绝。

---

### 2.3 接一个新 CLI 进来（豆包 / 千问 / Kimi / Grok …）

上面三个是**手写适配**的。别的都能**用描述接进来** —— 在 `config.json` 的 `products` 里写一份配置，
**不用改代码**：

```json
"products": {
  "kimi": {
    "label": "Kimi CLI",
    "bin":   { "names": ["kimi.exe", "kimi"], "roots": ["~/.kimi/bin"], "hint": "install kimi" },
    "args":  { "base": ["-p", "{prompt}"], "resume": ["--resume", "{session}"], "extra": ["--output-format", "json"] },
    "output": { "format": "json", "session": "session_id", "text": "result", "model": "model" },
    "models": { "command": ["models"], "format": "lines" }
  }
}
```

重启 `dsh web` 之后，这个产品就有自己的 `delegate_kimi` 工具、自己的泳道、自己的会话、
丢不了的作业和面板卡片 —— 跟内置的三个一模一样。

**诚实的写法：别自己硬啃。** 让 agent 去弄：

```
我刚装了 kimi CLI，在 ~/.kimi/bin/kimi.exe。把它接进外部 worker 插件：
跑一下它的 --help，搞清楚一次性提问、续接会话、指定模型分别用什么参数，
然后把 product recipe 写进 config.json。再给它开一条泳道，用一个很小的任务证明它能跑。
```

agent 能读 `--help`、能真跑一次看它到底输出什么形状，然后把 recipe 填好。
真正需要"看"的只有三处：`args`（有哪些 flag）、`output`（会话号和正文在返回里的哪个位置）、
`models`（怎么列模型）。

**每一块怎么起作用**（你可以自己核对一份 recipe）：

| 字段 | 意思 |
|---|---|
| `bin.names` | 在 `PATH` 上找的可执行文件名。 |
| `bin.roots` | 在这些目录里找最新的 `bin.file`（默认就是第一个 name）。 |
| `bin.hint` | 找不到 CLI 时报错里带的话。 |
| `args.base` | 永远排最前。CLI 的提示词紧跟 flag 时，写 `["-p", "{prompt}"]`。 |
| `args.resume/model/effort/speed/cwd` | 只有这次运行真的有那个值时才出现。 |
| `args.images` | 每张图重复一次，可以用 `{image}` 和 `{index}`。 |
| `args.prompt` | 提示词单独放，位置靠后（Codex 那种形状）。 |
| `args.extra` | 永远排最后 —— 输出格式之类的 flag 放这。 |
| `output.format` | `json`（一个信封）、`jsonl`（每字段取最后一次）或 `text`。 |
| `output.session/text/error/model` | 往解析结果里走的点号路径，比如 `data.session.id`。 |
| `output.sessionPattern` | `text` 输出时用：带捕获组的正则，从 stdout 里抠出会话号。 |
| `models.command/format/path` | 那个 CLI 自己的列模型命令，按 `lines` 或 `json` 读。 |

拼接顺序是：**base, cwd, resume, model, effort, speed, images, prompt, extra**。
某一段里只要有占位符取不到值，**整段丢掉** —— 所以 `base` 和 `extra` 只准用一定有值的占位符
（`{prompt}`、`{cwd}`、`{timeout}`），别的会在校验阶段就被拒，免得它悄悄把整段吃掉。

写错的 recipe 会被指名道姓拒掉：缺 `bin`、占位符不认识、`sessionPattern` 没有捕获组、
格式不是 `json`/`jsonl`/`text`。这些错误在插件启动时和 `worker_config` 里都会打印 ——
所以打错字不会变成一桩悬案。

**一个要有心理准备的坑。** 如果那个 CLI **报不出会话号**，桥就没法续接：该泳道的每次委派都是新对话。
这不算错误，但这就是"记得昨天的 worker"和"不记得的 worker"的区别 —— 先看 `output.session`
或 `output.sessionPattern`。

### 2.4 额度和 credits（为什么 gpt 有时候会停下来问你）

`delegate_gpt` 在**开始任何事之前**先读 Codex 自己记的用量。有两种情况会让它停下来问你，而不是直接跑：

| 它看到什么 | 它会怎么做 | 你怎么继续 |
|---|---|---|
| 5 小时窗口或每周窗口到了 `quota.warnAtPercent`（默认 90）及以上 | 把真实数字报给你，**什么都不启动** | 你说继续，下一次调用带 `allow_quota: true` |
| 套餐额度已经用完，这次运行会**计费到 credits** | 同样停下，但会明说 | 只有你能批准花钱：`allow_credits: true` |

两个开关**故意分开**：同意突破 90% ≠ 同意花钱。

真的花了 credits 的那次运行，金额会出现在作业上（`check_external_job`、面板里的作业详情）和完成通知里：

```
⚠️ credits spent: $0.4242 (balance was $42.5000)
```

数字从哪来、又覆盖不到什么：

- Codex 每一轮都会往自己的 rollout 文件（`$CODEX_HOME/sessions/**`）里写一份额度快照。
  **每一个** Codex 面都写在那里 —— 本插件的泳道、Codex 桌面 app、CLI ——
  所以就算你是在 DSH 之外用的 Codex，读数也是新的。不走网络、不读凭据。
- **Claude Code 和 agy 什么都报不出来。** Claude 算得出 5 小时 / 每周用量，但只在它的 TUI 里渲染；
  agy 不记数字。所以桥对它们**什么都不说**，而不是编一个数字 ——
  而撞到硬上限仍然会被反应式地抓到：作业变成 `failureKind: quota`，你可以 `resume_external_job`。
- credits 是拿运行**前**和运行**后**的余额相减算出来的。中途拦不住：
  worker 就是一个 CLI 进程。所以它的保证是"花钱绝不静默，且下一个任务必须你点头"，
  而不是"任务跑到一半能停下来问你"。

面板上也能实时看到：页签上方有一条额度条，列出每个产品的窗口、重置倒计时和 credits 余额，
按你设的阈值变色，额度用完时还有一个红色的"将用 credits"标记。

---

## 3. 派活

### 3.1 怎么说

**不需要**点名工具。说你要做的事，agent 自己会路由 —— 你设的泳道（分工和模型）就印在每个 `delegate_*` 的描述里。

```
让 gpt 把这 3 个文件里的重复代码抽出来，写成 lib/shared.js，跑一遍它的测试确认没坏，
然后你把结果拿回我项目里。
```
```
让 claude 审一下这个模块的边界情况，把缺的测试写进它自己的目录。
```
```
让 google 调研 X 的三个方案，写成对比表放进它自己目录，做完你读出来给我。
```

### 3.2 一次好的委派该包含什么

`delegate_*` 接受这些参数，统筹者应该尽量填：

| 参数 | 为什么重要 |
|---|---|
| `task` | 完整、自包含的任务描述。worker 对你的项目、这段对话**一无所知**。 |
| `context_files` | 会被内联进任务包的路径（文件或目录清单）。worker 就是靠这个了解你的代码。 |
| `logs` | 日志文件，尾部会被内联。 |
| `images` | 截图路径（Codex 还会把它们当真实图片附件收下）。 |
| `references` | 自由文本的备注、URL、事实。 |
| `acceptance` | 明确的验收标准，会写进任务包。 |
| `lane` | 在哪条泳道里跑。**不填就是那个产品的第一条泳道。** 泳道不存在、或属于另一个产品，都会被明确报错拒绝。 |
| `cwd` | 工作目录。**默认是这条泳道会话所在的目录** —— 新建的泳道就是它自己的工作区（`~/.dsh/workers/<泳道 id>`）；接手了老会话的泳道则是那个会话原来的目录（这些 CLI 是**按工作目录存会话**的）。想保持会话连续性就保持默认。 |
| `model` / `effort` / `speed` | 只对这一次覆盖这条泳道的常设配置。 |
| `new_session` | `true` 开一个干净的 worker 会话。默认 `false` = 续接现有的。 |
| `foreground` | `true` 就在同一次工具调用里等结果。默认 `false` = 立刻返回作业 id。 |
| `timeout_minutes` | 到点强杀。默认 30。 |

**判断标准**：如果你需要向一个从没见过你仓库的外包解释清楚，那就把它写进委派里。

### 3.3 默认后台执行

`delegate_*` 立刻返回：

```
Started gpt job **ext-3** (lane `models` · continuing its session 3c8ae501-…).
Poll it with `check_external_job` (job_id: ext-3).
它就算这段对话被压缩、harness 被重启，也会继续跑。
```

跑完之后，**发起它的那个会话**会收到一条通知：

```
[external-workers] gpt job ext-3 completed (worker session 3c8ae501-…).
<摘要>  artifacts: …
Read the full result with check_external_job.
```

任何时候、任何会话都可以要全文：

```
检查外部作业 ext-3，把输出和 stderr 尾部都给我
```

---

## 4. 把产物拿进你的项目

每条泳道写在**它自己的**目录里：

```
~/.dsh/workers/<lane id>/jobs/<job-id>/
├─ packet.md      ← 它被告知了什么
├─ stdout.log     ← 产品原始输出
├─ stderr.log
└─ out/           ← 交付物按约定写这里
```

它们**写不进你的项目**（这是故意的）。要落地：

```
读一下 ext-3 的产物，应用到 C:\Users\me\Desktop\myproject，然后把 diff 给我看。
```

统筹者有完整文件权限，所以这就是一次普通的 DSH 编辑 —— 由它 review、在你的仓库里、走你平常的流程。

> 想让 worker 直接在项目里干活？在委派里传 `cwd`。
> 注意：Claude Code 和 Antigravity 的会话是**按目录作用域**的，所以到处移动的 worker 会丢掉线索连续性、
> 重新开一个会话（桥能检测到失效会话并自动恢复，但上下文没了）。

---

## 5. 作业没跑完的时候

每个终态都是显式的，永远不会被静默丢弃。

| 状态 | 含义 | 怎么办 |
|---|---|---|
| `completed` | worker 产出了最终答复 | 读它 |
| `blocked` | 根本跑不起来：CLI 缺失、未登录、config 里禁用 | 修好原因，然后 `resume_external_job` |
| `retryable` | 暂时性：额度、超时、进程崩溃、跑到一半 harness 重启 | `resume_external_job` —— 同一个 worker 会话，不用从头来 |
| `failed` | worker 跑了但报错（真实的任务失败） | 读错误；用更好的任务包重新委派，或带着指令 resume |

```
resume_external_job(job_id: "ext-4", instruction: "…")
```

它会创建一条**新的**作业记录去继续**同一个**外部会话 —— 原记录绝不改写，历史保持诚实。

---

## 6. 每个 worker 究竟能做什么（权限）

worker 只能做它自己 CLI 允许的事。这是三道不同的闸，而且它们**按产品**生效 ——
泳道没有自己的权限设置，`gpt` 的每条泳道都共用 `workers.gpt`。

### Claude Code —— `workers.claude.permissionMode`

| 值 | 效果 |
|---|---|
| `acceptEdits`（默认） | 读文件、改文件。需要审批的 shell 命令在 print 模式下被软拒绝。 |
| `bypassPermissions` | 全信任：无人值守，什么都能跑。 |
| `plan` / `manual` / `dontAsk` / `auto` | Claude Code 的其它模式。 |

```json
"workers": { "claude": { "permissionMode": "bypassPermissions" } }
```

### Codex —— `workers.gpt.sandboxMode` / `approvalPolicy`

| 值 | 效果 |
|---|---|
| `workspace-write`（默认）+ `approvalPolicy: "never"` | 命令无人值守地跑，被 Codex 自己的沙箱限制住 |
| `read-only` | 只能看 |
| `danger-full-access` | 不设限 |

### Antigravity CLI（`agy`）—— 授权写在它的**共享**配置里

`agy` 在无头模式下**无法弹审批**。需要审批的工具会被软拒绝 —— 而且关键是，
**它仍然返回 `status: SUCCESS` 和一个空 response**。（桥正好检测这一点：
"成功但没有输出"会被当作失败，并附上真实原因。）

授权位置是 **共享** 的 Antigravity 配置 —— **不是** `~/.gemini/antigravity-cli/settings.json`
（这个版本不读那个文件）：

`~/.gemini/config/config.json`

```json
"userSettings": {
  "globalPermissionGrants": {
    "allow": [
      "write_file(C:\\Users\\you\\.dsh\\workers\\google)",
      "command(regex:^(python|py|node)\\b.*)",
      "command(regex:^(Get-ChildItem|ls|dir|cat|type|head|tail|grep|rg)\\b.*)"
    ]
  }
}
```

语法要点（全是硬踩出来的）：

- `write_file(<绝对目录>)` —— **前缀匹配**，它下面所有路径都可写。
  相对路径（`jobs/`）或末尾带反斜杠**都不匹配**。
- `command(...)` **必须用正则形式**。纯前缀（`command(python)`）**匹配不上** `python script.py`。
- 通配符会被拒（`command(*)`、`write_file(*)`）。
- **改完立即生效** —— 每次 `agy` 运行都重读配置。可以从 agy 自己的日志核对：
  `stored shared config permissions: allow=N`。

其它一切（别的命令、授权目录之外的写入）依然是拒绝状态，并且会**如实报成 blocker**，不会静默跳过。

---

## 7. 排错

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 某个会话里没有 `delegate_*` | 被 `scope` 排除了，或那个 agent 早于插件加载 | 看 `scope` 规则；开新会话或重开那个 chat |
| `no lane named "x"` / `lane "x" belongs to worker "y"` | 你传的 `lane` 不存在，或者它属于另一个产品 | `worker_config(action: "show")` 看清单；不传 `lane` 就用那个产品的第一条泳道 |
| 日志里出现 `agent-scoped tools registry unavailable` | 宿主无法从 agent 的 context 解析 `ctx.tools` | 按设计它**什么都不注册** —— 把日志那行发来 |
| `blocked / needs-login` | CLI 装了但没登录 | `claude auth login` / `codex login` / 跑一次 `agy` |
| `blocked / cli-missing` | 找不到二进制 | 安装它，或钉死 `workers.<id>.cliPath` |
| 作业 `retryable`，原因提到 permission | worker 要用的工具被它的 CLI 拒了 | 按第 6 节授权，然后 `resume_external_job` |
| worker"成功"了但结果是空的 | 产品报了成功却没有输出（agy 的典型行为） | 桥已经把它标成失败并附上真实原因 —— 读 `lastError` |
| worker 用错语言回答 | 它跟着任务包的语言走 | 在任务里说明你要哪种语言 |
| 重启后作业不见了？ | 没丢 —— 账本在磁盘上 | 任何会话里 `check_external_job` |

---

## 8. 东西都在哪 —— 以及怎么去看它们

### 网页界面里的面板

输入框**正上方**只有**一行**（和 DSH 自带的 todo / goal / queue 同一块地方）：

```
● 外部 worker   1 运行中   1 完成   1 失败   · 7            [ 详情 ]
```

- **只有存在至少一个作业时才出现** —— 在那之前什么都不渲染，没用过的会话看起来和原来一模一样。
  这一行**永不换行、永不长高**，所以它不可能把输入框挤走。
- **点「详情」会从右侧滑出一个抽屉**，里面两个页签：
  - **泳道** —— 每条泳道一张卡：泳道 id、它属于哪个产品、分工、你要求的模型 + 档位 + 速度、
    **它上次实际跑的模型**（从产品本身读回来的）、状态、这条泳道**自己的**会话号、
    以及它的目录 `~/.dsh/workers/<lane id>`，还有它有多少个作业
    （并有跳转到"只看它的作业"的快捷按钮）。
  - **作业** —— 按泳道过滤的胶囊按钮，然后每个作业一行（状态、产品、**泳道**、**模型 + 档位**、
    作业号、耗时、产物数、任务、失败时的错误）。**点任意一行打开完整视图**：泳道、*完整*结果全文、
    全部产物路径、原始错误、stderr 尾部、以及磁盘上的文件位置 —— 一个字都不截断。
- 抽屉**自带滚动条**，并且有三种关法：✕ 按钮、`Esc`、或者再点一次「详情」。
- 会话打开期间每 6 秒自动刷新；数据来自插件**自己宿主侧的只读 JSON 接口**
  （`GET /api/external-workers/jobs` 与 `.../job?id=`），读的就是同一本持久账本。
- 面板显示**全部**作业，不只是这个会话发起的 —— 账本是进程级的，每个作业都记录了它来自哪个会话。

### DSH 这一侧（工具）

```
check_external_job                      # 所有作业 + Lanes 清单 + 是哪个 DSH chat 发起的
check_external_job(job_id: "ext-3")     # 单个作业全文，含产物
check_external_job(lane: "models")      # 只看某条泳道的作业
worker_config(action: "show")           # 泳道清单：id、产品、分工、模型、档位、速度、会话、上次实际跑的
```

底层文件：

| 路径 | 内容 |
|---|---|
| `$DSH_HOME/storages/external_workers.json` | 持久账本：作业，以及每条泳道一条记录（会话号、工作目录、常设配置） |
| `~/.dsh/workers/<lane id>/jobs/<id>/` | `packet.md`、`stdout.log`、`stderr.log`、`out/`（交付物） |

### 到产品自己的界面里看泳道的会话

每条泳道的会话就是**那个产品里一个正常的会话**，所以你可以在那个产品里打开它，看它到底干了什么：

| 产品 | 怎么打开这条泳道的会话 |
|---|---|
| Claude Code | `claude --resume <lane session id>` —— 或直接读 `~/.claude/projects/<cwd-slug>/<session-id>.jsonl` |
| Codex | `codex resume <thread id>` —— 同一个 thread 也会出现在 Codex 应用自己的会话列表里 |
| Antigravity CLI | `agy --conversation <conversation id>`（交互式），或 `agy -p --conversation <id> "…"` |

两点要知道：

- **Codex 的 worker thread 和你的 Codex 账号历史是同一个库。** 它们是独立的 thread（不会混在一起），
  但**会出现在 Codex 应用里**。要物理隔离，就给 `workers.gpt` 指定独立的 `CODEX_HOME` 并在那里登录一次。
- **Antigravity 的 worker 会话不会出现在 Antigravity IDE 里** —— CLI 自己一套存储
  （`~/.gemini/antigravity-cli/`），和 IDE 的（`~/.gemini/antigravity/`）是分开的。
- 你手动往 worker 会话里打字是允许的（它就是个普通会话），但桥会继续往同一个 thread 里派活，
  所以别在作业跑着的时候插话。

### 排查用的原始来源

| 路径 | 内容 |
|---|---|
| `~/.claude/projects/…` | Claude Code 自己的会话记录 |
| `~/.codex/sessions/…` | Codex 的 thread rollout（`rollout-<时间>-<thread-id>.jsonl`） |
| `~/.gemini/antigravity-cli/conversations/…` | Antigravity 的会话 |
| `~/.gemini/antigravity-cli/brain/<conversation>/…/transcript.jsonl` | agy 逐步的工具调用 —— **排查权限拒绝最好的来源** |
| `~/.gemini/antigravity-cli/log/cli-*.log` | 能看到 agy 实际加载了几条权限授权 |

---

## 9. 几个值得知道的设计点

- **工具目录每一步都重建**，所以给一个会话挂工具**不需要重启那个会话**，`worker_config` 的改动下一步就生效。
- **泳道的会话 id 就是契约。** 它按泳道存储、每次运行后更新、用来续接。失效的 id
  （会话被删、工作区被移）会被检测到，并**恰好一次**地回退到开新会话。
- **两种"会话"是不同的东西。** DSH 会话（你的 chat）和泳道的会话（那个产品自己的对话）互相独立。
  压缩其中一个，绝不会碰另一个。
- **从没有泳道的版本升级。** 以前的记录是按产品名做键的。只要 `config.json` 里声明了具名泳道，
  **每个产品的第一条泳道就会接手该产品原来的记录**：会话号、**工作目录**、状态都带过来，你原有的 thread 不会丢。
  工作目录**是故意跟着一起走的** —— 这些 CLI 是**按工作目录存会话**的
  （Claude Code 的对话文件放在 `~/.claude/projects/<cwd 的 slug>/` 下），换个目录 resume 可能根本找不到那个会话。
  所以从 `claude` 改名来的泳道仍然在 `~/.dsh/workers/claude/` 里干活；只有真正新建的泳道才拿到 `~/.dsh/workers/<泳道 id>/`。
  同一产品的后续泳道是**故意**从新会话开始的；接手记录里旧的 `role`/`model`/`effort`/`speed` 不保留 ——
  那四个以前是按产品整体设的，描述不了任何一条具体泳道。
  老作业不带泳道 id，读取时回落到产品名；账本本身绝不改写。
