# aistudio-api

<p align="center">
  <a href="https://github.com/DeconstructedCube/aistudio-api"><img src="https://img.shields.io/badge/API-Gemini%20v1beta-4285F4?style=flat-square&logo=google" alt="Gemini API"></a>
  <a href="https://hub.docker.com/r/bedrockblock/aistudio-api"><img src="https://img.shields.io/badge/Docker-bedrockblock%2Faistudio--api-2496ED?style=flat-square&logo=docker" alt="Docker Hub"></a>
  <a href="https://deepwiki.com/DeconstructedCube/aistudio-api"><img src="https://img.shields.io/badge/DeepWiki-Docs-5B68E4?style=flat-square" alt="DeepWiki"></a>
  <a href="https://fastapi.tiangolo.com/"><img src="https://img.shields.io/badge/Framework-FastAPI-009688?style=flat-square&logo=fastapi" alt="FastAPI"></a>
  <a href="https://vuejs.org/"><img src="https://img.shields.io/badge/Frontend-Vue%203%20%2B%20Vite-4FC08D?style=flat-square&logo=vuedotjs" alt="Vue 3"></a>
  <a href="https://docs.astral.sh/uv/"><img src="https://img.shields.io/badge/Python-3.11%2B%20%7C%20uv-261230?style=flat-square&logo=python" alt="Python uv"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License"></a>
</p>

<p align="center">
  Google AI Studio 反向代理服务，将 Web 端 AI Studio 转换为标准 Google Gemini API 协议接口。
</p>

<p align="center">
  <a href="./README_EN.md">English Documentation</a>
</p>

### 用 Chrome 临时聊天页给酒馆接单（可选）

1. 在项目目录运行 `uv run --no-sync python main.py browser-server`。终端会显示酒馆密码和标签页配对码。服务监听 `127.0.0.1:8090`，可以和 8080 共存。
2. 在装有 Tampermonkey 的 Chrome 打开 [本机接单脚本](http://127.0.0.1:8090/aistudio-browser.user.js) 并安装。在目标账号单独打开空白临时页，例如 [u/1 的临时页](https://aistudio.google.com/u/1/prompts/new_chat?temporary=true)。保持运行设置面板展开，选好模型。点页面右侧的「接单」悬浮球，再点「配对此页」。悬浮球可拖动，同一标签页刷新后保留位置。接着，填入终端的标签页配对码。连接状态和模型会显示在这里。需要登录时，在网页完成登录并回到该账号的临时页。
3. 酒馆选择 Google AI Studio，反代地址填 `http://127.0.0.1:8090`，代理密码填终端的酒馆密码。专用页空闲时会读取网页菜单中的文字模型，排除带 Paid 标记的条目。重新连接酒馆即可选择模型；提交前脚本会在网页中切换并核对模型 ID。油猴菜单中的「重新读取网页模型列表」可以触发下次空闲时重新扫描。

支持单标签页、单个进行中的请求、普通或流式文字回复。酒馆开启函数调用时，可选函数声明（AUTO/NONE）允许直接返回文字；强制工具调用会收到明确错误。已有的工具调用和结果以文本随历史传入。多轮历史和系统指令以带角色的文本送入网页，采样、思考、搜索和安全设置以网页为准。图片、实际客户端工具执行和精确 token 计数暂不支持。输出来自渲染后的正文，Markdown 格式可能与网页原文不同。

页签保持打开即可。连接中断会自动重连；空闲临时页需要恢复或包含上次请求的历史时，在下次接单前最多重开一次。请将此页专用于接单。提交后中断会报错，由客户端决定是否重试。暂停接单可使用油猴菜单。默认每次服务启动生成新密钥；要跨重启沿用配对，在启动环境里分别设置不同的随机值 `AISTUDIO_BROWSER_API_KEY` 和 `AISTUDIO_BROWSER_PAIR_KEY`。接单脚本使用油猴的标签页存储保留配对，关闭标签页后需重新配对。

---

## 目录

- [核心特性](#核心特性)
- [技术架构与文档](#技术架构与文档)
- [快速开始](#快速开始)
  - [Android (Termux)](#android-termux)
  - [Windows](#windows)
  - [Linux / macOS](#linux--macos)
  - [Docker 部署](#docker-部署)
- [账号凭据 (Cookie) 获取与导入指引](#账号凭据-cookie-获取与导入指引)
- [第三方客户端配置指引 (NextChat / Cherry Studio 等)](#第三方客户端配置指引-nextchat--cherry-studio--one-api-等)
- [配置与环境变量](#配置与环境变量)
- [API 调用示例](#api-调用示例)
  - [cURL 调用](#curl-调用)
  - [Python SDK (google-genai)](#python-sdk-google-genai)
  - [工具调用 (Function Calling)](#工具调用-function-calling)
- [Web 管理控制台](#web-管理控制台)
- [开发与测试](#开发与测试)
- [借物表与致谢](#借物表与致谢-credits--acknowledgments)
- [开源协议](#开源协议)

---

## 核心特性

| 功能模块 | 说明 |
|---|---|
| **Gemini 协议兼容** | 支持 `/v1beta/...` 接口规范，包括 Thinking 思维链、多模态、Function Calling 工具调用、图片生成、TTS 语音合成及视频生成 |
| **动态模型发现** | 自动向上游同步可用模型列表，支持 `gemini-3.7-flash`、`gemini-3.8-flash` 等最新模型 |
| **多账号自动轮换** | 支持多账号管理与故障自动切换，按模型独立记录 429 冷却，每日美西午夜自动重置；支持付费模型按订阅等级抢切与 7 分钟周期 Cookie 自动轮换续期 |
| **运行状态持久化** | 模型调用量、Token 消耗统计 (`stats.json`) 以及账号 429 限额与冷却状态 (`rotator_state.json`) 自动落盘，容器/服务重启不丢失状态 |
| **下游参数容错与丢弃** | 支持配置 `drop_unsupported_params` 自动过滤下游传入的非标准安全分类（如 `HARM_CATEGORY_CIVIC_INTEGRITY`）与不兼容工具，避免 400 阻断 |
| **批量子账号探活** | 导入单个包含多个 Google 身份的 Cookie 后，自动探测子账号（`u/0`, `u/1`...）并分别建档 |
| **内置搜索与工具** | 支持 Google Search 联网搜索、Google Maps、代码执行沙箱、URL 上下文提取等官方扩展能力 |
| **双轨签名与特征对齐** | 脱离重型浏览器，支持本地 Go 签名服务 (SpiderMonkey 152) 与远程 NodeVM 签名节点，自动绑定匹配的 User-Agent 与请求头特征，并支持 5 级 403 自愈重试 |
| **Web 管理面板** | 提供 Web 管理控制台，支持账号分组与预设方案、文本/JSON 批量导入、调用量监控、WAA 节点切换、日志转储控制及在线热重载 `config.yaml` |
> [!NOTE]
> **内存占用参考**：脱离重型浏览器后，服务常驻物理内存仅约 35 - 50 MB，冷启动毫秒级，即使在入门级 Android 手机（Termux）或轻量服务器上亦可稳定高效常驻。
## 技术架构与文档

```
┌────────────────────────────────────────────────────────┐
│               Client (cURL / Python SDK)               │
└───────────────────────────┬────────────────────────────┘
                            │ /v1beta/models/...
┌───────────────────────────▼────────────────────────────┐
│              FastAPI HTTP Gateway (Port 8080)          │
├───────────────────────────┬────────────────────────────┤
│    Account Rotator        │    Chat & Wire Codec       │
│  (Sticky & 429 Isolation) │   (Protobuf-JSON / WAA)    │
└───────────────────────────┼────────────────────────────┘
                            │ Proof Mint & HTTP/2 Stream
┌───────────────────────────▼────────────────────────────┐
│       Browserless WAA Engine (waa-signer / Remote NodeVM)     │
│       Async Connection Pooling (HTTPStreamTransport)   │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS / RPC
┌───────────────────────────▼────────────────────────────┐
│         Google AI Studio (alkalimakersuite-pa)         │
└────────────────────────────────────────────────────────┘
```

详细的设计与协议分析文档：

- [系统架构设计 (ARCHITECTURE.md)](./docs/ARCHITECTURE.md)：分层架构、请求生命周期、Wire Codec 编解码与并发控制模型。
- [Wire 协议逆向技术规范 (WIRE_SPECIFICATION.md)](./docs/WIRE_SPECIFICATION.md)：Protobuf-JSON 数组映射、字段索引、多模态 Part 结构与 Schema 编码。
- [BotGuard 验证链路机制 (BOTGUARD_VERIFICATION_CHAIN.md)](./docs/BOTGUARD_VERIFICATION_CHAIN.md)：WAA 挑战握手、内容哈希计算、快照签名与服务端校验流程。
- [WAA 虚拟机内部架构与签名协议规范 (WAA_VM_ARCHITECTURE.md)](./docs/WAA_VM_ARCHITECTURE.md)：多态指令集 (ISA)、五阶段 ARX 流密钥派生、环境探针与 `!proof` TLV 字典。
- [开发与协作规范 (AGENT.md)](./AGENT.md)：类型系统要求、代码质量检查与开发指南。

---

## 快速开始

> [!NOTE]
> **开箱即用提示**：服务默认内置远程 WAA 证明签名节点，无需额外编译，安装依赖后**直接启动即可开箱即用**！若追求极致的毫秒级本地性能与离线化运行，可在运行后随时按需编译本地原生引擎（各平台步骤见下方进阶可选说明）。
### Android (Termux)

> [!TIP]
> **下载提示**：请务必从 [F-Droid](https://f-droid.org/packages/com.termux/) 或 [GitHub Releases](https://github.com/termux/termux-app/releases) 安装 Termux。**切勿使用 Google Play 商店版本**（Play 商店版本已停止维护，更新环境会报错）。

打开 Termux，依次复制执行以下命令：

```bash
# 步骤 1：更新 Termux 基础环境并安装 git
pkg update -y && pkg install -y git

# 步骤 2：克隆代码仓库并进入目录
git clone https://github.com/DeconstructedCube/aistudio-api.git
cd aistudio-api

# 步骤 3：初始化依赖环境并同步安装
bash scripts/setup-env.sh
uv sync

# 步骤 4：直接启动服务（开箱即用）
uv run python main.py server --port 8080
```

<details>
<summary><b>【进阶可选】编译本地原生高性能签名服务 (waa-signer)</b></summary>

若需脱离外部网络节点、获得 10~30 毫秒本地极速签名体验：
```bash
pkg install -y golang zig
bash waa-signer/build.sh
```
编译完成后重启服务，系统将自动识别并切换至本地原生引擎。
</details>

启动成功后：
1. 打开手机自带浏览器，访问 **`http://localhost:8080`** 即可进入 Web 管理控制台；
2. 参考下方 [账号凭据获取指引](#账号凭据-cookie-获取与导入指引) 导入 Google Cookie 即可开始调用；
3. **后台保活提示**：下拉手机通知栏，点击 Termux 通知项上的 `Acquire Wakelock`，并在手机系统设置中为 Termux 开启“无限制后台运行/电池优化白名单”，防止锁屏休眠被系统杀后台。
---

### Windows

推荐前置：电脑已安装 [Git](https://git-scm.com/)。Python 环境可由 `uv` 全自动管理。

打开 PowerShell 或终端，依次执行：

```bat
# 步骤 1：安装 uv 包管理工具
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# 步骤 2：克隆代码仓库并进入目录
git clone https://github.com/DeconstructedCube/aistudio-api.git
cd aistudio-api

# 步骤 3：同步安装项目依赖（uv 会自动安装所需 Python 环境）
uv sync

# 步骤 4：直接启动服务（开箱即用）
uv run python main.py server --port 8080
```

<details>
<summary><b>【进阶可选】一键编译本地高性能签名服务 (waa-signer.exe)</b></summary>

若需启用毫秒级本地原生签名引擎：
```powershell
# 推荐安装编译器（脚本亦支持自动检测与提示安装）：
winget install GoLang.Go zig.zig

# 执行一键构建脚本
.\waa-signer\build.bat
```
编译完成后重启服务即可生效。
</details>

服务启动后，浏览器访问 **`http://localhost:8080`** 进入管理控制台。

装好之后日常启动双击项目根目录的 **`start-server.cmd`** 即可（等价于步骤 4，出错时窗口会停住显示报错）。

---

### Linux / macOS

打开终端，依次执行：

```bash
# 步骤 1：安装 uv 包管理工具
curl -LsSf https://astral.sh/uv/install.sh | sh

# 步骤 2：克隆代码仓库并进入目录
git clone https://github.com/DeconstructedCube/aistudio-api.git
cd aistudio-api

# 步骤 3：同步安装项目依赖
uv sync

# 步骤 4：直接启动服务（开箱即用）
uv run python3 main.py server --port 8080
```

<details>
<summary><b>【进阶可选】编译本地高性能签名服务</b></summary>

前置要求：已安装 Go 1.22+ 与 zig（或 clang / gcc）：
```bash
bash waa-signer/build.sh
```
</details>

服务启动后，浏览器访问 **`http://localhost:8080`** 进入管理控制台。
---

### Docker 部署

> [!NOTE]
> 本项目 `Dockerfile` 采用多阶段构建，在镜像构建时会**全自动下载依赖并编译** `waa-signer` 二进制服务内置于容器内，容器启动时自动拉起本地原生签名引擎，开箱即用，无需手动构建。

```bash
docker run -d \
  --name aistudio-api \
  --restart unless-stopped \
  -p 8080:8080 \
  -v aistudio-api-data:/app/data \
  ghcr.io/deconstructedcube/aistudio-api:latest
```
使用 Docker Compose 启动：

```bash
docker compose up -d
```
启动后访问 **`http://localhost:8080`**（或服务器 IP 端口）进入管理控制台。

---

## 账号凭据 (Cookie) 获取与导入指引

本服务不会保存你的 Google 密码，仅通过 Web 端 Session 凭据进行 API 调用，且内置自动化 Cookie 续期轮换机制。

### 步骤 1：获取 AI Studio Cookie

1. 在电脑或手机浏览器中访问并登录 [Google AI Studio](https://aistudio.google.com/)，确保能够正常进入对话工作台；
2. 安装浏览器扩展 **Cookie-Editor**（可在 Chrome 应用商店、Edge 扩展中心或 Firefox 附加组件中心免费安装）；
3. 在 `aistudio.google.com` 标签页下，点击浏览器的 Cookie-Editor 图标；
4. 点击右下角 **Export** 按钮，选择 **Export as JSON**（亦可选择 Export as Header）；数据将自动复制到剪贴板。

### 步骤 2：导入至管理控制台

1. 访问本服务 Web 控制台（默认 `http://localhost:8080`）；
2. 点击左侧导航栏的 **「账号管理」**；
3. 点击右上角 **「+ 导入凭据」** 按钮；
4. 将剪贴板中的 Cookie 数据直接粘贴到输入框中，点击 **「确认导入」**；
5. 系统将自动完成连通性校验，并自动递归探测多登子账号（`u/0`, `u/1`...）完成多身份入库！

### 推荐：浏览器扩展自动续 Cookie（免手动重导）

> [!IMPORTANT]
> **Cookie 线（8080）长期稳定运行的依赖是两样东西**：`start-server.cmd`（或 `uv run python main.py server`）启动的代理，加上装在 Chrome 里的 `cookie-sync` 扩展，且该 Chrome 保持登录 Google。只导入一次 Cookie 而不装扩展，几小时后就会看到账号被标记「登录态失效」。
>
> 原因：Google 会定期滚动 `__Secure-1PSIDTS` / `SIDCC` 等短效凭据。你导出 Cookie 后浏览器仍在滚动自己那份，代理也在用 RotateCookies 滚动自己那份，同一登录会话出现两条互不相认的滚动链，Google 一段时间后会作废代理那条。扩展让代理改为实时复制浏览器的凭据，只保留一条链。
>
> 这条线和文首的「用 Chrome 临时聊天页给酒馆接单」（`start-browser-relay.cmd`，8090）是两套独立方案，互不依赖，可只开其一。

手动导出的快照过几小时就可能失效。[browser-extension/cookie-sync](./browser-extension/cookie-sync) 是一个 50 行的 Chrome 扩展：浏览器里这些 Cookie 一变化就把当前登录态推到 `POST /api/accounts/sync-cookies`，代理按会话锚点 (SAPISID) 就地覆盖同一浏览器会话下的全部子账号并解除“登录态失效”隔离；匹配不到已有账号时自动走探活导入。

1. 打开 `chrome://extensions`，右上角开启「开发者模式」，点「加载已解压的扩展程序」，选择 `browser-extension/cookie-sync` 目录；
2. 代理不在本机 8080 或控制台设了 `AISTUDIO_WEB_PASSWORD`，改 `background.js` 顶部的 `ENDPOINT` / `WEB_PASSWORD` 两行后在扩展页点「重新加载」；
3. 扩展图标角标显示 `OK` 即同步成功，`OFF` 为代理未启动，`OUT` 为浏览器未登录 Google。点图标可立即手动同步。

浏览器持续喂 Cookie 期间，代理不再自行调用 RotateCookies，避免两条滚动链互相挤掉。

---

## 第三方客户端配置指引 (NextChat / Cherry Studio / One API 等)

> [!WARNING]
> **必须选择 Google Gemini 协议**！
> 本项目是专为 Google Gemini API 规范打造的反向代理网关，**不包含 OpenAI 协议兼容接口**（如 `/v1/chat/completions`）。在任何客户端中配置时，模型提供商类型请务必选择 **Google Gemini**（或 **Gemini**），切勿选择 OpenAI 格式。

| 配置项目 | 填写内容 | 说明 |
|---|---|---|
| **模型提供商 (Provider)** | **Google Gemini** | 严禁选择 OpenAI 或自定义 OpenAI 格式 |
| **API Base URL / 代理地址** | `http://localhost:8080` | 若客户端要求必须带版本号，可填写 `http://localhost:8080/v1beta` |
| **API Key / 密钥** | 任意字符串 (如 `aistudio-api`) | 若未在服务端 `config.yaml` 中配置 `api_keys`，客户端填写任意非空字符即可；若服务端已配置鉴权 Key 则需匹配 |
| **支持的模型名称** | `gemini-3.7-flash`<br/>`gemini-3.8-flash`<br/>`gemini-4-argon`<br/>`gemini-3.1-flash-image` | 自动向上游同步所有可用模型，支持官方全部功能 |

## 配置与环境变量

服务启动后可访问 `http://localhost:8080` 进入 Web 控制台完成可视化管理。

### 环境变量支持

| 变量名 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `AISTUDIO_PORT` | int | `8080` | API 服务监听端口 |
| `AISTUDIO_WEB_PASSWORD` | string | `""` | Web 控制台访问密码（亦可设置 `AISTUDIO_ADMIN_PASSWORD`） |
| `AISTUDIO_PROXY` | string | `""` | 出口代理地址，支持 `http://`、`https://` 或 `socks5://` |
| `AISTUDIO_DATA_DIR` | string | `data/` | 主数据持久化根目录（Docker 下为 `/app/data`） |
| `AISTUDIO_ACCOUNTS_DIR` | string | `data/accounts` | 账号持久化凭据目录 |
| `AISTUDIO_STATS_FILE` | string | `data/stats.json` | 模型调用与 Token 使用量统计持久化文件 |
| `AISTUDIO_ROTATOR_STATE_FILE` | string | `data/rotator_state.json` | 账号调度与 429 冷却状态持久化文件 |
| `AISTUDIO_CONFIG_FILE` | string | `config.yaml` | 模型规则与默认工具配置文件路径 |
| `AISTUDIO_PERSIST_STATS` | bool | `true` | 是否持久化模型调用与 Token 统计（1=开启，0=关闭） |
| `AISTUDIO_PERSIST_ROTATOR` | bool | `true` | 是否持久化账号 429 冷却与调度状态（1=开启，0=关闭） |
| `AISTUDIO_PROOF_SERVER_URL` | string | `https://waa.spinsnow.fun` | 签名服务兜底地址，优先使用 `config.yaml` 中 `waa.active_server` 指定的节点。设置 `waa.allow_remote_fallback: false` 后，本地签名器不可用会导致启动失败。 |
| `AISTUDIO_DEFAULT_TEXT_MODEL` | string | `gemini-3.7-flash` | 默认文本模型 |
| `AISTUDIO_TIMEZONE` | string | 自动探测 | Wire 协议交互时区（默认 `America/Los_Angeles`） |
| `AISTUDIO_DUMP_REQUESTS` | bool | `false` | 是否在终端转储每次 API 交互报文详情（支持 `DEBUG=1` 触发） |
| `AISTUDIO_DUMP_FILE` | bool | `false` | 是否将请求与响应报文详情落盘保存 |
| `AISTUDIO_DUMP_DIR` | string | `dumps/` | 报文转储保存目录 |
---

## API 调用示例

支持以下鉴权方式：
- Query 参数：`?key=YOUR_API_KEY`
- 请求头：`x-goog-api-key: YOUR_API_KEY`、`x-api-key: YOUR_API_KEY` 或 `Authorization: Bearer YOUR_API_KEY`

### cURL 调用

<details>
<summary><b>1. 查询模型列表</b></summary>

```bash
curl http://localhost:8080/v1beta/models \
  -H "x-goog-api-key: your-api-key"
```
</details>

<details>
<summary><b>2. 文本生成 (Non-streaming)</b></summary>

```bash
curl http://localhost:8080/v1beta/models/gemini-3.7-flash:generateContent \
  -H "x-goog-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [{"text": "用简短的一句话介绍量子计算。"}]
      }
    ]
  }'
```
</details>

<details>
<summary><b>3. 流式生成 (Server-Sent Events)</b></summary>

```bash
curl http://localhost:8080/v1beta/models/gemini-3.7-flash:streamGenerateContent?alt=sse \
  -H "x-goog-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [{"text": "介绍一下 Python 协程的工作原理。"}]
      }
    ]
  }'
```
</details>

---

### Python SDK (google-genai)

使用 Google 官方 `google-genai` SDK 直连本代理服务：

```python
from google import genai

client = genai.Client(
    api_key="your-api-key",
    http_options={
        "api_version": "v1beta",
        "base_url": "http://localhost:8080",
    },
)

# 1. 流式响应
response = client.models.generate_content_stream(
    model="gemini-3.7-flash",
    contents="解释一下什么是反应式编程？",
)
for chunk in response:
    print(chunk.text, end="", flush=True)

# 2. 非流式响应
result = client.models.generate_content(
    model="gemini-3.7-flash",
    contents="用 Python 写一个快速排序算法。",
)
print(result.text)
```

---

### 工具调用 (Function Calling)

```python
from google import genai
from google.genai import types

client = genai.Client(
    api_key="your-api-key",
    http_options={
        "api_version": "v1beta",
        "base_url": "http://localhost:8080",
    },
)

# 定义工具声明
weather_tool = types.Tool(
    function_declarations=[
        types.FunctionDeclaration(
            name="get_current_weather",
            description="获取指定地点的实时天气状况",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "location": types.Schema(
                        type="STRING",
                        description="城市或地区名称，例如 'Beijing' 或 'Tokyo'",
                    ),
                    "unit": types.Schema(
                        type="STRING",
                        enum=["celsius", "fahrenheit"],
                        description="温度单位",
                    ),
                },
                required=["location"],
            ),
        )
    ]
)

response = client.models.generate_content(
    model="gemini-3.7-flash",
    contents="今天杭州天气怎么样？",
    config=types.GenerateContentConfig(tools=[weather_tool]),
)

if response.function_calls:
    for call in response.function_calls:
        print(f"触发工具调用: {call.name}")
        print(f"调用参数: {call.args}")
```

---

## Web 管理控制台

系统内置静态打包的 Web 前端管理控制台（访问 `http://localhost:8080`）：

- **仪表盘 (Dashboard)**：实时展示服务健康状况、各模型请求量、成功率及 429 冷却指标。
- **账号管理 (Accounts)**：支持 Cookie 单条与凭据包批量导入、自动探测多账号、业务分组与预设方案一键切换、手动切换活跃账号或重置冷却状态。
- **系统设置 (Settings)**：在线编辑与热重载 `config.yaml`、手动切换 WAA 签名服务节点、管理 API Key 以及动态调整日志级别与请求转储开关。
- **访问鉴权**：设置环境变量 `AISTUDIO_WEB_PASSWORD` 后自动开启登录鉴权守卫。

---

## 开发与测试

前端源码位于 `web/`，采用 Vue 3 + TypeScript + Vite + Tailwind CSS：

```bash
# 启动前端开发调试服务
cd web
bun install
bun run dev          # 启动开发服务（localhost:3000，代理至 8080）
bun run type-check   # 执行 TypeScript 类型校验
bun run lint         # 执行 ESLint 代码规范检查
bun run build        # 生产构建，产物输出至 src/aistudio_api/static
```

Python 端质量检查与测试：

```bash
# 执行代码风格与 Lint 检查
uv run ruff check .
# 执行静态类型检查
bun x pyright src tests

# 执行单元测试套件
uv run pytest
```

---

## 借物表与致谢 (Credits & Acknowledgments)

本项目在逆向工程、签名算法与协议实现过程中，参考并借鉴了以下优秀的开源项目与社区成果，在此致以诚挚的感谢：

- **[Mag1cFall/AIStudio2API](https://github.com/Mag1cFall/AIStudio2API)**：提供了嵌入式 SpiderMonkey 152 运行时与 Firefox 152 DOM / WebIDL 宿主现场实现，以及基于 uTLS 的网络栈设计，`waa-signer` 服务基于其核心逻辑适配抽离。
- **[Lianues/aistudio-pg-bridge](https://github.com/Lianues/aistudio-pg-bridge)**：开创了脱离本地浏览器的轻量化 WAA 证明签名服务思路，并确立了 `/v1/proof/mint` 接口规范。
- **[spinsnow](https://waa.spinsnow.fun)**：提供了公开稳定的 Node.js VM WAA 签名中继服务与环境参考。
- **[Camoufox](https://github.com/daijro/camoufox)** 与 **[go-browserforge](https://github.com/brainplusplus/go-browserforge)**：提供了真实浏览器环境指纹数据与反指纹追踪生成算法。

---

## 开源协议

本项目基于 [MIT License](./LICENSE) 许可协议开源。
