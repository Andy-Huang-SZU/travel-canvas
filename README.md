# Travel Canvas / 旅途成图

[![CI](https://github.com/Andy-Huang-SZU/travel-canvas/actions/workflows/ci.yml/badge.svg)](https://github.com/Andy-Huang-SZU/travel-canvas/actions/workflows/ci.yml)
[English](README.en.md) · [下载版本](https://github.com/Andy-Huang-SZU/travel-canvas/releases) · [问题反馈](https://github.com/Andy-Huang-SZU/travel-canvas/issues)

把旅行资料整理成有依据的内容，再用可替换的模板和生图工具制作旅行图片。提供独立 Agent Skill、CLI 和 Codex 插件封装。

**当前版本：0.1.1-alpha。** 已实现请求编译、原生/手动收图、API 驱动、核对记录绑定和 ZIP 交付。真实付费 API、其他宿主完整执行和最终精确排版器尚未验证或完成。展示方案与代码分别维护版本。

<img src="skills/travel-illustrator/assets/demos/native-demo.png" width="320" alt="杭州虚构行程的实际原生成图示例，包含湖边散步、午饭、喝茶和结束一天四条活动">

图为本项目通过当前 Codex 原生工具实际生成的**虚构示例**，附[执行提示词](skills/travel-illustrator/assets/demos/native-demo.prompt.txt)和[来源回执](skills/travel-illustrator/assets/demos/native-demo.receipt.json)。

## 两分钟试通项目

建议 Node.js 22 或 24，无运行时第三方依赖，**无需 npm install 或 API key**：

```sh
git clone https://github.com/Andy-Huang-SZU/travel-canvas.git
cd travel-canvas
npm run demo
```

输出到终端显示的 `runs/demo-.../`，包含逐页请求、提示词、原始图片和 `demo-draft.zip`。演示重放包内虚构样例，验证编译、收图和打包，**不会新生图或调用 API**；输出明确保留 `draft-package` 状态。

验证所有已实现的约束：

```sh
npm run check
npm test
npm run smoke
```

## 使用自己的旅行资料

### 已有生图能力的 agent

复制整个 `skills/travel-illustrator/`，其中的脚本、示例、模板、规范和许可证都需保留。安装辅助命令不会覆盖已有目录：

```sh
node scripts/install-skill.mjs --to "$HOME/.agents/skills/travel-illustrator"
```

这是 Codex 用户级目录的例子；其他 agent 请换成其支持的完整路径，也可以让它直接读取仓库里的 `skills/travel-illustrator/SKILL.md`。Windows 用户可给 `--to` 传入自己的完整路径。

安装后在支持的宿主里选择 `travel-illustrator`，例如：

> 使用 $travel-illustrator，把我的三天行程做成旅行手账。保留活动和时间的原意，没有时间就留空；先给我一张样张。

生图由这个 agent 当前实际可用的工具完成。复制文件、宿主发现与工具执行分别验证，Skill 不会自动赋予宿主生图能力。[Codex Skill 官方说明](https://developers.openai.com/codex/skills)。

### 手动提示词或自选 API

先复制虚构示例，修改成自己的结构化内容。普通聊天资料可让 agent 按随包 Schema 整理：

```sh
cp skills/travel-illustrator/assets/examples/weekend.json trip.json
node cli.mjs validate trip.json
node cli.mjs plan trip.json --execution manual --out ./runs/my-trip
```

得到 `plan.json`、逐页 `request.json` 和 `prompt.txt`，状态为 `planned-not-generated`。把提示词与引用素材交给自己的生图产品，再收回实际图片。复制示例在修改前仍是虚构行程。

要调用 API，复制配置文件：

```sh
cp providers.example.json providers.local.json
```

选择服务地址、真实图片模型名和保存密钥的环境变量名。示例里的 `MODEL_ID` 必须替换；密钥值只放在对应环境变量里。项目不自动读取 `.env`，配置文件不保存密钥值。

```sh
node cli.mjs render ./runs/my-trip/plan.json --config providers.local.json --provider openai --out ./runs/my-trip/execution --max-requests 1
```

驱动包含 OpenAI Images、Gemini 原生图片接口和 OpenAI-compatible，分别选择 `openai`、`gemini` 或 `compatible`。兼容性、参考图和尺寸能力要逐服务确认。目前仅通过本地 HTTP 模拟服务验证，未证明真实厂商的价格、配额、接口兼容或生成质量。

## 收图、核对和交付

`JOB_ID` 和 `CONTENT_DIGEST` 取自相应 `plan.json`；`review.json` 记录对真实图片的检查：

```sh
node cli.mjs collect ./runs/my-trip/plan.json --job JOB_ID --digest CONTENT_DIGEST --image returned.png --out ./runs/my-trip/execution
node cli.mjs review ./runs/my-trip/plan.json --job JOB_ID --evidence review.json --out ./runs/my-trip/execution
node cli.mjs pack ./runs/my-trip/plan.json --out ./runs/my-trip/execution --archive ./outputs/trip.zip
node cli.mjs status ./runs/my-trip/execution
```

宿主若修改过提示词，收图时加 `--executed-prompt actual-prompt.txt`。核对证据需绑定实际图片 SHA-256，并检查条目覆盖、时间语义与额外活动，字段见[运行说明](skills/travel-illustrator/references/execution.md)。未核对的页面默认不能进入最终包，需显式 `--allow-drafts` 才导出草稿。agent 检查、人工检查与用户接受分别记录。

## 当前能力

| 能力 | 状态与边界 |
| --- | --- |
| 每日行程 / 全程概览 | 请求编译可运行；模型成图仍需逐项读图核对 |
| 靛蓝手账 / 清爽指南 | 两套可替换视觉配方，事实与风格分开 |
| agent 原生工具 | 本宿主有一次实际生成、收图、agent 核对与打包记录；其他宿主未实测 |
| 手动生图 | 可导出提示词、收回 PNG / JPEG；外部产品操作由用户完成 |
| 自选 API | 三类驱动代码及本地协议测试；真实付费服务未测 |
| 照片回忆 / 精确排版 | 可规划和收集素材；最终排版器未实现，素材不能冒充完整页面 |
| Codex Plugin | 清单和仓库目录入口齐备；桌面安装、激活与自动触发仍需验收 |
| 其他 agent | Skill 与协议可移植，没有逐宿主端到端验证 |

保留开始、结束、区间、近似和未知时间；图片区号与旅行 DAY 分开。按允许的方式拆页，不静默删内容。尺寸以实际像素为准。超时或未知结果不自动重发生成，明确限流也受总请求及重试上限约束。

## Codex 插件分发入口

仓库包含根 `plugin.json`、兼容的 `.codex-plugin/plugin.json` 和 `.agents/plugins/marketplace.json`。支持的客户端可按官方流程添加目录来源：

```sh
codex plugin marketplace add Andy-Huang-SZU/travel-canvas --ref main
codex plugin marketplace list
```

按[官方插件文档](https://developers.openai.com/plugins/build/plugins)在桌面插件目录选择这个来源并安装。项目未提交到通用公共插件目录；GitHub 发布、目录发现和宿主安装成功是不同状态。独立 Skill / CLI 不依赖插件目录安装。

## 下载、检查与贡献

[Releases](https://github.com/Andy-Huang-SZU/travel-canvas/releases) 提供完整项目 ZIP、独立 Skill ZIP 和 `SHA256SUMS`。本地可运行 `npm run package` 生成它们。

CI 在 Node.js 22 / 24 下检查模板、输入、运行测试、独立 Skill 安装和离线演示。见 [CONTRIBUTING.md](CONTRIBUTING.md)。

原创代码、说明和虚构输入文本采用 MIT；生成示例图保留独立来源，服务条件和第三方权利不被代码许可证替代。仓库不含原用户真实行程、旅行图、密钥或私人 HTML 阅读包。见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
