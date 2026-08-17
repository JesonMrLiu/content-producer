# publish MCP

内容发布 MCP server（Node+TS），当前覆盖**微信公众号**的素材上传与图文草稿创建；小红书不走本 server（由 publish agent 复用 playwright MCP 做浏览器预填）。

## 工具

| 工具 | 说明 |
|---|---|
| `wechat_check_config` | 校验 WECHAT_APP_ID / WECHAT_APP_SECRET 与 IP 白名单，返回中文诊断信息 |
| `wechat_publish_draft` | 一键建草稿：读 article.md → 上传封面（add_material → thumb_media_id）→ 上传全部正文图（uploadimg → 微信域名 URL）→ markdown 转公众号内联样式 HTML → draft/add。返回草稿 media_id 与图片清单 |

**「发表」不在 server 范围内**：2025 年 7 月起个人主体账号的 API 发布权限被回收，草稿创建后由用户到 mp.weixin.qq.com 草稿箱手动点「发表」。

## 配置

| 变量 | 说明 |
|---|---|
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 公众号凭证：mp.weixin.qq.com → 设置与开发 → 基本配置获取；并把本机出口 IP 加入同页的 **IP 白名单**（否则报 40164） |

凭证可在系统环境变量设置，或直接填在 `plugin/.claude-plugin/plugin.json` 的 `mcpServers.publish.env`。缺失时工具返回中文配置指引（server 不退出），publish agent 自动回退半自动打包。

## 构建

```bash
npm install --registry=https://registry.npmmirror.com
npm run build   # tsc → dist/
```

## 与审核闸的配合

`plugin/hooks/hooks.json` 的 PreToolUse 拦截器匹配 `mcp__plugin_content-producer_publish__wechat_publish_draft` 并返回 `permissionDecision:"ask"`——每次建草稿前 Claude Code 会弹人工确认，作为主 skill 审核指令之外的第二道强制确认闸。

## 小红书为何不在此实现

无官方个人开放 API，浏览器自动化交由 agent 驱动 playwright MCP 更抗页面改版（实时读可访问性快照自适应定位，不硬编码选择器）；且只预填、不代点「发布」，控制风控风险。
