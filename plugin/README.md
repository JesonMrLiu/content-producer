# content-producer 插件

像素级复刻公众号 / 小红书爆款 → 结合当前产品生成图文 → 审核后发布。

## 核心特性

- **复刻为主**：拆解目标链接的写法/结构/配图套路，套用到自己的产品（非套固定模板）。
- **自动取产品信息**：读取当前项目的 `CLAUDE.md` → 其指向的产品文档 → 否则自动探索目录。
- **正文 + 逐张配图**：正文预置图片占位符，独立 `images-prompt.md` 承载生图提示词，逐张生成。
- **强制人工审核**：内容与图生成后、发布前**必须**停下等你确认。
- **发布自动化**：公众号经 publish MCP 自动上传素材并创建图文草稿（个人订阅号无 API 发布权限，「发表」由你在后台手动点击）；小红书由 playwright 驱动浏览器自动预填（上传图、填标题正文），停在发布按钮前；凭证缺失/失败自动回退半自动本地打包。

## 安装

两个自研 MCP server（`generate-image`、`publish`）已发布为 npm 包（`@jesonliu/generate-image-mcp-server`、`@jesonliu/publish-mcp-server`），经 `npx` 按需拉取，**无需本地构建**。在 Claude Code 中执行：

```
/plugin marketplace add JesonMrLiu/content-producer
/plugin install content-producer@content-producer
```

> 安装会把 `plugin/` 复制到 `~/.claude/plugins/cache`。之后修改插件文件需执行 `claude plugin update content-producer@content-producer` 同步。

### 本地开发调试（可选）

不安装、直接从原目录加载：`claude --plugin-dir ./plugin`

## 配置：图片生成后端

`generate-image` MCP 通过环境变量适配任意 **OpenAI 兼容**的绘图 API。在 Claude Code settings 的 `env` 中配置：

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `IMAGE_GEN_API_KEY` | 是 | — | 绘图 API 密钥 |
| `IMAGE_GEN_BASE_URL` | 否 | `https://api.openai.com/v1` | API 基址 |
| `IMAGE_GEN_MODEL` | 否 | `dall-e-3` | 模型名 |
| `IMAGE_GEN_SIZE` | 否 | `1024x1024` | 默认尺寸 |
| `IMAGE_GEN_TIMEOUT_MS` | 否 | `120000` | 请求超时（毫秒） |

## 配置：公众号发布（可选）

不配置则公众号发布自动回退半自动打包（小红书不受影响）。步骤：

1. mp.weixin.qq.com → 设置与开发 → 基本配置，获取 **AppID / AppSecret**（Secret 需启用开发者密码）；
2. 同页把**本机出口 IP 加入 IP 白名单**（否则建草稿报 40164）；
3. 配置系统环境变量 `WECHAT_APP_ID` / `WECHAT_APP_SECRET`（Windows 可用 `setx`，配置后重启终端/Claude Code 生效）。

配置后可让 Claude 调 `wechat_check_config` 验证。小红书无需配置，首次发布时在弹出的浏览器里**扫码登录一次**即可（playwright 持久化登录态）。

## 使用

```
/produce <目标链接> [内容描述] [--product 产品名] [--platform wechat|xhs]
```

- 未给 `--platform` 时按链接域名自动推断（`mp.weixin` → wechat；`xiaohongshu` → xhs）。
- 未给 `--product` 时探索当前目录的产品。

### 产物

所有中间产物与最终输出在当前工作目录的 `content-output/<task-id>/`：

```
content-output/<task-id>/
├── target-analysis.md   # 目标拆解
├── product-brief.md     # 产品摘要
├── article.md           # 正文（含图片占位）
├── images-prompt.md     # 配图提示词
├── images/*.png         # 生成的配图
└── output/<平台>/       # 发布打包产物
```

## 反爬与小红书发布说明

小红书等需登录的站点，自动爬取失败后会用 **Playwright** 打开浏览器——请在弹出的浏览器中扫码登录，登录后自动读取内容。小红书**发布**同样走浏览器：publish agent 自动上传配图、填标题正文后停在发布按钮前，由你核对并手动点「发布」（非官方自动化，请控制发布频率）。

## 审核流程（强制，两道闸）

1. **主 skill 硬停顿**：`generate-images` + `assemble-content` 完成后，主 skill 会**停下**，完整呈现正文与配图征求确认；你明确同意后才会进入 `publish`。要求修改则回到对应 agent 修订后重审。
2. **hooks 审核闸**：调用公众号建草稿工具（`wechat_publish_draft`）时，PreToolUse hook 会再弹一次人工确认，作为第二道强制确认。
