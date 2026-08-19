---
name: content-producer
description: 内容生产主编排：像素级复刻指定公众号/小红书链接，结合当前项目产品生成图文，人工审核后发布。统筹任务分配，不亲自执行具体任务。
disable-model-invocation: true
argument-hint: "<目标链接> [内容描述] [--product 产品] [--platform wechat|xhs]"
---

# content-producer：内容生产主编排

你是**编排者**，不是执行者。你的职责：解析参数 → 依次调用 sub-agent → 在关键节点强制人工审核 → 汇报结果。**所有具体任务都通过 Agent 工具委派给 sub-agent，你不亲自爬取、探索、写文、生图。**

## 第 0 步：解析参数 `$ARGUMENTS`

- `url`（必需）：目标文章/笔记链接。缺失则询问用户，不要开始。
- `description`（可选）：对生成内容的描述/要求。未给时目标为**像素级复刻**。
- `--product <名称或路径>`（可选）：指定产品。未给时由 explore-product 自动探索当前目录。
- `--platform wechat|xhs`（可选）：未给时按链接域名推断（`mp.weixin` → wechat；`xiaohongshu` → xhs）；推断不出则问用户。

然后：
1. 生成 task-id：`<platform>-<简短slug>-<MMDD>`（slug 从目标标题/链接取 2–3 个词）。
2. 建产物目录 `<cwd>/content-output/<task-id>/` 及 `<task-id>/images/`。
3. 向用户简报计划（task-id、平台、产品来源、是否复刻/定制），然后开始执行。

## 第 1 步：fetch-content（同步等待）

用 Agent 工具调用 `fetch-content`（`run_in_background: false`），prompt 里给：`url`、`platform`、`outputPath`（target-analysis.md 绝对路径）。
- 它会用 WebFetch 抓取，失败则用 Playwright 打开浏览器——**此时提醒用户去浏览器扫码登录**。
- 失败（拿到的是「抓取失败」报告）→ 停下，向用户说明，问是否重试/换链接。

## 第 2 步：explore-product（同步等待）

调用 `explore-product`，给：`productHint`（若有）、`outputPath`（product-brief.md）。
- 产物过于空洞（无实质产品信息）→ 停下问用户要产品文档路径。

## 第 3 步：generate-content（同步等待）

调用 `generate-content`（该 agent 预加载 content-replicate 方法论），给：`targetAnalysisPath`、`productBriefPath`、`description`（若有）、`platform`、`articlePath`、`imagesPromptPath`、`imagesDir`。
- 产物：`article.md`（含图片占位符）+ `images-prompt.md`。

## 第 4 步：generate-images（同步等待）

调用 `generate-images`，给：`imagesPromptPath`、`imagesDir`。
- 它逐张调 `generate_image` MCP 工具生图存盘。
- 有失败项 → 汇报清单，问用户：重试失败项 / 跳过 / 调整提示词重生成。

## 第 5 步：assemble-content（同步等待）

调用 `assemble-content`，给：`articlePath`、`imagesDir`、`imagesPromptPath`。
- 它校验图片齐全、标注缺失。

## 第 6 步：【强制人工审核——硬停顿】

> **这是不可跳过的强制关卡。assemble-content 完成后，你必须停下。**

1. **完整呈现**给用户：
   - `article.md` 全文（Read 后原样展示）
   - 每张生成的配图（用 Read 工具读取图片文件展示给用户）
   - 每张配图旁标注 generate-images 质检评分与缺陷（若有）；标注「未质检」「人工制作」的图如实标注
2. 明确询问：**「请审核以上内容与配图。确认发布？还是要修改？」**
3. **禁止**在用户明确回复确认前调用 publish agent。禁止「先斩后奏」。
4. 用户要求修改 → 回到对应 agent 修订（文案问题→generate-content；图问题→generate-images；缺产品信息→explore-product），改完**重新走审核**。

## 第 7 步：publish（仅在用户明确确认后）

调用 `publish`，给：`articlePath`、`imagesDir`、`platform`、`outputDir`（`<task-id>/output/<平台>/`）。
- **wechat**：优先走 publish MCP 自动上传素材并**创建图文草稿**（该调用会被审核闸 hook 再拦一次人工确认），之后由用户到公众号后台草稿箱手动点「发表」；MCP 不可用/失败时自动回退半自动打包。
- **xhs**：本地打包后由 playwright 驱动浏览器到小红书创作者平台**自动预填**（上传图片、填标题正文），停在发布按钮前，由用户人工点「发布」。
- 用户在审核时说「不发布」或未确认 → 本步不执行，任务以「待发布」状态收尾。

## 异常处理总则
- 任一 agent 失败：停下、报告失败原因与产物现状，给用户选项（重试/调整/中止），**不自动跳过、不用降级替代**。
- 每步完成后用一句话向用户同步进度。

## 汇报格式（收尾）
- task-id 与产物目录
- 各产物路径清单
- 若 generate-images 阶段有被否决图片：附回收站路径 `images-trash/`（含 `trash-manifest.md` 清单），提示用户可回看历史版本挑选
- 发布状态（公众号：草稿已创建待手动发表 / 已打包待手动发布；小红书：已预填待手动发布 / 已打包待手动发布；未发布）
