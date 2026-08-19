# generate-image MCP server

通用 **OpenAI 兼容**图片生成 MCP server，通过环境变量配置后端，提供两个工具：

- `generate_image`：按提示词生成图片并保存到指定本地路径（可选请求无水印）。
- `crop_image`：按百分比裁剪本地图片四边（常用于去除边缘水印，纯本地处理，与生图厂商无关）。

## 工具

### `generate_image`

| 参数 | 必填 | 说明 |
|---|---|---|
| `prompt` | 是 | 图片生成提示词 |
| `outputPath` | 是 | 保存图片的绝对路径（含文件名），自动创建父目录 |
| `size` | 否 | 图片尺寸，如 `1024x1024` / `1792x1024` |
| `model` | 否 | 模型名 |
| `quality` | 否 | 图片质量，如 `standard` / `hd` |
| `watermark` | 否 | 是否添加 AI 水印；传 `false` 请求无水印图。仅当后端支持水印参数时生效（见 `IMAGE_GEN_WATERMARK_PARAM`），后端不认识该参数时自动去掉重试并在返回中附 `watermarkParamDropped: true` |

返回 `{ success, path }`（可能附 `watermarkParamDropped`）。同时兼容后端返回 `url`（自动下载）或 `b64_json`（自动解码）。

### `crop_image`

| 参数 | 必填 | 说明 |
|---|---|---|
| `inputPath` | 是 | 待裁剪图片的绝对路径 |
| `outputPath` | 否 | 结果保存路径（含文件名），缺省原地覆盖 |
| `top` / `right` / `bottom` / `left` | 否 | 各边裁剪百分比 0–15，默认 0 |

返回 `{ success, path, width, height }`。输出格式跟随 `outputPath` 扩展名（png 无损、jpeg 质量 95、webp）。

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `IMAGE_GEN_API_KEY` | 是 | — | 绘图 API 密钥 |
| `IMAGE_GEN_BASE_URL` | 否 | `https://api.openai.com/v1` | API 基址 |
| `IMAGE_GEN_MODEL` | 否 | `dall-e-3` | 默认模型 |
| `IMAGE_GEN_SIZE` | 否 | `1024x1024` | 默认尺寸 |
| `IMAGE_GEN_TIMEOUT_MS` | 否 | `120000` | 请求超时（毫秒） |
| `IMAGE_GEN_WATERMARK_PARAM` | 否 | `watermark_enabled` | 后端水印参数名。默认适配智谱（关闭水印需在智谱个人中心签署去水印声明）；换成不支持该参数的厂商时，改为对应参数名，或**设为空字符串完全不发送**。参数被后端拒绝时会自动去参重试，不影响生成 |

换成任意 OpenAI 兼容绘图 API 时，只需改 `BASE_URL` / `MODEL` / `API_KEY`（以及按需调整 `IMAGE_GEN_WATERMARK_PARAM`）。

### 跨平台配置方式

#### Windows

**方式一：永久环境变量（推荐）**
```cmd
setx IMAGE_GEN_API_KEY "your-api-key"
setx IMAGE_GEN_BASE_URL "https://api.openai.com/v1"
setx IMAGE_GEN_MODEL "dall-e-3"
setx IMAGE_GEN_SIZE "1024x1024"
setx IMAGE_GEN_TIMEOUT_MS "120000"
setx IMAGE_GEN_WATERMARK_PARAM "watermark_enabled"
```
配置后需**重启终端/Claude Code** 使其生效。

**方式二：当前窗口生效（重启后失效）**
```cmd
set IMAGE_GEN_API_KEY=your-api-key
```

#### macOS / Linux

**方式一：写入配置文件（推荐）**
```bash
# 编辑 ~/.bashrc 或 ~/.zshrc
export IMAGE_GEN_API_KEY="your-api-key"
export IMAGE_GEN_BASE_URL="https://api.openai.com/v1"
export IMAGE_GEN_MODEL="dall-e-3"
export IMAGE_GEN_SIZE="1024x1024"
export IMAGE_GEN_TIMEOUT_MS="120000"
export IMAGE_GEN_WATERMARK_PARAM="watermark_enabled"

# 使配置生效
source ~/.bashrc   # 或 source ~/.zshrc
```

### 备选方案：直接在 settings.json 中配置

若系统环境变量配置未生效，可将配置直接写入 Claude Code 的 `settings.json`：

在 `~/.claude/settings.json`（用户级）或 `项目/.claude/settings.json`（项目级）中添加：

```json
{
  "env": {
    "IMAGE_GEN_API_KEY": "your-api-key",
    "IMAGE_GEN_BASE_URL": "https://api.openai.com/v1",
    "IMAGE_GEN_MODEL": "dall-e-3",
    "IMAGE_GEN_SIZE": "1024x1024",
    "IMAGE_GEN_TIMEOUT_MS": "120000",
    "IMAGE_GEN_WATERMARK_PARAM": "watermark_enabled"
  }
}
```

> `settings.json` 中的 `env` 字段优先级高于系统环境变量，会注入到所有 MCP server 进程。`IMAGE_GEN_API_KEY` 缺失时 MCP server 会直接退出。

## 构建

```bash
npm install
npm run build     # 产物在 dist/index.js
npm start         # 或 node dist/index.js
```

调试可用 MCP Inspector：

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

（需先在环境里配好 `IMAGE_GEN_*`）

## MCP 配置（独立使用）

本包已发布至 npmjs，可单独安装使用：

```bash
npm install @jesonliu/generate-image-mcp-server
```

在 Claude Code 的 `plugin.json` 或 `.mcp.json` 中配置：

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

> 仅有 `IMAGE_GEN_API_KEY` 为必填；其余变量均有默认值，可按需覆盖。

npmjs 链接：https://www.npmjs.com/package/@jesonliu/generate-image-mcp-server

## 作为插件的一部分

本目录是 `content-producer` 插件的图片生成后端。插件通过 `plugin/.mcp.json` 以 `node ${CLAUDE_PLUGIN_ROOT}/../mcpserver/generate-image/dist/index.js` 启动它。

### 发布为独立 npm 包（marketplace 分发时）

marketplace 安装插件时只打包 `plugin/` 目录，本目录（在 `plugin/` 之外）不会被复制。正式发布时：

1. 把本目录发布为 npm 包（如 `@your-name/generate-image-mcp`）。
2. 把 `plugin/.mcp.json` 中 `generate-image` 一项改为：
   ```json
   "generate-image": {
     "command": "npx",
     "args": ["-y", "@your-name/generate-image-mcp"]
   }
   ```
