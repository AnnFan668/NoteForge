# AGENTS.md

## 项目契约

`笔记工坊 / NoteForge` 是一个 React + Vite 桌面端 Web App，用于辅助生成小红书内容。详细产品规格以 `docs/SPEC.md` 为准。

产品保持 3 列工作台形态：左侧流程/草稿导航，中间阶段式创作区，右侧模型配置、状态和错误提示。视觉保持 Pastel 3D Claymorphism，使用马卡龙色、大圆角黏土面板、柔和阴影和 3D soft icon；不要改成营销页、深色科技风、极简黑白风、纯聊天界面或通用 SaaS 后台。

## 核心功能

- 用户输入账号人设和创作关键词。
- 用户主动搜索小红书热门内容，并手动勾选内容加入本地 RAG 知识库；用户点击“自动化生成”时，可由文案生成模型选择参考内容并入库。
- AI 按阶段生成 10 个选题、5 篇文案、5 份封面 Prompt 和封面图。
- 桌面端“撰写思路与 5 篇文案”的文案滚动区占满左侧卡片剩余高度，并与右侧“小红书预览”卡片底边对齐。
- 文案正文包含小红书话题标签，格式为 `#话题名称[话题]#`。
- 文案生成模型和图片生成模型支持单独配置，并自动缓存。
- 右侧三路连接检查分别验证 `xhs` 安装/登录、Codex 登录/真实调用和云端文本 API；所有检查必须由用户点击触发，单纯的版本检测不得显示为整条链路正常。
- Windows 启动器和服务端都自动发现 Codex 桌面应用动态目录中的 `codex.exe`，并为子进程固定当前 Windows 用户的 `.codex` 登录目录；`CodexLogin.bat` 仅由用户双击后启动浏览器登录和状态验证。
- Windows 双击启动器优先用 Microsoft Edge 打开本地页面，找不到 Edge 时才回退系统默认浏览器；滚动条样式必须同时兼容 Chromium 和 Firefox。
- Codex 健康检查的登录检查保持短超时；已登录后的真实探测使用临时只读模式并允许最多 180 秒，以覆盖 WebSocket 失败后的 HTTPS 回退，不得把这种可恢复的慢连接提前误报为未登录。
- Codex imagegen worker 的 `result.json` 必须兼容 Windows PowerShell 5.1 产生的 UTF-8 BOM；服务端在解析前仅移除文件开头 BOM，缺少文件与 JSON 语法错误需要分别返回可操作的 `IMAGEGEN_BAD_OUTPUT`，不得把已成功生成 PNG 的情况笼统误报为“没有写出 JSON”。
- 若 Codex 等受限开发环境启动的 Node 服务无法访问 Codex 状态目录或外网，错误必须明确提示关闭旧服务并双击 `NoteForge.bat`，不得误报为 CLI 未安装或账号未登录。
- 小红书搜索结果在 CLI 返回封面 URL 时展示缩略图，缺失或加载失败时使用本地占位图，不向浏览器返回 Cookie 或 `xsec_token`。
- Windows 服务端调用 xhs 必须强制 Python UTF-8 并关闭 Rich 彩色输出，避免中文或 emoji 导致 JSON 中途截断；返回前继续移除 Cookie 与 `xsec_token`。
- Windows 服务端必须自行发现项目隔离目录中的 xhs，即使普通 Vite 开发命令没有注入 `XHS_CLI_COMMAND`，也不得误报为未安装。
- xhs 搜索前只允许校验并隔离损坏的 `search_sessions.json` 临时缓存，不得修改登录 Cookie；CLI stdout 为空时必须显示脱敏后的实际 stderr 原因。
- Windows 小红书登录必须使用 UTF-8；默认由 `XhsLogin.bat` 引导用户在小红书网页完成登录、关闭浏览器、导入本机浏览器 Cookie 并验证保存状态，不依赖可能在手机确认后仍超时的纯 HTTP 二维码流程。
- 当前版本支持三类真实本地/云端链路：本机 `xhs` CLI 热门搜索、本地可选 CLI（内置 Codex/Kimi/Claude，并支持符合 Mint Atelier print protocol 的自定义 CLI）文本生成、Codex CLI 本地图片生成，以及云端 OpenAI-compatible API 生成。RAG 入库必须来自用户手动勾选确认，或来自用户点击“自动化生成”后的本次模型决策。
- Kimi 官方云端 API（Moonshot 开放平台与 `api.kimi.com/coding` 会员接口）自动使用其兼容请求参数，不固定发送跨模型不兼容的 `temperature`；上游 400 等错误必须显示经过脱敏的具体原因。

## 风控边界

- `xiaohongshu-cli` / `xhs` 调用必须由用户主动触发，不做后台自动搜索、自动刷新或高频轮询。
- 搜索、采集、入库、生成、封面图生成之间要有清晰的用户确认边界；“自动化生成”按钮视为本次串行流程的一次完整确认。
- 本地 CLI 检测必须由用户点击“检测本机 CLI”触发；本地 CLI 和云端 API 生成必须由用户点击搜索、生成或“自动化生成”按钮触发，不做后台检测或自动生成；服务端只通过本地 Node middleware 以 `shell: false` 和参数数组执行 CLI 或转发 API 请求，不在浏览器中执行命令。
- 当前核心范围不包含自动发布、自动点赞、自动评论、自动收藏、自动关注、自动私信或自动批量采集。
- 生成内容要真实、具体、有信息量，避免空洞夸张、虚假体验、医疗/金融等高风险承诺。
- 封面 Prompt 不包含真人、脸、手和动物，可以使用植物或花材作为辅助元素。

## 实现地图

- 产品规格：`docs/SPEC.md`
- 应用入口：`src/App.jsx`
- 全局样式和视觉 token：`src/styles.css`
- 本地生成 API：`server/codex/`
- 本地 CLI 注册与协议适配：`server/localCli/`
- 小红书搜索 CLI adapter：`server/xhs/`
- 三路健康检查：`server/integrations/`
- 项目隔离 xhs 环境：`.tools/xhs/`（不提交）
- 临时封面图托管：`/generated/covers/*.png`
- 资源文件：`public/assets/`

## 开发命令

```bash
npm run launch:fixed
npm run build
```

## 修改规则

- 产品或交互变化：同步更新 `docs/SPEC.md` 和本文件。
- 视觉或布局变化：保留当前 3 列工作台和 Pastel 3D Claymorphism 方向。
- 涉及 `xiaohongshu-cli`、本地 CLI 检测、搜索、RAG 入库或生成链路时，必须保留用户主动触发和确认边界；自动化流程只能由用户点击“自动化生成”启动。
- 完成改动后至少运行 `npm run build`；视觉布局改动还需要截图或浏览器检查。
