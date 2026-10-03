# dsh-external-workers

> **给 DeepSeek Harness 用的持久化外部 agent worker。** 把长任务丢给 **Claude Code**、**Codex CLI**
> 和 **Antigravity CLI** —— 走它们各自的官方 CLI 和你**已有的订阅登录** —— 作业在重启和上下文压缩之后依然存在。

有任何问题可以在抖音找我-抖音号：61302110494

[English](README.md) | **中文**

---

## 为什么不干脆让 Claude / GPT 当主脑？

因为账算不过来，而且"便宜又通用"和"这件事上最好"是两码事。

DeepSeek 便宜到可以让**说话本身成为默认动作** —— 想事情、讨论方案、读一段日志、改一小处、随手确认一下。
这些交给高价模型，是花大钱换来接近于零的收益。所以主脑留在原地：DSH 拿着对话、计划和上下文，
它才是你说话的那个对象。

但 DSH 不该**什么都**干。有些活不是价钱问题，是**种类**问题：

- **仓库级别的自主工作** —— 跨 40 个文件的重构、跑测试、修跑坏的地方。Claude Code 和 Codex 自带
  agent harness 和工具，而且那两个订阅你本来就在付钱。
- **一个真正独立的意见。** 换一个模型来审前一个模型的产出，能抓到自审抓不到的东西；
  同一个脑子同意自己，价值很低。
- **不该占着你对话的长时间工作。** 一条泳道在它自己的会话和目录里跑，你聊别的事情它照样在干，
  回来时带着产物和一个你能检查的结果。
- **不同的性格，或者超长上下文** —— 当任务就是那个形状的时候。

所以这个形态是**互补，不是竞争**：**DSH 是统筹者、是对话的主脑；外部 worker 是专家，
你一次交给他们一件自包含的活。** 便宜、快速的对话继续便宜；贵的模型只花在它确实更强的地方。

两条实用的判断标准：

- **跟 DSH 说话；在活很长、很自包含、或者需要另一双眼睛时才派出去** ——
  而不是因为"另一个模型更聪明"。
- **worker 是从零开始的。** 它对这段对话一无所知，所以任务包**就是**你的交代：文件、日志、验收标准。
  这是实打实的成本，也是琐碎聊天该留在这里的原因。

还有一件不是免费的事：worker 花的是你的订阅额度，而 Codex 额度用完会转去扣 credits ——
所以这个插件在**派活之前**先读额度、先问你（见 [额度与 credits](#额度和-creditscodex)）。

## 两件本来就不该由你来做的事

把功能都剥掉，这个插件就干两件事。而这两件事之所以存在，都是因为**原本是一个人在做，而且做得很糟**。

**1. 当那根线。** 没有它的时候，派活意味着**你**要这么干：复制报错、切到另一个 app、粘贴、解释你要什么、
等、把答案复制回来、粘进项目、还得在脑子里维护两个窗口的对应关系。这是**搬运工**的活：
它吃你的注意力、打断你的专注，而且**会掉信息** —— 真正传递过去的其实是**你对报错的转述**，不是报错本身。
在这里，交接是机械的：任务被写成 packet（把真实文件、日志尾部、验收标准都内联进去），
worker 在自己的会话里跑，结果、产物、以及任何失败都变成一条 agent 能读的持久记录。**没有人需要重新打字。**

**2. 当那份记忆。** 没有人什么都记得住 —— **任何模型也一样**。任何会 compact 的 agent 最终都会丢掉细节，
而且这个丢失是**静默的**：如果没有人及时发现并补回去，三个小时前做的那个决定就**不在了**，
任务会悄悄地出问题。把这件事放在某个人的脑子里、或者某一个聊天窗口里，意味着
**一次压缩、一次重启、一个被关掉的标签页，就能让工作崩掉。**

所以一个作业的状态**从不活在对话里**。它活在磁盘上：作业记录、worker 自己的会话号、
交出去的那份 packet、收回来的产物。压缩和重启够不到它，别的会话也能读到它，
而"接着做"这件事**不需要任何人记得那个作业是什么**。

**而且这个丢失变成了机器能处理的事 —— 这恰好是人做不到的那部分。** 你看不出一个 summarizer
悄悄删掉了什么，你能感觉到的只是"这个 agent 变含糊了"。但机器至少能看到**压缩这件事发生过**，
然后去某个持久的地方把状态重新读回来、重新交代给丢了信息的那一方。
**压缩于是不再是一个看不见的洞，而是一个有恢复路径的事件。**

有两条规则让这个说法站得住，因为最朴素的版本其实不成立：

- **worker 之间不是彼此的副本，是不同的分区。** 一条泳道在做项目的一部分，它**从来不知道**
  另一条泳道在干什么，除非有人告诉过它。所以恢复**不来自"别人还记得"**，
  而来自每次交接都写下去的那份持久记录。把会话想成**缓存**、把磁盘想成**真相源**：
  压缩是缓存被清掉，恢复是回源重读。
- **员工越多，不可恢复的丢失概率越低；而"两条泳道各有一套真相"的概率会不会升高，取决于你怎么搭，
  不取决于员工数量。** 有两件事可以把后一个风险直接消掉，而它们都是**你的选择**：

  1. **一块共享的盘。** 让每条泳道都指向同一个交接目录（或者同一个项目检出），各自把结果写进去。
     这样就不存在"各自的私有副本"可以互相打架：每个会话都只是**同一份记录的一个视图**，
     而一条丢了上下文的泳道，只要被告知"去读这几个文件"就能恢复完整。
  2. **每个领域只有一个写者。** 因为每条泳道负责的是不同部分的工作，两条泳道**不是在写同一些事实**，
     而是把**不同的事实写进同一个地方** —— 这才让共享记录是**收敛**的，而不是冲突的。

  在这个搭法下剩下的风险小得多，但仍然值得点名：**纪律**（一条泳道没把自己做的事写下来，
  别人就没有可恢复的线索）和**陈旧**（共享文件可能是**在但旧**，所以关键是要知道"自你上次读之后什么是新的"）。
  作业账本对这两点都有帮助 —— 它带时间戳，而且记下了交出去什么、收回来什么 ——
  但它的前提是：**写，得先发生。**

还有一件**目前还没自动化**的，直说：发现"某个 worker 自己的会话被压缩了"并重新交代给它，
今天仍然是手动的一步（`resume_external_job`，或者重新写一份 packet）。
插件保证的是**状态可恢复**，它还没有在"需要恢复的那一刻"主动盯着。
而且**恢复长什么样，完全取决于你怎么搭泳道** ——
**插件负责搬活、保留记录；而"让一条泳道的产出能被另一条读到"的那块共享目录，是你指给它们的。**
让每条泳道都把同一个项目（或者同一个交接目录）当工作上下文，你就得到了上面说的那种形态：
不是几个 agent 在互相对记忆，而是几个 agent 在读**同一份记录**。

有两件事它**做不到**，直说：

- worker 自己那条很长的线程**照样会内部压缩**。它的产物和 packet 留在磁盘上，它的"记忆"没有。
  这个插件保证的是**交接持久**，不是 worker 的脑子持久。
- 任务包的质量**就等于你往里放的东西**，而且 worker **没法反问你**。
  含糊的想法和小事留在 DSH —— 在那里你可以说得不清不楚。

## 这是什么

一个原生的 DeepSeek Harness（DSH）插件。它给你的会话加 6 个工具，另外**你每声明一个自定义产品就多一个
`delegate_<产品>`**：

| 工具 | 作用 |
|---|---|
| `delegate_claude` | 把任务交给 **Claude Code** worker |
| `delegate_gpt` | 把任务交给 **Codex CLI** worker |
| `delegate_google` | 把任务交给 **Antigravity CLI**（`agy`）worker |
| `check_external_job` | 从磁盘读任意作业 —— 状态、结果、产物、错误 |
| `resume_external_job` | 在**同一个 worker 会话**里继续一个 blocked/失败 的作业 |
| `worker_config` | 列出每个产品**真实的**模型，并管理它的**泳道**（lane：分工 + 模型 + 档位 + 速度） |

**外加网页界面里的一块面板**：输入框上方一行，列出每个作业的实时状态，展开后是一个抽屉，
里面两个页签：**泳道**（每条泳道一张卡：分工、你要求的模型、它上次实际跑的模型、状态、会话、目录）
和**作业**（逐个作业的详情：任务、泳道、worker 会话、产物、错误、结果预览）。
**没有作业时它什么都不渲染** —— 从不委派的会话完全不受影响。

每条泳道都是对应产品里一个**独立的、长期存在的会话**，有自己的工作目录
（`~/.dsh/workers/<lane id>`）、自己的工具链。一个产品可以同时跑好几条泳道 ——
`gpt` 用快模型那条泳道做小改动、用重模型那条泳道啃长活，就是这样分开的。
DSH 依然是统筹者，泳道负责干活。

```
DSH agent（统筹）
   │  delegate_gpt(task, lane: "quick", context_files, logs, acceptance, …)
   ▼
Codex 泳道 quick  ── 在 ~/.dsh/workers/quick/ 里跑 ── 产出 jobs/ext-3/out/*
   │                                              （它自己的持久 thread）
   ▼
磁盘上的持久作业记录  ──►  完成通知回到你的会话
```

## 为什么不直接用内置 subagent？

DSH 自带 subagent 机制，也有官方可选的产品 provider（`@deepseek-ai/dsh-subagent-codex`、
`-claude-code`）。它们**按设计就是一次性的**：新进程、新 thread、只跑一轮 —— 官方 provider 的 README 写得很直白：
*"no continuation, resume, pooling, progress stream, or product-session persistence."*

这个插件是为**完全相反的场景**做的：**同一个 worker，反复用。** 每条泳道保留一个专属会话，
之后派给这条泳道的活都在它上面继续；再加一本落盘的作业账本，所以对话被压缩、harness 被重启，作业都不会丢。

## 和同类项目的区别

我把生态查了一遍（GitHub + `awesome-dsh-plugin` 那 4400 多条列表）。老实说：**这个能力别处有，但没有这个形态。**

| 项目 | 它是什么 | 这里的区别 |
|---|---|---|
| [Enderfga/claw-orchestrator](https://github.com/Enderfga/claw-orchestrator) ★580+ | 一个**独立 runtime**（TypeScript，78 个工具），包住 Claude Code / Codex / Antigravity / Cursor / OpenCode：持久会话、council、dashboard、MCP server、OpenAI 兼容代理 | **能力最接近，架构不同**：它是自己一个 daemon、自己一个端口，你要通过 MCP/HTTP 去够它。而本插件**就是**一个 DSH 插件 —— 一行 composition，没有额外进程、没有额外端口，工具直接出现在会话里。体积也是 ~80 KB 纯 JS，不是一个 runtime。 |
| [mjylfz/dsh-subagent-codex](https://github.com/mjylfz/dsh-subagent-codex) | DSH 插件：在官方 `SubagentProvider` 缝上做一个 `subagent_codex` 工具 | **只有 Codex、且一次性**（每次调用新开一个 Codex 会话），结果是 subagent 形态。本插件覆盖**三个**产品，并且**默认续接同一个会话**。 |
| `@deepseek-ai/dsh-subagent-codex` / `-claude-code`（官方可选） | DSH 官方产品 provider | 官方就是**一次性**；而且 Codex 那个只从 `PATH` 找 `codex`。 |
| [amlyczz/dsh-agy-link](https://github.com/amlyczz/dsh-agy-link)、[darkings/dsh-agy-provider](https://github.com/darkings/dsh-agy-provider)、[DavidRm1911/dsh-llm-subscription](https://github.com/DavidRm1911/dsh-llm-subscription) | 把这些 CLI/订阅当作 DSH 模型选择器里的**模型提供者** | **架构相反**：那边是*你的 DSH agent 跑在那个模型上*；这边是*那个产品自己的 agent 带着自己的工具、工作区、会话去干活*。 |
| [NOirBRight/dsh-external-agents](https://github.com/NOirBRight/dsh-external-agents) | DSH 插件：同类外部编码产品的**控制面**（Codex、Claude Code、Cursor Agent、Antigravity）—— 设置页里探测/启用、工具注册在宿主平面、后台任务进 DSH Job Panel | **意图上最接近的兄弟，但在那个最影响日常使用的决定上正好相反**：它**设计成一次性**（它自己的 ADR 0003 写明：每次委托都付一次全新的产品上下文，而且不能对同一个 Codex 线程补一句）；本插件则是**每条泳道一个持久会话**，默认续接、失败可续。直接对比见下面。 |
| [czm15053/dsh-peer-link](https://github.com/czm15053/dsh-peer-link)、[kirkchinese/claude2dsh](https://github.com/kirkchinese/claude2dsh) | DSH 与 Claude Code 之间的对等消息 / 会话导入 | 不是委派：没有作业、没有结果契约、没有"把resume当作作业"。 |

本插件看起来独有的几点：

1. **三个引擎共用一座小桥**，你想开几条泳道就有几个专属的持久会话；每个作业都记在它跑的那条泳道名下。
2. **按会话挂载** —— 工具只挂到你选中的 agent 作用域（可按 preset / 工作区分 / 按会话 id 排除）。
   被排除的会话，工具目录与系统提示**逐字节不变**。生态里没看到第二个这么做的。
3. **作业存在 DSH 自己的持久存储域里**，不在进程内存、也不在模型上下文里：
   压缩对话、重启 harness —— 作业还在，还读得到。
4. **失败是一等状态**：`blocked`（CLI 缺失 / 未登录）、`retryable`（额度、超时、进程死亡）。
    worker 挂了**永远不会**被静默吞掉。
5. **泳道的分工与模型写进工具描述** —— 交代一次谁干什么，之后路由自动跟着走。
6. **对任何 CLI 开放，靠配置接入** —— 下面三个是手写适配的；其余任何 agent CLI 都在 `config.json` 里
   **描述**进来（见 [自定义产品](#自定义产品豆包--千问--kimi--grok-)）。不用 fork、不用改代码、不用等发版。
7. **派活之前先读额度** —— 别人都没做，因为这是唯一会**静默花钱**的地方（见 [额度和 credits](#额度和-creditscodex)）。

#### 和最近的兄弟 `dsh-external-agents` 直接对比

同一个问题、同一批产品，两个项目对核心问题给出了相反的答案。它的取舍写在 ADR 里，所以这不是我猜它的意图：

| | `dsh-external-agents` | 本插件 |
|---|---|---|
| 连续性 | **设计成一次性**：每次委托都是一个全新的产品上下文，每次都新起进程 | **每条泳道一个持久会话**，默认续接，失败后还能接着续 |
| 你能说 | 「把这个独立任务做掉」 | 「接着上次继续，但这次改成 X」 |
| 作业记录 | 注册进 harness 自己的 job 注册表（Job Panel）—— **在内存里**，重启就没了 | 存在持久存储域里，重启或压缩之后任何会话都还能读到 |
| 同一产品的会话数 | 一个 adapter 一个（一个模型） | 你想开几条泳道就几条（产品 + 模型 + 分工），各有各的目录 |
| 加产品 | 固定的四个出厂 adapter；**用户自定义 argv 是明确的非目标** | 任何 CLI 都能用配置接（连没有 CLI、只有 API 的模型也行） |
| 交接方式 | 一段独立的任务文本 | 磁盘上的 packet（内联文件、日志、截图、验收标准）+ 收回来的产物清单 |
| 套餐额度 / credits | 没有涉及 | 派活前先读 Codex 用量；额度已经用完时**不可能静默花掉** |
| 谁能看到工具 | 宿主平面 —— 该 profile 的每个会话 | 按会话挂载；可按 preset / 工作区 / 会话 id 排除 |
| **它更强的地方** | **一个真正的设置页**（探测每个产品、启用、选默认）—— 本插件走 `config.json` 配置、状态显示在输入框上方的面板里。另外它支持 **Cursor Agent**，本插件还不支持。 | |

如果你要的只是「启用一个工人、派一个任务、在 Job Panel 里看它跑完」，它那套控制面做得更体面。
本插件是为另一种情况存在的：**同一个工人，反复用，而且必须记得住。**

## 前置条件

- DeepSeek Harness，**web profile**（用到 storage domain，由 `dsh-web-app` 提供）。
- Node **≥ 22.19**。
- 至少装好并登录其中一个 worker CLI（用你**自己的订阅**）：
  - **Claude Code** —— `claude auth login`（不需要 API key）
  - **Codex CLI** —— `codex login`（ChatGPT 订阅）
  - **Antigravity CLI** —— `irm https://antigravity.google/cli/install.ps1 | iex`，然后跑一次 `agy`
    （它通常能从系统凭据管理器里拿到你已有的 Antigravity/Google 登录态）

不创建 API key、不做浏览器自动化、不读 cookie。没装或没登录的 worker，`check_external_job` 会直接报 `blocked`。

## 安装

```bash
# 从 Release 产物装（这个 URL 永远不含版本号）
dsh plugin --profile web add --force \
  https://github.com/piecuzwhynot/dsh-external-workers/releases/latest/download/dsh-external-workers.tgz

# 固定版本，并且可以核对校验和
dsh plugin --profile web add --force \
  https://github.com/piecuzwhynot/dsh-external-workers/releases/download/v0.3.0/dsh-external-workers-0.3.0.tgz

# 或从本地目录 / tarball
dsh plugin --profile web add link:C:/path/to/dsh-external-workers
dsh plugin --profile web add file:/path/to/dsh-external-workers-0.3.0.tgz
```

然后**重启 harness**（`dsh web`）—— bundle 列表是开机读的 —— 再开一个会话，
问它 *"列出你的外部 worker 工具"*，应该能看到全部 6 个。

核对与卸载：

```bash
dsh plugin --profile web list
dsh plugin --profile web remove dsh-external-workers
```

Release 产物由 `node scripts/release.mjs` 生成；如果 tarball 和工作区**不是逐字节一致**，它会拒绝打包
（这就是用来抓"忘了先重建 client bundle 就打包"的），并在旁边写出 `SHA256SUMS`。

> **`link:` 安装需要包内自带 `node_modules`。** 被 link 的包是从它**真实路径**向上解析 bare import 的，
> 够不到 profile 的 `node_modules`。要么从 npm/tarball 安装，要么给
> `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-storage-domain`、`@deepseek-ai/dsh-llm`、`zod`
> 在本包自己的 `node_modules` 里建 junction / symlink。

## 在哪配置

两个地方，而且它们改的是**同一批泳道、走同一份宿主代码**，所以不可能对不上：

- **设置 → 外部 worker** —— 一个真正的设置页：一条泳道一块，分工 / 模型 / 档位 / 速度都能就地改，
  另外显示产品列表、实时额度和配置文件位置。保存立刻生效，不用重启；新建和删除泳道也在这里。
- **`config.json`** —— 声明式的那份：`lanes`、`products`、`quota`、`scope`，以及每个产品的 CLI 行为。
  用来初始化一台新机器，或者把配置放进版本管理。
- **`worker_config` 工具** —— 同一批操作，只是给你懒得点的时候用：
  *"把 quick 泳道的 effort 调到 high"*。

## 快速开始

```
# 1) 先看每个产品真实可用的模型，再建泳道
"把三个外部 worker 的可用模型列出来"
"gpt 开两条泳道：泳道 quick 用 gpt-6-luna/medium + speed priority，泳道 deep 用 gpt-6.1-sol/xhigh + speed priority；claude 留在 opus/high 做 UI"

# 2) 派活（点名泳道）
"让 gpt 在 deep 泳道里把这段代码改成异步的，产出放它自己文件夹，然后你读出来应用到我的项目里"

# 3) 之后在任何会话里
"看看外部作业"
```

详细用法、完整示例、排错：**[docs/USAGE.zh.md](docs/USAGE.zh.md)**（英文： [docs/USAGE.md](docs/USAGE.md)）。

## 配置

全部在包旁边的 `config.json`；大部分是每次现读的，改完不用重启。

### 哪些会话能拿到工具（`scope`）

```json
"scope": {
  "mode": "per-session",
  "excludePresets": ["my-persona-preset"],
  "excludeWorkspaces": ["C:\\Users\\me\\companion-workspace"],
  "excludeSessionIds": ["session-…"]
}
```

- `per-session`（默认）把工具注册进**每个被选中 agent 自己的作用域**。被排除的会话是**根本不注册** ——
  不是"注册了再藏起来"，是压根不存在。
- `off` 谁都不给；`global` 给所有会话（一般不是你想要的）。
- 如果 agent 作用域的注册表不可用，插件**什么都不注册**并打错误日志 —— **绝不回退到全局注册**。
- 会话中途切到被排除的 preset，会立刻撤销已挂载的工具。

### 泳道（lanes）

```json
"lanes": [
  { "id": "main", "worker": "claude", "role": "example lane: planning and code review", "model": "opus", "effort": "high", "speed": null },
  { "id": "quick", "worker": "gpt", "role": "example lane: fast edits and scripted chores", "model": "gpt-6-luna", "effort": "medium", "speed": "priority" },
  { "id": "deep", "worker": "gpt", "role": "example lane: the heavy model work", "model": "gpt-6.1-sol", "effort": "xhigh", "speed": "priority" },
  { "id": "research", "worker": "google", "role": "example lane: research and data gathering", "model": "gemini-3.1-pro-high", "effort": "high", "speed": null }
]
```

**泳道（lane）才是干活的单位**：一个产品 + 一个模型（连带档位/速度）+ 一个分工，
有它**自己的**持久会话、**自己的**工作目录 `~/.dsh/workers/<泳道 id>`
（接手了老会话的泳道例外：它保留那个会话原来的目录，见下面的升级说明）。
同一个产品可以开好几条泳道，这正是重点 —— Codex 和 Claude 都把会话绑在**一个**模型上，
用别的模型去续接那个 thread 就会退化，所以 `gpt` + `gpt-6-luna` 和 `gpt` + `gpt-6.1-sol`
绝不能共用一个会话。

- `id` 必须匹配 `/^[a-z0-9][a-z0-9_-]{0,31}$/`，并且它就是这条泳道自己的工作区名
  （`~/.dsh/workers/<id>`）—— 接手了老会话的泳道，则以继承来的目录为准。
- 把整个 `lanes` 键删掉，插件就退回**每个产品一条泳道、以产品名命名** —— 也就是有泳道之前的行为。
- 运行时用 `worker_config` 管理：`action: "set"` 改一条泳道，`"add"` 在产品上新建一条，
  `"remove"` 删一条，`"show"` 看清单。

**从没有泳道的版本升级。** 以前的记录是按产品名做键的。只要 config 里声明了具名泳道，
**每个产品的第一条泳道就会接手该产品原来的记录**，所以你已有的会话绝不会被丢掉；
同一产品的后续泳道则是**故意**从新会话开始。
升级的人要知道两点。第一，接手的记录保留会话号、状态，**也保留它原来的工作目录** ——
目录是**故意跟着会话一起走**的：这些 CLI 按工作目录存会话
（Claude Code 的对话文件放在 `~/.claude/projects/<cwd 的 slug>/` 下），
换个目录 resume 可能根本找不到那个会话。所以从 `claude` 改名来的泳道仍然在
`~/.dsh/workers/claude/` 里干活；只有真正新建的泳道才拿到 `~/.dsh/workers/<泳道 id>/`。
第二，接手记录里旧的 `role`/`model`/`effort`/`speed` **不会**保留：
那四个以前是按产品整体设的，描述不了任何一条具体泳道 ——
现在归泳道自己的 config（或之后某次 `worker_config` 调用）管。
有泳道之前记下的作业不带泳道 id，读取时回落到产品名；账本里没有任何东西被改写或丢失。

### 每个 worker

```json
"workers": {
  "claude": { "enabled": true, "cliPath": null, "permissionMode": "acceptEdits", "extraArgs": [] },
  "gpt":    { "enabled": true, "cliPath": null, "sandboxMode": "workspace-write", "approvalPolicy": "never", "extraArgs": [] },
  "google": { "enabled": true, "cliPath": null, "extraArgs": [] }
}
```

这一块只管 CLI 行为：`enabled`、`cliPath`，以及每个产品自己的那道闸
（claude 是 `permissionMode`，gpt 是 `sandboxMode` / `approvalPolicy`，三个都能用 `extraArgs`）。
`role`、`model`、`effort`、`speed` **不再**从这里读 —— 它们属于泳道。
`cliPath` 可以钉死某个二进制（默认：取最新安装，再查 `PATH`）。

要放开某个 worker 的权限就是改一行 —— 见 [docs/USAGE.zh.md](docs/USAGE.zh.md#权限)。

### 自定义产品（豆包 / 千问 / Kimi / Grok …）

上面三个是**手写适配**的产品。**其他任何 agent CLI 都可以"描述"进来，不用改一行代码** ——
Kimi、通义千问、Grok、豆包、本地模型、下个月才出的 CLI，都一样。一个产品就是 `config.json` 里一份配置：

```json
"products": {
  "kimi": {
    "label": "Kimi CLI",
    "bin": { "names": ["kimi.exe", "kimi"], "roots": ["~/.kimi/bin"], "hint": "install kimi" },
    "args": {
      "base":   ["-p", "{prompt}"],
      "resume": ["--resume", "{session}"],
      "model":  ["--model", "{model}"],
      "extra":  ["--output-format", "json"]
    },
    "output": { "format": "json", "session": "session_id", "text": "result", "model": "model" },
    "models": { "command": ["models"], "format": "lines" }
  }
}
```

写完就有：一个 `delegate_kimi` 工具、它自己的泳道、自己的持久会话、丢不了的作业、产物收集、面板卡片。
具体说：

- **`bin`** —— 怎么找这个 CLI：`names` 在 `PATH` 上找，`roots` 里取最新的那个，也可以用
  `workers.<id>.cliPath` 直接钉死。
- **`args`** —— 命令行模板，占位符有 `{prompt}` `{session}` `{model}` `{effort}` `{speed}` `{cwd}`
  `{timeout}` `{image}` `{index}`。各段的拼接顺序固定：**base, cwd, resume, model, effort, speed,
  images, prompt, extra**；某一段里只要有占位符取不到值，**整段丢掉** —— 所以没设模型时绝不会留下一个
  悬空的 `--model`。提示词紧跟在自己那个 flag 后面的 CLI，把两样都放进 `base`：`["-p", "{prompt}"]`；
  提示词放最后的就用 `args.prompt`。
- **`output`** —— `json`（一个信封）、`jsonl`（每个字段取最后一次出现的）或 `text`（stdout 当结果，
  可以再给一个带捕获组的 `sessionPattern`）。桥就是靠这个拿到会话号 —— 有会话号，泳道的 thread 才续得上。
- **`models`** —— 那个 CLI 自己的模型列表命令，于是 `worker_config(action: "models")` 报的是真的，不是猜的。

配置是**数据**，所以会被校验而不是被信任：写错的地方在插件启动时、以及 `worker_config` 里都会指名道姓
报出来（哪一项、违反了哪条规则）。支持一个新 CLI 的成本就是配置文件里那几行 ——
懒得写就直接叫 DSH 帮你写：它能读那个 CLI 的 `--help` 然后把 recipe 填好。

#### 不只是 CLI：**只有 API** 的模型也能加

上面那个例子驱动的是一个 CLI。如果一个产品**只提供 HTTP API**、没有命令行，那它就没有"命令"可跑 ——
所以插件自带了一个：[`examples/api-lane.mjs`](examples/api-lane.mjs) 把 OpenAI 兼容的接口变成一条泳道。
这个形状覆盖的远不止 OpenAI —— xAI（Grok）、Moonshot（Kimi）、DashScope 的兼容模式（千问）、
火山方舟（豆包）、以及大多数本地推理服务，说的都是这套协议。

```json
"products": {
  "grok": {
    "label": "Grok (xAI API)",
    "bin": { "names": ["node.exe", "node"], "roots": [] },
    "args": {
      "base":   ["<插件目录>/examples/api-lane.mjs", "--history-dir", "{cwd}/.api-history"],
      "prompt": ["-p", "{prompt}"],
      "resume": ["--resume", "{session}"],
      "model":  ["--model", "{model}"]
    },
    "output": { "format": "json", "session": "session_id", "text": "result", "model": "model" }
  }
}
```

密钥**不写进** `config.json`：脚本从环境变量读 `API_LANE_API_KEY`（或者 `--key-file <路径>`），
base URL 和默认模型是同一个地方的 `API_LANE_BASE_URL`、`API_LANE_MODEL`。

这么做换来两件事，也有一件做不到：

- **它能迭代。** 脚本按会话把对话存在磁盘上，`--resume` 时把整段 thread 一起发过去 ——
  后续任务建立在它已经看过的一切之上，跟 CLI 泳道一模一样。普通的"每次调一次 API"包装器
  每次只发一条消息；这一点有测试专门盯着，退化了就会红。
- **任务包会被内联进去。** 桥平常是叫 worker 去读 `jobs/<id>/packet.md`，而纯 API 模型**没有文件工具**，
  所以脚本会读那个 packet 并跟提示词一起发出去，还会告诉模型它没有工具。
- **但 API 模型一个工具都没有。** 它读不了你的代码、跑不了你的测试、也写不出文件到 `jobs/<id>/out/`。
  它只能用文字回答，答案本身就是交付物。如果你要的是一个**真的会在你项目里动手**的 worker，
  那就用带真 CLI 的产品 —— API 泳道适合提问、评审、起草和思考，不适合碰文件。

### 泳道比普通 subagent 强在哪

DSH 内置的 subagent 缝是**设计成一次性的** —— 新进程、新 thread、跑一轮就结束。
官方 provider 的 README 写得很直白：*"no continuation, resume, pooling, progress stream, or
product-session persistence."* 每次调用都从零开始，所以你得每次重新交代一遍背景，
而它上一轮学到的东西已经没了。

泳道正相反：**一个会迭代的 worker。**

| | 普通 subagent | 泳道（lane） |
|---|---|---|
| 记得什么 | 什么都不记得，每次从零开始 | 它自己的会话，跨调用保留 |
| 接着做 | 整个任务重讲一遍 | 「接着做，但这次改成 X」 |
| 模型 | 一次调用一个模型 | 一条泳道一个模型，一个产品可以好几条泳道 |
| 失败了 | 这一轮就没了 | 作业在磁盘上：能读、能续、能重试 |
| 你的 chat 被压缩 | subagent 那次调用没了 | worker 会话和它的作业毫发无损 |
| 工作目录 | 调用方的 | 它自己的，按泳道分 |
| 谁在跑模型 | 你的 DSH 进程发请求 | 那个产品自己的 agent，用你自己的订阅 |

实际的差别是：subagent 是**你问的一个问题**；泳道是你**招来的一个同事** ——
交代一次，之后可以一直把同一个活的下一段交给它，而它还记得第一段。

### 额度和 credits（Codex）

`delegate_gpt` 每次派活**之前**都会先读 Codex 自己记的用量，所以它能在**开工之前**拦住会撞墙的任务：

- 5 小时窗口或每周窗口**任意一个**到了 `quota.warnAtPercent`（默认 **90**），它**不会**开始：
  而是把真实数字报给你、等你答复；你同意后要显式带 `allow_quota: true` 才会继续。
- 如果套餐额度已经用完，下一次运行会**计费到 credits** —— 那需要单独一个 `allow_credits: true`，
  也就是说"同意百分比"永远不会顺带同意花钱。
- 真的花了 credits 的那次运行，事后会把金额报出来（作业记录里 + 完成通知里）。

```json
"quota": { "enabled": true, "warnAtPercent": 90 }
```

数字来自 Codex 自己的 rollout 文件（`$CODEX_HOME/sessions/**`），而**每一个** Codex 面都会写它 ——
本插件的泳道、Codex 桌面 app、CLI —— 所以就算用量是在别处产生的，读数也是新的。
不走网络、不读任何凭据。

**每个读数都会带上它的"年龄"，而且老实标出来。** Codex 只在**真的跑完一轮**时才写快照，
所以一台闲着的机器本来就该有一个旧读数。由此有两条规则，它们都是因为第一版做错了才补上的：

- 快照时间取自**事件自己的时间戳**，绝不用文件的 mtime ——
  Codex 会往一个老会话里继续追加无关事件（一次压缩、一次设置变更），
  于是文件看起来是刚写过的，里面的数字却已经是几小时前的。
- 读数**已经过期**（那个窗口已经重置过）的，报"读数已过期"，**不报百分比**，而且**不参与拦截**。
  一个 14 小时前的「5h 4%」不是"额度健康"，那是已经翻过两轮的窗口 ——
  而陈旧数字错的方向恰好是**让人安心**的那个，这是最糟的错法。

只要重置时间和读数自洽，就以重置时间为准（"重置发生在读数之前"是不可能的事，直接忽略）；
credits 的提醒跟着 Codex 自己点名的那一格（`rate_limit_reached_type`）——
一个用完的每周窗口，跟 5 小时窗口没有关系。

**只有 Codex 报这个。** Claude Code 自己算得出 5 小时 / 每周用量，但只在它的 TUI 里渲染
（没有留任何插件能读的缓存）；Antigravity CLI 干脆不记数字。
对这两个产品，桥会**闭嘴**，而不是编一个数字出来 —— 而撞到硬上限仍然会被反应式地抓到：
作业会变成 `retryable`，`failureKind: quota`。

还有一个实际限制：credits 只能**事后**报告，没法中途拦。worker 就是一个 CLI 进程，
它花钱的那一刻没有任何东西可以插进去。桥保证的是：花钱**不会被静默吞掉**，
而且**下一个任务不经过你同意就不可能用 credits 开工**。

## 工作原理

- **host 平面的一行。** 一个 `cordis.patch.yml` 行挂载这个 bundle。它不发布任何 service，所以不需要
  `isolate` realm，也永远不碰 persona、injection、记忆管线或压缩指令。
- **按会话挂载。** 宿主监听 `agent/created`，把工具注册进该 agent 自己的 `agent.ctx`
  （`ctx.tools.register` → 调用方 context 的 layer）。工具目录每步重算，所以新挂上的会话下一步就能看到。
- **落盘账本。** 作业和泳道（每条泳道都有自己的会话号和常设配置）都存在 `external_workers` 存储域 →
  `$DSH_HOME/storages/external_workers.json`，原子写。启动时做一次对账：
  凡是标着 `running` 但进程已经不在了的，改成 `retryable` 并写明原因。
- **自包含任务包。** 每次委派都会写 `jobs/<id>/packet.md`（任务、内联文件、日志尾部、图片、参考、
  验收标准、产出契约）。worker 不需要猜你的项目，它只读一个文件。
- **产物走约定。** worker 把交付物写到 `jobs/<id>/out/`，桥会把它们列回作业记录。
- **真实模型发现。** `worker_config(action: "models")` 直接从产品本身读 —— Codex 的
  `models_cache.json`、`agy models`、Claude 文档化的别名 —— 而不是写死的清单。

## 已知限制

- worker 只能做它自己 CLI 允许它做的事。Anthropic 的 `acceptEdits`、Codex 的沙箱、agy 的权限授权是
  三道不同的闸；桥会**如实报告**，不会假装成功。见用法文档里的权限一节。
- 泳道在**它们自己的**目录里干活（`~/.dsh/workers/<lane id>`），不在你的项目里。
  把产物搬进项目是有意的第二步（或者用 `cwd` 指过去 —— 代价是按目录的会话连续性）。
- 不做自治路由。工具是显式的，由统筹者决定。
- 在 **Windows** + Node 24 + DSH 0.1.1-rc.2 上验证过；CLI 适配层本身是跨平台的。

## 许可

MIT —— 见 [LICENSE](LICENSE)。
