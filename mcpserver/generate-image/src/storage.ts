/**
 * 图片存储与下载工具。
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

/**
 * 将 Buffer 写入指定路径，自动创建父目录。
 * @param outputPath 目标文件绝对路径（含文件名）
 * @param data 图片二进制数据
 */
export async function saveBuffer(outputPath: string, data: Buffer): Promise<void> {
  const abs = path.resolve(outputPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
}

/** 将 Base64 字符串解码为 Buffer。 */
export function decodeBase64Image(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}

/** 下载远程图片为 Buffer。 */
export async function downloadImage(url: string, timeoutMs: number): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`下载图片失败：HTTP ${res.status} ${res.statusText}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
}
