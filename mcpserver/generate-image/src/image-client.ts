/**
 * OpenAI 兼容的图片生成 API 客户端。
 *
 * 通过 POST {BASE_URL}/images/generations 调用，同时兼容返回 url 或 b64_json 的后端。
 */

export interface GenerateImageParams {
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
  n?: number;
  /** 是否添加 AI 水印；与 watermarkParam 配合使用，仅在后端支持该参数时生效 */
  watermark?: boolean;
  /** 后端使用的水印参数名（如智谱 watermark_enabled）；为空则不发送 */
  watermarkParam?: string;
}

export interface ImageResult {
  /** 远程图片地址（与 b64 二选一） */
  url?: string;
  /** Base64 编码的图片数据（与 url 二选一） */
  b64?: string;
  /** 水印参数被后端拒绝、已去掉该参数重试成功时为 true */
  watermarkParamDropped?: boolean;
}

interface ImagesResponse {
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { message?: string };
}

/** HTTP 请求失败（携带状态码与响应文本，便于调用方判断是否可回退重试）。 */
export class ImageApiError extends Error {
  constructor(
    readonly status: number,
    readonly bodyText: string,
  ) {
    super(`图片 API 请求失败（HTTP ${status}）：${bodyText.slice(0, 300)}`);
    this.name = "ImageApiError";
  }

  /** 错误信息是否疑似「不认识某请求参数」（用于换了不支持水印参数的后端时自动回退）。 */
  looksLikeUnknownParam(paramName: string): boolean {
    const text = this.bodyText.toLowerCase();
    return (
      text.includes(paramName.toLowerCase()) ||
      text.includes("unknown") ||
      text.includes("unrecognized") ||
      text.includes("invalid") ||
      text.includes("not supported") ||
      text.includes("unexpected")
    );
  }
}

export class ImageClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly defaultModel: string,
    private readonly defaultSize: string,
    private readonly timeoutMs: number,
  ) {}

  /** 调用图片生成接口，返回图片来源（url 或 b64）。 */
  async generate(params: GenerateImageParams): Promise<ImageResult> {
    const watermarkField =
      params.watermark !== undefined && params.watermarkParam
        ? { [params.watermarkParam]: params.watermark }
        : undefined;

    try {
      return await this.request(params, watermarkField);
    } catch (error) {
      // 后端不认识水印参数（换厂商时常见）→ 去掉该参数重试一次，不因此失败
      if (
        watermarkField &&
        error instanceof ImageApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        params.watermarkParam &&
        error.looksLikeUnknownParam(params.watermarkParam)
      ) {
        const result = await this.request(params, undefined);
        return { ...result, watermarkParamDropped: true };
      }
      throw error;
    }
  }

  /** 发起一次请求；watermarkField 为要附加的水印参数（可选）。 */
  private async request(
    params: GenerateImageParams,
    watermarkField?: Record<string, boolean>,
  ): Promise<ImageResult> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/images/generations`;
    const body = {
      model: params.model ?? this.defaultModel,
      prompt: params.prompt,
      n: params.n ?? 1,
      ...(params.size ? { size: params.size } : {}),
      ...(params.quality ? { quality: params.quality } : {}),
      ...(watermarkField ?? {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      let json: ImagesResponse;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`图片 API 返回非 JSON 响应（HTTP ${res.status}）：${text.slice(0, 200)}`);
      }

      if (!res.ok) {
        throw new ImageApiError(res.status, json.error?.message ?? text);
      }

      const item = json.data?.[0];
      if (!item) {
        throw new Error("图片 API 未返回任何数据（data 为空）");
      }
      if (!item.url && !item.b64_json) {
        throw new Error("图片 API 返回的数据项不含 url 或 b64_json");
      }
      return { url: item.url, b64: item.b64_json };
    } finally {
      clearTimeout(timer);
    }
  }
}
