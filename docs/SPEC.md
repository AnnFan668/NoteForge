# 小红书 AI 助理产品规格

## 1. 产品目标

`NoteForge` 是一个桌面端 Web App，用于帮助用户生成优质小红书内容。用户输入账号人设、创作关键词和撰写思路后，可以参考热门内容，逐步生成小红书选题、小红书文案、封面 Prompt 和封面图，也可以点击“自动化生成”串行完成核心创作流程。

产品核心目标是让用户通过简单流程完成从「关键词」到「可发布内容草稿」的创作过程。本产品只做内容创作辅助，不做自动发布、自动点赞、自动评论、自动收藏、自动关注等平台操作。

当前版本的热门内容搜索通过本机 `xhs` CLI 执行。选题、文案、封面 Prompt 和模型决策支持本地可选 CLI（内置 Codex CLI、Kimi CLI、Claude Code，并允许符合统一 print protocol 的自定义 CLI）与云端 OpenAI-compatible API；PNG 封面图支持本地 Codex CLI native imagegen 与云端 Images-compatible API。搜索结果不会后台自动进入 RAG；RAG 入库需要用户手动勾选确认，或用户点击“自动化生成”后由文案生成模型在本次流程中选择参考内容。

## 2. 核心流程

1. 用户手动输入账号人设。
2. 用户输入创作关键词。
3. 用户点击搜索，获取小红书热门内容。
4. 用户从搜索结果中选择有参考价值的内容，并加入本地 RAG 知识库。
5. AI 基于人设、关键词和参考内容生成 10 个选题。
6. 用户选择一个选题。
7. 用户补充简要撰写思路。
8. AI 基于选题和撰写思路生成 5 篇文案。
9. 用户选择一篇文案。
10. AI 基于所选文案生成 5 份封面 Prompt。
11. 用户点击某个封面 Prompt，生成对应封面图。
12. 用户可以保存和继续编辑生成结果。

自动化流程：用户填写账号人设、创作关键词和撰写思路后，点击“自动化生成”，系统视为用户对本次串行流程的完整确认，并自动完成热门搜索、模型选择参考内容并入库、生成并选择选题、生成并选择文案、生成并选择封面 Prompt、调用图片模型生成封面图。自动化过程中所有选择结果仍需要在页面中保留可见选中态。

## 3. 功能需求

### 3.1 人设输入

用户可以手动输入账号人设。人设用于约束后续选题、文案和封面 Prompt 的生成方向。人设是一段字符串，最多支持 1000 字，需要自动缓存。

### 3.2 关键词输入

用户可以输入创作关键词。关键词用于搜索热门内容，也用于辅助生成选题和文案。关键词需要自动缓存。

### 3.3 热门内容搜索

用户可以点击搜索按钮，通过本机 `xhs` CLI 获取与关键词相关的小红书热门内容。默认通过系统 PATH 查找 `xhs` 执行 `xhs --cookie-source none search "<关键词>" --sort popular --type all --page 1 --json`，可通过 `XHS_CLI_COMMAND` 和 `XHS_COOKIE_SOURCE` 覆盖。搜索必须由用户点击“搜索热门内容”或“自动化生成”触发，失败时需要显示明确、可理解的错误提示。

Windows 服务端调用 xhs 时必须为 Python 子进程设置 UTF-8 标准输出并关闭 Rich 彩色终端渲染，确保标题、作者或正文中的中文和 emoji 不会触发 GBK 编码错误，也不会向 JSON 混入 ANSI 控制符。

搜索前仅校验 xhs 的 `search_sessions.json` 临时会话缓存；发现旧 GBK 或损坏内容时，将该文件改名为可恢复备份后由 xhs 重建，不修改登录 Cookie、token 缓存或浏览器数据。CLI stdout 为空时返回脱敏后的实际 stderr 原因。

服务端只消费 `xhs` 的结构化 JSON 输出，并返回归一化后的搜索项；不得把原始 CLI 输出、Cookie 或 `xsec_token` 返回给浏览器。

搜索结果需要展示：

- 标题
- 摘要或正文片段
- 标签
- 互动数据
- 来源链接或 note id
- 检索关键词
- 检索时间
- CLI 返回的笔记封面缩略图；缺失或加载失败时显示本地占位图

### 3.4 加入 RAG 知识库

用户可以从热门内容搜索结果中勾选内容，并加入本地 RAG 知识库。用户点击“自动化生成”时，文案生成模型可以从搜索结果中选择 1 到 8 条参考内容并入库，页面需要同步勾选这些内容。系统不得后台自动入库，也不得静默将全部搜索结果加入 RAG。RAG 内容用于辅助生成选题和文案，并需要保存在本地。

### 3.5 生成选题

用户点击生成选题后，AI 生成 10 个小红书选题。生成选题时需要参考用户人设、创作关键词和 RAG 知识库内容。

在自动化流程中，AI 生成 10 个选题后，文案生成模型需要从候选中选择 1 个选题继续后续步骤。

每个选题建议包含：

- 标题
- 选题角度
- 目标受众
- 推荐理由
- 内容爆点

### 3.6 撰写思路输入

用户选择选题后，可以补充简要撰写思路。撰写思路是一段字符串，需要自动缓存。

### 3.7 生成文案

用户点击生成文案后，AI 生成 5 篇小红书文案。生成文案时需要参考用户人设、用户选择的选题、用户补充的撰写思路和 RAG 知识库内容。

在自动化流程中，AI 生成 5 篇文案后，文案生成模型需要从候选中选择 1 篇继续后续步骤。

桌面三列布局中，“撰写思路与 5 篇文案”的候选文案滚动区需要占满卡片在撰写思路输入框下方的全部剩余高度，并与同一行右侧“小红书预览”卡片底边对齐，不得使用造成大块空白的固定短高度。

每篇文案建议包含：

- 标题
- 正文
- 封面方向建议

正文是字符串，正文包含话题标签。小红书话题标题格式是 `#话题名称[话题]#`。

### 3.8 生成封面 Prompt

用户选择文案后，AI 生成 5 份封面 Prompt。为了避免封面被识别为 AI 生成，封面不应包含真人、脸、手和动物，可以使用植物或花材作为辅助元素。用户可以选择任意一份封面 Prompt 用于生成封面图。

在自动化流程中，AI 生成 5 份封面 Prompt 后，文案生成模型需要从候选中选择 1 份用于封面图生成。

### 3.9 生成封面图

用户点击某个封面 Prompt 后，系统按图片模型配置生成对应 PNG 封面图。本地路线通过 Codex CLI worker 调用 native `image_gen.imagegen`；云端路线通过 OpenAI-compatible `POST /images/generations` 生成图片。两条路线都需要把生成结果展示在页面中，图片文件由本地 Vite middleware 临时托管在 `/generated/covers/*.png`。生成失败时，需要保留原始封面 Prompt，方便用户重新生成。

本地 Codex worker 使用 `result.json` 传递 `status`、`image_path`、`error` 和 `caveats`。Windows PowerShell 5.1 可能在 UTF-8 JSON 开头写入 BOM，服务端必须在解析前兼容移除且继续执行状态、路径和 PNG signature 校验。`result.json` 缺失与 JSON 语法错误需要使用不同的可操作消息；解析错误可返回脱敏后的解析原因，但不得包含 Prompt、账号信息或其他本机敏感内容。只有 worker 状态为 `complete`、报告路径匹配且文件为合法 PNG 时，才允许发布图片。

### 3.10 模型配置

文案生成模型和图片生成模型需要支持单独配置。用户可以选择本地 CLI 或云端 API。本地文案 CLI 由服务端注册表提供，页面通过用户主动点击“检测本机 CLI”执行 `--version` 检测并展示可用状态，禁止后台检测。内置适配器包括：

- Codex CLI：通过 `codex exec` 生成文本和模型决策，也可通过 native `image_gen.imagegen` 生成本地 PNG；默认从 PATH 查找，可用 `CODEX_CLI_PATH` 覆盖。
- Kimi CLI：通过 `kimi --prompt <prompt> --output-format stream-json` 生成文本和模型决策，可选 `--model <alias>`；默认从 PATH 查找，可用 `KIMI_CLI_PATH` 覆盖。Kimi CLI 当前不声明图片生成能力，因此不会出现在本地图片 CLI 选项中。
- Claude Code：通过 `claude --print <prompt> --output-format json` 生成文本和模型决策，可选 `--model <alias>`；调用时启用 safe mode、关闭工具和会话持久化，解析响应的 `result` 字段。默认从 PATH 查找，可用 `CLAUDE_CLI_PATH` 覆盖。Claude Code 当前不声明图片生成能力，因此不会出现在本地图片 CLI 选项中。
- 自定义规范 CLI：用户可填写 PATH 中的命令名或可执行文件绝对路径。服务端使用 `shell: false` 和独立参数数组启动，不允许 shell 命令片段。

Mint Atelier print protocol 规定：CLI 必须支持 `--version`；文本调用必须支持可选的 `--model <alias>`、必填的 `--prompt <prompt>` 和 `--output-format stream-json`；stdout 采用逐行 JSON，每次最终回复至少包含一条 `{"role":"assistant","content":"<valid JSON>"}`，其中 `content` 是满足当前任务结构的 JSON 字符串。stderr 可输出思考或进度，但不得承载最终结果。新增本地 CLI 也可以通过实现 `server/localCli/registry.mjs` 的适配器接口接入其他调用规范。

本地 CLI 返回文案和封面 Prompt 时，服务端兼容约定字段的常见英文、snake_case 与中文别名。文案的 `coverDirection` 完全缺失时，服务端根据文案标题补充静物封面方向；其他必需内容、数量和话题标签仍保持强校验。本地 CLI 的结构化输出错误统一使用 `LOCAL_CLI_BAD_JSON`。

云端文本路线走 OpenAI-compatible `POST /chat/completions`，云端图片路线走 Images-compatible `POST /images/generations`。当文本 API Base URL 指向 Kimi 官方 `api.moonshot.cn`、`api.moonshot.ai` 或 Kimi Code 会员接口 `api.kimi.com/coding` 时，服务端使用 Kimi 兼容参数：不固定传入 `temperature`，让不同模型使用各自支持的默认值；输出长度使用 `max_completion_tokens`，并请求 `json_object` 输出。云端上游的 HTTP 错误需要保留状态码并展示供应商返回的具体原因，但不得泄露 API Key。

用户至少可以分别配置：

- 文案生成使用的模型
- 图片生成使用的模型
- API Key
- API Base URL
- 模型名称

模型配置需要自动缓存。

右侧提供独立的“三路连接检查”，仅由用户点击触发：小红书检查 `xhs` 安装与已保存登录态；Codex 先检查登录状态，再做一次最小真实模型调用；云端文本 API 使用当前模型、Key 和 Base URL 做一次低 token 请求。检查接口为 `POST /api/integrations/check`，目标值为 `xhs`、`codex` 或 `cloud-text`。页面必须分别显示安装、鉴权、网络可达性和脱敏错误，不能用单纯的 `--version` 成功代表整条链路正常。

Windows 启动器和服务端必须自动发现 Codex 桌面应用位于 `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe` 的动态版本目录，并为子进程显式使用当前 Windows 用户的 `.codex` 登录目录；即使通过普通 Vite 开发命令启动，也不得把已安装、已登录的 Codex 误报为不可用。用户可主动双击 `CodexLogin.bat` 执行 `codex login` 浏览器登录并用 `codex login status` 验证；应用不得后台发起登录。

Windows 双击启动器在检测到 Microsoft Edge 时必须优先使用 Edge 打开固定本地地址，找不到 Edge 时才回退到系统默认浏览器。滚动容器同时提供 Chromium 的渐变滚动条规则和 Firefox 的标准 `scrollbar-width` / `scrollbar-color` 兼容规则。

Codex 健康检查先以短超时验证登录状态，未登录时立即返回；仅在已登录后执行临时、只读、忽略用户配置和规则的最小 `codex exec`。真实探测允许最多 180 秒，以覆盖 WebSocket 不可达时 CLI 自动重试并回退 HTTPS 的时间，并在成功响应中提示是否使用了 HTTPS 回退。

若服务由 Codex 等受限开发环境直接启动，导致已登录的 CLI 无法写入自身运行状态目录，健康检查必须返回 `CODEX_RUNTIME_RESTRICTED` 并提示用户关闭旧服务、双击 `NoteForge.bat`，不得误报为账号未登录。

Windows 可以通过 `Setup-Xhs.bat` 将 `xiaohongshu-cli` 安装到项目隔离目录 `.tools/xhs`，再由用户主动运行 `XhsLogin.bat` 打开小红书网页版、完成网页登录并导入本机浏览器 Cookie。启动器和服务端都优先使用该项目内可执行文件，仍允许 `XHS_CLI_COMMAND` 显式覆盖；普通 Vite 开发命令不得把项目内已安装的 xhs 误报为未安装。安装、登录、健康检查和搜索之间保持独立的用户确认边界。

`XhsLogin.bat` 必须为 Python/xhs 子进程启用 UTF-8，并把“网页登录成功”“完全关闭浏览器”“导入 Cookie”“验证保存状态”显示为清晰的用户步骤。由于纯 HTTP 二维码可能在手机确认后仍无法完成 CLI 轮询，默认登录流程使用浏览器 Cookie 导入；不读取、显示或上传 Cookie 内容。登录继续保持为用户主动触发，不由应用后台启动。

DeepSeek 官方 OpenAI-compatible 文本路线默认使用 `deepseek-v4-pro` 和 `https://api.deepseek.com`。结构化内容请求使用 `response_format: { type: "json_object" }` 并关闭 thinking，避免推理内容干扰严格 JSON 结果；API Key 继续只保存在浏览器本地配置中，错误详情必须脱敏。

### 3.11 模型决策

自动化流程中的 RAG 参考选择、选题选择、文案选择和封面 Prompt 选择都使用当前文案生成模型。决策接口包括通用本地 CLI 路线 `POST /api/local-cli/decide`、保留兼容的 Codex CLI 路线 `POST /api/codex/decide` 和云端 OpenAI-compatible 路线 `POST /api/cloud/decide`。

决策请求需要包含 `decisionKind`、`persona`、`keyword`、`writingBrief`、`ragItems`、`options`，并在需要时包含 `selectedTopic` 或 `selectedDraft`。决策响应固定返回 `kind: "decision"`、`decisionKind`、`selectedIds`、`reason`、`commandPreview`、`durationMs` 和 `generatedAt`。

服务端必须校验模型返回的 ID 来自候选项：RAG 决策必须返回 1 到 8 个候选项 ID，选题、文案和封面 Prompt 决策必须且只能返回 1 个候选项 ID。无效 ID、重复 ID、空选或数量不合法时，需要返回明确错误并停止自动化流程。

### 3.12 错误提示

以下情况需要显示明确错误提示，并尽量告诉用户下一步该怎么做：

- 搜索失败
- RAG 加入失败
- 选题生成失败
- 文案生成失败
- 封面 Prompt 生成失败
- 封面图生成失败
- 模型决策失败
- 自动化生成中断
- 模型配置缺失
- API Key 无效
- 本地 CLI 不可用
- xhs CLI 未安装、未登录、需要验证、频率或网络受限、返回非 JSON 内容
- 本地 CLI 未安装、能力不匹配、执行失败、超时或返回非规范 JSONL/JSON 内容
- Codex CLI imagegen 失败或写出非 PNG 内容
- Codex CLI imagegen 的 `result.json` 缺失、带 BOM、语法错误或图片路径不匹配
- 云端 API 配置缺失、Base URL 无效、HTTP 错误、超时、返回非 JSON、返回结构不支持或返回非 PNG 图片
- 网络请求失败
