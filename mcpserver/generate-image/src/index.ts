#!/usr/bin/env node
/**
 * generate-image MCP server
 *
 * 通用 OpenAI 兼容图片生成服务，通过环境变量配置后端（API Key / Base URL / Model）。
 * 工具：
 *  - generate_image：按提示词生成图片并保存到指定本地路径（可选请求无水印）。
 *  - crop_image：按百分比裁剪本地图片四边（常用于去除边缘水印，与生图厂商无关）。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import sharp from "sharp";
import { ImageClient } from "./image-client.js";
import { decodeBase64Image, downloadImage, saveBuffer } from "./storage.js";

/** 读取必需环境变量，缺失则报错退出。 */
function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`错误：缺少必需的环境变量 ${name}`);
    process.exit(1);
  }
  return v;
}

const apiKey = requiredEnv("IMAGE_GEN_API_KEY");
const baseUrl = process.env.IMAGE_GEN_BASE_URL ?? "https://api.openai.com/v1";
const defaultModel = process.env.IMAGE_GEN_MODEL ?? "dall-e-3";
const defaultSize = process.env.IMAGE_GEN_SIZE ?? "1024x1024";
const timeoutMs = Number(process.env.IMAGE_GEN_TIMEOUT_MS ?? "120000");
/** 后端水印参数名（默认 watermark_enabled 适配智谱）；设为空字符串则完全不发送（适配不支持该参数的厂商）。 */
const watermarkParam = process.env.IMAGE_GEN_WATERMARK_PARAM ?? "watermark_enabled";

const client = new ImageClient(apiKey, baseUrl, defaultModel, defaultSize, timeoutMs);

const server = new McpServer({
  name: "generate-image-mcp-server",
  version: "0.2.0",
});

server.registerTool(
  "generate_image",
  {
    title: "生成图片",
    description: `调用 OpenAI 兼容的图片生成 API 生成一张图片，并保存到指定的本地路径。

Args:
  - prompt (string, 必填): 图片生成提示词
  - outputPath (string, 必填): 保存图片的绝对路径（含文件名），自动创建父目录
  - size (string, 可选): 图片尺寸，默认 ${defaultSize}
  - model (string, 可选): 模型名，默认 ${defaultModel}
  - quality (string, 可选): 图片质量
  - watermark (boolean, 可选): 是否添加 AI 水印，传 false 请求无水印图（仅当后端支持水印参数时生效，当前参数名：${watermarkParam || "未启用"}；后端不认识该参数时自动去掉重试，不影响生成）

Returns:
  JSON: { "success": true, "path": "<保存路径>" }；后端拒绝水印参数时会附加 "watermarkParamDropped": true；失败时返回 isError=true 与错误说明`,
    inputSchema: z
      .object({
        prompt: z.string().min(1, "prompt 不能为空").describe("图片生成提示词（尽量具体描述画面、风格、构图）"),
        outputPath: z
          .string()
          .min(1, "outputPath 不能为空")
          .describe("保存图片的绝对路径（含文件名，如 .../images/01-cover.png），自动创建父目录"),
        size: z.string().optional().describe(`图片尺寸，如 1024x1024 / 1792x1024，默认 ${defaultSize}`),
        model: z.string().optional().describe(`模型名，默认 ${defaultModel}`),
        quality: z.string().optional().describe("图片质量，如 standard / hd（部分模型支持）"),
        watermark: z
          .boolean()
          .optional()
          .describe(`是否添加 AI 水印；false 请求无水印（仅当后端支持水印参数时生效，当前参数名：${watermarkParam || "未启用"}）`),
      })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params) => {
    try {
      const result = await client.generate({
        prompt: params.prompt,
        model: params.model,
        size: params.size,
        quality: params.quality,
        watermark: params.watermark,
        watermarkParam,
      });

      let buffer: Buffer;
      if (result.b64) {
        buffer = decodeBase64Image(result.b64);
      } else if (result.url) {
        buffer = await downloadImage(result.url, timeoutMs);
      } else {
        throw new Error("未获取到可用的图片数据");
      }

      await saveBuffer(params.outputPath, buffer);

      const output = {
        success: true,
        path: params.outputPath,
        ...(result.watermarkParamDropped ? { watermarkParamDropped: true } : {}),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text", text: `生成图片失败：${msg}` }],
      };
    }
  },
);

server.registerTool(
  "crop_image",
  {
    title: "裁剪图片",
    description: `按百分比裁剪本地图片的四边（纯本地处理，与生图厂商无关；常用于去除图片边缘的水印）。

Args:
  - inputPath (string, 必填): 待裁剪图片的绝对路径
  - outputPath (string, 可选): 结果保存路径（含文件名），缺省原地覆盖
  - top / right / bottom / left (number, 可选): 各边裁剪百分比 0–15，默认 0

Returns:
  JSON: { "success": true, "path": "<保存路径>", "width": 裁剪后宽, "height": 裁剪后高 }；失败时返回 isError=true 与错误说明`,
    inputSchema: z
      .object({
        inputPath: z.string().min(1, "inputPath 不能为空").describe("待裁剪图片的绝对路径"),
        outputPath: z.string().optional().describe("裁剪结果保存路径（含文件名），缺省原地覆盖"),
        top: z.number().min(0).max(15).optional().describe("上边裁剪百分比 0–15，默认 0"),
        right: z.number().min(0).max(15).optional().describe("右边裁剪百分比 0–15，默认 0"),
        bottom: z.number().min(0).max(15).optional().describe("下边裁剪百分比 0–15，默认 0"),
        left: z.number().min(0).max(15).optional().describe("左边裁剪百分比 0–15，默认 0"),
      })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const inputAbs = params.inputPath;
      const outputAbs = params.outputPath ?? params.inputPath;

      const meta = await sharp(inputAbs).metadata();
      if (!meta.width || !meta.height) {
        throw new Error("无法读取图片尺寸");
      }

      const left = Math.round((meta.width * (params.left ?? 0)) / 100);
      const top = Math.round((meta.height * (params.top ?? 0)) / 100);
      const width = meta.width - left - Math.round((meta.width * (params.right ?? 0)) / 100);
      const height = meta.height - top - Math.round((meta.height * (params.bottom ?? 0)) / 100);
      if (width < 1 || height < 1) {
        throw new Error(`裁剪比例过大：裁剪后仅剩 ${width}x${height}（原图 ${meta.width}x${meta.height}）`);
      }

      // 输出格式跟随 outputPath 扩展名；未指定 outputPath 时保持原格式（png 无损，jpeg 高质量重编码）
      const ext = outputAbs.toLowerCase().split(".").pop() ?? "";
      let buffer: Buffer;
      const pipeline = sharp(inputAbs).extract({ left, top, width, height });
      if (ext === "jpg" || ext === "jpeg") {
        buffer = await pipeline.jpeg({ quality: 95 }).toBuffer();
      } else if (ext === "webp") {
        buffer = await pipeline.webp().toBuffer();
      } else {
        buffer = await pipeline.png().toBuffer();
      }

      await saveBuffer(outputAbs, buffer);

      const output = { success: true, path: outputAbs, width, height };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text", text: `裁剪图片失败：${msg}` }],
      };
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("generate-image MCP server 已启动（stdio）");
}

main().catch((error) => {
  console.error("服务器启动失败：", error);
  process.exit(1);
});
