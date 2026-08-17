#!/usr/bin/env node
/**
 * 发布工具审核闸（PreToolUse hook）。
 *
 * 匹配到发布类 MCP 工具调用（当前为 wechat_publish_draft）时，
 * 让 Claude Code 弹出人工确认对话框——这是主 skill 第 6 步强制审核之外的第二道闸。
 * 消费 stdin 中的 hook 载荷后输出 permissionDecision: "ask"。
 */
let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "发布类操作（创建公众号草稿会写入公众号后台），请人工确认后再执行。",
    },
  };
  process.stdout.write(JSON.stringify(output));
});
