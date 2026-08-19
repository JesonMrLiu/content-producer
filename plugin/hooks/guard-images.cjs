#!/usr/bin/env node
/**
 * 图片删除守卫（PreToolUse hook，matcher: Bash）。
 *
 * 拦截对正式 images/ 目录下图片文件的 rm 删除命令（sub-agent 应改用 mv 移入
 * images-trash/ 回收站，并在 trash-manifest.md 追加记录）。
 * 命中 → 输出 permissionDecision: "deny"；未命中 → 零输出放行（不干扰其他 Bash 命令）。
 */
let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0); // 载荷解析失败一律放行
  }

  const command = (payload.tool_input && payload.tool_input.command) || "";
  // 只处理删除类命令（rm / unlink / git rm；del 仅当命令以 del 开头，即 cmd 风格）
  const isDeleteCmd =
    /\b(rm|unlink)\b/.test(command) || /^\s*del\b/i.test(command);
  if (!isDeleteCmd) process.exit(0);

  // 提取候选路径：引号内（可能含空格）与裸路径（去掉引号段后取 token）
  const quoted = command.match(/"([^"]+)"|'([^']+)'|`([^`]+)`/g) || [];
  const bare = command
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, " ")
    .match(/[\w.:/\\~-]+/g);
  const candidates = [...quoted.map((s) => s.slice(1, -1)), ...(bare || [])];

  // 是否命中受保护的 images/ 目录。
  // 精确匹配「content-output/<task-id>/images/」模式（正/反斜杠均可）：
  // - 受保护对象是该模式下的图片文件，或整个 images/ 目录
  // - 其他名为 images 的目录（如 dist/images/）不受保护，避免误伤构建目录
  const targetsImages = candidates.some((tok) => {
    const t = tok.trim();
    if (!t) return false;
    // 回收站自身可自由清理，不属于保护范围
    if (t.includes("images-trash")) return false;
    const norm = t.replace(/\\/g, "/").replace(/^\.\//, "");
    // images 后无斜杠（rm -rf images）或仅斜杠（rm -rf images/）都算删除整个目录
    const m = norm.match(/content-output\/[^/]+\/images(?:\/(.*))?$/i);
    if (!m) return false;
    const rest = m[1] || ""; // 未匹配子路径 → 整个 images 目录
    if (rest === "") return true;
    // images 下还有子路径（子目录，可能含图片）→ 拦截；单级文件 → 仅图片文件拦截
    if (rest.includes("/")) return true;
    return /\.(png|jpe?g|webp|gif)$/i.test(rest);
  });

  if (!targetsImages) process.exit(0); // 未命中放行

  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "禁止直接 rm 删除 images/ 目录下的图片（被否决的版本会被误删无法找回）。请用 mv 将被否决的图片移入同级的 images-trash/ 回收站，并在 trash-manifest.md 中追加记录。",
    },
  };
  process.stdout.write(JSON.stringify(output));
});
