#!/usr/bin/env node
/**
 * publish MCP server
 *
 * 内容发布服务（当前覆盖微信公众号）：
 * - wechat_check_config：校验 AppID / AppSecret / IP 白名单是否可用
 * - wechat_publish_draft：上传封面与正文图片、markdown 转内联样式 HTML、创建图文草稿
 *
 * 「发表」动作始终由用户在 mp.weixin.qq.com 后台手动完成（个人订阅号无 API 发布权限）。
 * 小红书不走本 server，由 publish agent 复用 playwright MCP 做浏览器预填。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  WechatApiError,
  addDraft,
  checkConfig,
  getCredentials,
  missingCredentialsMessage,
  uploadContentImage,
  uploadCoverMaterial,
} from "./wechat-client.js";
import { markdownToWechatHtml, plainTextExcerpt, stripFirstHeading } from "./md-to-html.js";

/** 正文 HTML 长度上限（公众号图文 content 约 2 万字符）。 */
const CONTENT_MAX_LENGTH = 20_000;

/** 权限类错误码：失败时提示可回退半自动打包。 */
const FALLBACK_ERRCODES = [45009, 48001, 48002, 48004, 48006];

/** 统一错误输出：中文信息 + 权限类错误附回退提示。 */
function errorResult(
  error: unknown,
  context?: string,
): { isError: true; content: Array<{ type: "text"; text: string }> } {
  let msg = error instanceof Error ? error.message : String(error);
  if (error instanceof WechatApiError && FALLBACK_ERRCODES.includes(error.errcode)) {
    msg += "\n可回退半自动打包流程（publish agent 的 fallback 路径）。";
  }
  const text = context ? `${context}：${msg}` : msg;
  return { isError: true, content: [{ type: "text", text }] };
}

const server = new McpServer({
  name: "publish-mcp-server",
  version: "0.1.0",
});

/* ---------- 工具 1：wechat_check_config（诊断，只读） ---------- */

server.registerTool(
  "wechat_check_config",
  {
    title: "校验公众号配置",
    description: `校验公众号凭证（WECHAT_APP_ID / WECHAT_APP_SECRET）与 IP 白名单是否可用，返回 { ok, message }。
无参数。凭证缺失时返回配置指引而非报错退出。`,
    inputSchema: z.object({}).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    try {
      const result = await checkConfig();
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      return errorResult(error);
    }
  },
);

/* ---------- 工具 2：wechat_publish_draft（一键建草稿） ---------- */

const WechatPublishDraftSchema = z
  .object({
    articlePath: z
      .string()
      .min(1, "articlePath 不能为空")
      .describe("article.md 的绝对路径（图片引用相对其所在目录，如 images/01-cover.png）"),
    imagesDir: z.string().min(1, "imagesDir 不能为空").describe("配图目录的绝对路径（含 01-cover.png 封面）"),
    title: z.string().min(1, "title 不能为空").max(64).describe("公众号图文标题（1–64 字）"),
    author: z.string().max(8).optional().describe("作者名（可选，最长 8 字）"),
    digest: z.string().max(120).optional().describe("摘要（可选，最长 120 字；缺省自动截取正文开头）"),
  })
  .strict();

/** 把 markdown 里的图片引用解析成本地绝对路径（相对 article.md 所在目录或 imagesDir）。 */
function resolveImagePath(href: string, articlePath: string, imagesDir: string): string {
  if (path.isAbsolute(href)) return path.normalize(href);
  const byArticle = path.resolve(path.dirname(articlePath), href);
  if (existsSync(byArticle)) return byArticle;
  const byImagesDir = path.resolve(imagesDir, href);
  if (existsSync(byImagesDir)) return byImagesDir;
  return path.resolve(imagesDir, path.basename(href));
}

server.registerTool(
  "wechat_publish_draft",
  {
    title: "创建公众号图文草稿",
    description: `一键创建微信公众号图文草稿：读取 article.md → 上传封面（add_material，得 thumb_media_id）
→ 上传全部正文图（uploadimg，得微信域名 URL）→ markdown 转公众号内联样式 HTML → draft/add 建草稿。
成功返回草稿 media_id；「发表」仍需用户到 mp.weixin.qq.com 草稿箱手动点击。

Args:
  - articlePath (string, 必填): article.md 的绝对路径
  - imagesDir (string, 必填): 配图目录绝对路径（01-cover.png 为封面）
  - title (string, 必填): 图文标题，1–64 字
  - author (string, 可选): 作者名，最长 8 字
  - digest (string, 可选): 摘要，最长 120 字，缺省自动截取

Returns:
  JSON: { success, draftMediaId, coverMediaId, uploadedImages, contentLength, notice }；
  失败时返回 isError=true 与中文错误说明（含配置指引 / 回退提示）`,
    inputSchema: WechatPublishDraftSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params) => {
    try {
      if (!getCredentials()) throw new Error(missingCredentialsMessage());

      const articlePath = path.resolve(params.articlePath);
      const imagesDir = path.resolve(params.imagesDir);
      if (!existsSync(articlePath)) throw new Error(`article.md 不存在：${articlePath}`);
      if (!existsSync(imagesDir)) throw new Error(`图片目录不存在：${imagesDir}`);

      const markdown = await readFile(articlePath, "utf-8");

      // 1. 提取全部图片引用（按出现顺序去重），解析为本地绝对路径并校验存在
      const imgRe = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
      const hrefs: string[] = [];
      for (const m of markdown.matchAll(imgRe)) {
        if (!hrefs.includes(m[1])) hrefs.push(m[1]);
      }
      if (hrefs.length === 0) {
        throw new Error("article.md 中未找到图片占位（![...](...)），无法确定封面。");
      }
      const localPaths = new Map<string, string>();
      for (const href of hrefs) {
        const resolved = resolveImagePath(href, articlePath, imagesDir);
        if (!existsSync(resolved)) {
          throw new Error(`图片文件不存在：${href} → ${resolved}（请核对 articlePath / imagesDir）`);
        }
        localPaths.set(href, resolved);
      }

      // 2. 封面：优先 01-cover.*，否则取第一张图
      const coverHref = hrefs.find((h) => /^01-cover\./i.test(path.basename(h))) ?? hrefs[0];

      // 3. 上传：封面走永久素材（thumb），全部正文图（含封面图本身）走 uploadimg 换微信域名 URL
      const thumbMediaId = await uploadCoverMaterial(localPaths.get(coverHref)!);
      const imageUrlMap = new Map<string, string>();
      for (const href of hrefs) {
        imageUrlMap.set(href, await uploadContentImage(localPaths.get(href)!));
      }

      // 4. markdown → 公众号内联样式 HTML（剥离一级标题；图片用微信 URL）
      const body = stripFirstHeading(markdown);
      const contentHtml = markdownToWechatHtml(body, { imageUrlMap });
      if (contentHtml.length > CONTENT_MAX_LENGTH) {
        throw new Error(`正文 HTML 长度 ${contentHtml.length} 超过公众号上限约 ${CONTENT_MAX_LENGTH} 字符，请精简后重试。`);
      }

      // 5. 创建草稿（digest 缺省自动截取正文前 120 字）
      const digest = params.digest?.trim() || plainTextExcerpt(body, 120);
      const draftMediaId = await addDraft({
        title: params.title.trim(),
        content: contentHtml,
        thumb_media_id: thumbMediaId,
        ...(params.author?.trim() ? { author: params.author.trim() } : {}),
        ...(digest ? { digest } : {}),
      });

      const output = {
        success: true,
        draftMediaId,
        coverMediaId: thumbMediaId,
        coverImage: coverHref,
        uploadedImages: hrefs.map((href) => ({ file: path.basename(href), url: imageUrlMap.get(href) })),
        contentLength: contentHtml.length,
        notice: "草稿已创建（≠已发表）。请登录 mp.weixin.qq.com → 草稿箱，核对排版与图片后手动点击「发表」。",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      return errorResult(error, "创建公众号草稿失败");
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("publish MCP server 已启动（stdio）");
}

main().catch((error) => {
  console.error("服务器启动失败：", error);
  process.exit(1);
});
