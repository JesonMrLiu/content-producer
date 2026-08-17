/**
 * 微信公众号 API 客户端。
 *
 * 覆盖「自动创建图文草稿」链路所需的最小接口集：
 * - 获取 access_token（内存缓存，提前 5 分钟刷新）
 * - 上传永久图片素材（封面缩略图，返回 thumb_media_id）
 * - 上传图文消息内的图片（正文插图，返回微信域名 URL）
 * - 新增图文草稿（draft/add）
 *
 * 凭证通过环境变量 WECHAT_APP_ID / WECHAT_APP_SECRET 提供；
 * 调用方需在公众号后台「设置与开发 → 基本配置」把出口 IP 加入白名单。
 * 「发表」动作不在本客户端范围内——个人订阅号无 API 发布权限，由用户在后台手动完成。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const API_BASE = "https://api.weixin.qq.com";

/** token 有效期 7200s，提前 300s 视为过期，避免边界失败。 */
const TOKEN_TTL_BUFFER_MS = 300_000;

/** 常见微信错误码 → 中文处置提示。 */
const ERROR_HINTS: Record<number, string> = {
  40013: "AppID 不正确，请核对 WECHAT_APP_ID",
  40125: "AppSecret 不正确，请到公众号后台「设置与开发 → 基本配置」重置后更新 WECHAT_APP_SECRET",
  40164:
    "本机出口 IP 不在公众号 IP 白名单内：请到 mp.weixin.qq.com「设置与开发 → 基本配置 → IP 白名单」添加错误信息中提示的 IP",
  41004: "缺少 AppSecret，请配置 WECHAT_APP_SECRET",
  45009: "接口调用次数超限，请明天再试",
  48001: "api 功能未授权：个人订阅号的草稿权限可能被平台收紧，可回退半自动打包流程",
  48002: "api 功能被禁用：请到公众号后台「设置与开发 → 接口权限」确认草稿箱接口已开通，或回退半自动打包流程",
};

export class WechatApiError extends Error {
  constructor(
    public readonly errcode: number,
    public readonly errmsg: string,
  ) {
    const hint = ERROR_HINTS[errcode] ? `（${ERROR_HINTS[errcode]}）` : "";
    super(`微信 API 错误 ${errcode}：${errmsg}${hint}`);
    this.name = "WechatApiError";
  }
}

/** 读取并校验公众号凭证；缺失返回 null（由调用方给出配置指引）。 */
export function getCredentials(): { appId: string; appSecret: string } | null {
  const appId = process.env.WECHAT_APP_ID?.trim();
  const appSecret = process.env.WECHAT_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

/** 凭证缺失时的中文配置指引。 */
export function missingCredentialsMessage(): string {
  return [
    "缺少公众号凭证：WECHAT_APP_ID / WECHAT_APP_SECRET 未配置。",
    "配置方式（二选一）：",
    "1. 在系统环境变量中设置 WECHAT_APP_ID、WECHAT_APP_SECRET；",
    "2. 直接填写 plugin/.claude-plugin/plugin.json 中 mcpServers.publish.env 的两个值。",
    "凭证获取：mp.weixin.qq.com → 设置与开发 → 基本配置（AppID / AppSecret），并把本机出口 IP 加入 IP 白名单。",
    "公众号暂不可用时可回退半自动打包流程。",
  ].join("\n");
}

/* ---------- access_token ---------- */

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;
let inflight: Promise<string> | null = null;

async function fetchAccessToken(): Promise<string> {
  const cred = getCredentials();
  if (!cred) throw new Error(missingCredentialsMessage());

  const url =
    `${API_BASE}/cgi-bin/token?grant_type=client_credential` +
    `&appid=${encodeURIComponent(cred.appId)}&secret=${encodeURIComponent(cred.appSecret)}`;

  const json = (await fetchJson(url)) as {
    access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };
  if (json.errcode) throw new WechatApiError(json.errcode, json.errmsg ?? "");
  if (!json.access_token) throw new Error("微信 token 接口未返回 access_token");

  const ttlMs = (json.expires_in ?? 7200) * 1000 - TOKEN_TTL_BUFFER_MS;
  tokenCache = { token: json.access_token, expiresAt: Date.now() + Math.max(ttlMs, 60_000) };
  return json.access_token;
}

/** 获取 access_token（内存缓存；forceRefresh 用于 40001/42001 后强制刷新）。 */
export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  if (!forceRefresh && inflight) return inflight;
  const task = fetchAccessToken().finally(() => {
    inflight = null;
  });
  if (!forceRefresh) inflight = task;
  return task;
}

/** 诊断：校验凭证与 IP 白名单是否可用。 */
export async function checkConfig(): Promise<{ ok: boolean; message: string }> {
  if (!getCredentials()) return { ok: false, message: missingCredentialsMessage() };
  tokenCache = null; // 诊断时强制重新获取，暴露白名单/凭证问题
  try {
    await getAccessToken(true);
    return { ok: true, message: "公众号凭证有效，access_token 获取成功（IP 白名单配置正常）。" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/* ---------- 通用请求 ---------- */

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`微信 API 返回非 JSON 响应（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
}

/** 携带 access_token 调用 JSON 接口；token 失效（40001/42001）自动刷新重试一次。 */
async function callApi(
  apiPath: string,
  options: { method?: string; jsonBody?: unknown } = {},
): Promise<Record<string, unknown>> {
  const doCall = async (token: string): Promise<Record<string, unknown>> => {
    const url = `${API_BASE}${apiPath}${apiPath.includes("?") ? "&" : "?"}access_token=${token}`;
    return (await fetchJson(url, {
      method: options.method ?? "GET",
      ...(options.jsonBody !== undefined
        ? { body: JSON.stringify(options.jsonBody), headers: { "Content-Type": "application/json" } }
        : {}),
    })) as Record<string, unknown>;
  };

  let json = await doCall(await getAccessToken());
  const errcode = json.errcode;
  if (errcode === 40001 || errcode === 42001) {
    json = await doCall(await getAccessToken(true));
  }
  if (typeof json.errcode === "number" && json.errcode !== 0) {
    throw new WechatApiError(json.errcode as number, String(json.errmsg ?? ""));
  }
  return json;
}

/* ---------- 素材上传 ---------- */

function mimeOf(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  return "image/png";
}

/** 构建上传用 multipart 表单（Node 18 原生 FormData / Blob）。 */
async function buildUploadForm(file: string): Promise<FormData> {
  const data = await readFile(file);
  const form = new FormData();
  form.append("media", new Blob([data], { type: mimeOf(file) }), path.basename(file));
  return form;
}

/** 上传永久图片素材（用作图文封面），返回 thumb_media_id。 */
export async function uploadCoverMaterial(imagePath: string): Promise<string> {
  const token = await getAccessToken();
  const url = `${API_BASE}/cgi-bin/material/add_material?access_token=${token}&type=image`;
  const json = (await fetchJson(url, { method: "POST", body: await buildUploadForm(imagePath) })) as {
    media_id?: string;
    errcode?: number;
    errmsg?: string;
  };
  if (json.errcode) throw new WechatApiError(json.errcode, json.errmsg ?? "");
  if (!json.media_id) throw new Error(`上传封面素材未返回 media_id：${JSON.stringify(json).slice(0, 300)}`);
  return json.media_id;
}

/** 上传图文消息内的正文图片，返回微信域名 URL（mmbiz.qpic.cn，外链图片会被公众号过滤）。 */
export async function uploadContentImage(imagePath: string): Promise<string> {
  const token = await getAccessToken();
  const url = `${API_BASE}/cgi-bin/media/uploadimg?access_token=${token}`;
  const json = (await fetchJson(url, { method: "POST", body: await buildUploadForm(imagePath) })) as {
    url?: string;
    errcode?: number;
    errmsg?: string;
  };
  if (json.errcode) throw new WechatApiError(json.errcode, json.errmsg ?? "");
  if (!json.url) throw new Error(`上传正文图片未返回 url：${JSON.stringify(json).slice(0, 300)}`);
  return json.url;
}

/* ---------- 草稿 ---------- */

export interface DraftArticle {
  title: string;
  content: string;
  thumb_media_id: string;
  author?: string;
  digest?: string;
}

/** 新增图文草稿，返回草稿 media_id。发表仍需用户在公众号后台手动完成。 */
export async function addDraft(article: DraftArticle): Promise<string> {
  const json = (await callApi("/cgi-bin/draft/add", {
    method: "POST",
    jsonBody: { articles: [article] },
  })) as { media_id?: string };
  if (!json.media_id) throw new Error(`创建草稿未返回 media_id：${JSON.stringify(json).slice(0, 300)}`);
  return json.media_id;
}
