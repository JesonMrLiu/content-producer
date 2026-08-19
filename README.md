# content-producer

一个 Claude Code 内容生产插件：**像素级复刻**公众号文章 / 小红书笔记，结合当前项目的产品信息，重新生成图文内容并发布（公众号 API 自动建草稿、小红书浏览器自动预填，最终「发表/发布」均由人工点击）。

## 架构：主 skill 编排 + 多 sub-agent + MCP

- **主 skill `content-producer`**（仅手动触发 `/produce`）：统筹任务分配，不亲自执行；在发布前**强制人工审核**。
- **6 个 sub-agent**：
  - `fetch-content` — 爬取/读取目标链接，拆解其写法、结构、配图套路（复刻首要依据）
  - `explore-product` — 读 CLAUDE.md → 产品文档 → 自动探索，归纳产品定位与卖点
  - `generate-content` — 结合拆解 + 产品，复刻生成正文 + 独立配图提示词
  - `generate-images` — 按配图提示词逐张生图，按预置文件名存盘
  - `assemble-content` — 校验/回填图片路径到正文
  - `publish` — 发布：公众号 API 自动上传素材并创建草稿，小红书 playwright 浏览器自动预填；「发表/发布」由用户人工点击，失败回退半自动打包
- **MCP**：
  - `image-recognition`（内置识图：`@jesonliu/image-recognition-mcp`，fetch-content 拆解目标配图 + generate-images 质检共用）
  - `generate-image`（自带，Node+TS，通用可配置后端）
  - `publish`（自带，Node+TS，公众号素材上传 + 图文草稿创建）
  - `playwright`（反爬登录兜底 + 小红书发布预填）

## MCP 配置

两个自研 MCP server 均已发布至 npmjs，可独立安装使用：

> **环境变量配置**：Windows 用 `setx`（永久）或 `set`（当前窗口）；macOS/Linux 用 `export` 写入 `~/.bashrc`/`~/.zshrc`。环境变量未生效时，可直接在 `~/.claude/settings.json` 的 `env` 字段中配置（优先级更高）。详见各 MCP server 目录下的 README.md。

### generate-image

```bash
npm install @jesonliu/generate-image-mcp-server
```

```json
{
  "mcpServers": {
    "generate-image": {
      "command": "npx",
      "args": ["-y", "@jesonliu/generate-image-mcp-server"],
      "env": {
        "IMAGE_GEN_API_KEY": "${IMAGE_GEN_API_KEY}",
        "IMAGE_GEN_BASE_URL": "${IMAGE_GEN_BASE_URL:-https://api.openai.com/v1}",
        "IMAGE_GEN_MODEL": "${IMAGE_GEN_MODEL:-dall-e-3}",
        "IMAGE_GEN_SIZE": "${IMAGE_GEN_SIZE:-1024x1024}",
        "IMAGE_GEN_TIMEOUT_MS": "${IMAGE_GEN_TIMEOUT_MS:-120000}",
        "IMAGE_GEN_WATERMARK_PARAM": "${IMAGE_GEN_WATERMARK_PARAM:-watermark_enabled}"
      }
    }
  }
}
```

### publish

```bash
npm install @jesonliu/publish-mcp-server
```

```json
{
  "mcpServers": {
    "publish": {
      "command": "npx",
      "args": ["-y", "@jesonliu/publish-mcp-server"],
      "env": {
        "WECHAT_APP_ID": "${WECHAT_APP_ID}",
        "WECHAT_APP_SECRET": "${WECHAT_APP_SECRET}"
      }
    }
  }
}
```

详见各 MCP server 目录下的 README.md。

## 目录结构

```
content-producer/
├── .claude-plugin/
│   └── marketplace.json   # 本地 marketplace 清单
├── mcpserver/      # MCP server 源码（generate-image、publish）
│   ├── generate-image/
│   └── publish/
└── plugin/         # Claude Code 插件本体
    ├── .claude-plugin/plugin.json   # 插件清单（内嵌 mcpServers 配置）
    ├── skills/     # content-producer（主编排）+ content-replicate（复刻方法论）
    ├── agents/     # 6 个 sub-agent
    ├── commands/   # /produce 便捷入口
    └── hooks/      # 发布审核闸：PreToolUse 人工确认（ask-confirm.cjs）
```

## 快速开始

安装、配置与使用详见 [`plugin/README.md`](./plugin/README.md)。

核心用法：

```
/produce <目标链接> [内容描述] [--product 产品名] [--platform wechat|xhs]
```
