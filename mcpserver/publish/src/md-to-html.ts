/**
 * markdown → 微信公众号图文 HTML 转换器。
 *
 * 公众号编辑器只保留内联样式（class/脚本会被剥离），因此所有元素直接写 style；
 * 链接渲染为带色的纯文本（未认证订阅号正文不允许外链）；
 * 图片 src 用已上传的微信图片 URL 替换，「图N：图注」渲染为图片下方居中小字。
 */
import { marked, Renderer } from "marked";

/** 内联样式表：口径偏口语种草文（15px 正文 / 1.75 行距）。 */
const S = {
  wrap: "font-size: 15px; color: #333333; line-height: 1.75; letter-spacing: 0.3px; word-break: break-word;",
  p: "margin: 12px 0; text-align: justify;",
  h2: "margin: 28px 0 12px; font-size: 18px; font-weight: bold; color: #1a1a1a; line-height: 1.5;",
  h3: "margin: 24px 0 10px; font-size: 16px; font-weight: bold; color: #1a1a1a; line-height: 1.5;",
  strong: "font-weight: bold; color: #212121;",
  blockquote:
    "margin: 16px 0; padding: 10px 14px; background: #f7f7f7; border-left: 3px solid #07c160; color: #666666; font-size: 14px;",
  li: "margin: 6px 0;",
  imgWrap: "margin: 18px 0; text-align: center;",
  img: "max-width: 100%; border-radius: 6px; vertical-align: middle;",
  caption: "margin: 6px 0 18px; text-align: center; color: #999999; font-size: 13px;",
  linkText: "color: #576b95;",
  hr: "margin: 20px 0; border: none; border-top: 1px solid #eeeeee;",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface MarkdownToHtmlOptions {
  /** markdown 中的图片引用（按原文 href 键）→ 上传后的微信图片 URL */
  imageUrlMap: Map<string, string>;
}

/** 把 article.md 的 markdown 转成公众号可用的内联样式 HTML 片段。 */
export function markdownToWechatHtml(markdown: string, options: MarkdownToHtmlOptions): string {
  const { imageUrlMap } = options;
  const renderer = new Renderer();

  // 图片：src 换成微信域名 URL，alt 保留图注（转义）
  renderer.image = (href: string, _title: string | null, text: string) => {
    const src = imageUrlMap.get(href) ?? href;
    return `<img src="${src}" alt="${escapeHtml(text)}" style="${S.img}" />`;
  };

  // 段落：整段仅一张图片 → 居中图片块 + 「图N：图注」小字（alt 已在 img 渲染时转义，直接复用）
  renderer.paragraph = (text: string) => {
    const only = text.match(/^<img\s[^>]*alt="([^"]*)"[^>]*\/?>$/);
    if (only) {
      const caption = only[1]?.trim() ?? "";
      const imgHtml = `<p style="${S.imgWrap}">${text}</p>`;
      return caption ? `${imgHtml}\n<p style="${S.caption}">${caption}</p>` : imgHtml;
    }
    return `<p style="${S.p}">${text}</p>`;
  };

  renderer.heading = (text: string, level: number) => {
    const [tag, style] = level <= 2 ? ["h2", S.h2] : ["h3", S.h3];
    return `<${tag} style="${style}">${text}</${tag}>`;
  };

  // 链接：渲染为带色纯文本（不带 <a>，规避未认证号正文外链限制）
  renderer.link = (_href: string, _title: string | null, text: string) =>
    `<span style="${S.linkText}">${text}</span>`;

  renderer.blockquote = (quote: string) => `<blockquote style="${S.blockquote}">${quote}</blockquote>`;
  renderer.listitem = (text: string) => `<li style="${S.li}">${text}</li>`;
  renderer.hr = () => `<hr style="${S.hr}" />`;
  renderer.strong = (text: string) => `<strong style="${S.strong}">${text}</strong>`;

  const html = marked.parse(markdown, { renderer, breaks: true }) as string;
  return `<section style="${S.wrap}">\n${html.trim()}\n</section>`;
}

/** 剥离首行一级标题（`# 标题`），避免与图文 title 重复出现在正文。 */
export function stripFirstHeading(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i < lines.length && /^#\s+/.test(lines[i])) {
    lines.splice(i, 1);
  }
  return lines.join("\n");
}

/** 提取纯文本摘要（去图片/标记/空白），截取前 maxLen 字符。 */
export function plainTextExcerpt(markdown: string, maxLen: number): string {
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // 图片占位
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接取文字
    .replace(/^[>#\s-]+/gm, "") // 行首标记
    .replace(/[*_`~]/g, "") // 强调 / 代码标记
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}
