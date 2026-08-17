---
name: produce
description: 复刻公众号/小红书内容并发布的便捷入口（content-producer 主 skill 的短别名）
disable-model-invocation: true
argument-hint: "<目标链接> [内容描述] [--product 产品] [--platform wechat|xhs]"
---

执行 content-producer 主 skill（内容生产主编排），参数如下：

$ARGUMENTS

按 `content-producer` skill 的编排流程执行：解析参数 → fetch-content → explore-product → generate-content → generate-images → assemble-content → **强制人工审核** → （用户确认后）publish。
