/**
 * 图片附件处理工具
 *
 * 把 File / Blob 转成 ImageRef（base64 + 元数据），
 * 同时执行白名单 / 大小校验。
 *
 * 校验失败抛 ImageValidationError，调用方负责 toast 提示。
 */
import type { ImageRef } from "./types";
import {
    IMAGE_MAX_BYTES,
    IMAGE_MIME_WHITELIST,
} from "./ChatInputEditor";

export class ImageValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ImageValidationError";
    }
}

let _imgIdC = 0;
const nextImageId = () => `img_${Date.now()}_${++_imgIdC}`;

function formatMb(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(2);
}

/**
 * 读取 File 为 base64（不带 data: 前缀）。
 * 同时把 mimeType 限定为白名单。
 */
export async function fileToImageRef(
    file: File | Blob,
    fallbackName?: string,
): Promise<ImageRef> {
    const mime = file.type || "";
    if (!IMAGE_MIME_WHITELIST.includes(mime)) {
        throw new ImageValidationError(
            `不支持的图片格式: ${mime || "未知"}（仅支持 png / jpeg / webp / gif）`,
        );
    }
    if (file.size > IMAGE_MAX_BYTES) {
        throw new ImageValidationError(
            `图片大小 ${formatMb(file.size)}MB 超过上限 ${formatMb(IMAGE_MAX_BYTES)}MB`,
        );
    }

    const base64 = await readAsBase64(file);
    const name = (file as File).name || fallbackName || `image.${mimeToExt(mime)}`;

    return {
        id: nextImageId(),
        mimeType: mime,
        base64,
        name,
        bytes: file.size,
    };
}

function readAsBase64(file: File | Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.onload = () => {
            const result = reader.result;
            if (typeof result !== "string") {
                reject(new Error("读取结果非字符串"));
                return;
            }
            // result 形如 "data:image/png;base64,xxxx"
            const idx = result.indexOf(",");
            resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        reader.readAsDataURL(file);
    });
}

function mimeToExt(mime: string): string {
    switch (mime) {
        case "image/png":
            return "png";
        case "image/jpeg":
            return "jpg";
        case "image/webp":
            return "webp";
        case "image/gif":
            return "gif";
        default:
            return "bin";
    }
}

/** 从 DataTransfer 提取所有图片 File（drag / paste 通用） */
export function extractImageFiles(dt: DataTransfer | null): File[] {
    if (!dt) return [];
    const out: File[] = [];

    // items 优先（粘贴时通常用这个，files 里可能没有）
    if (dt.items && dt.items.length > 0) {
        for (const it of Array.from(dt.items)) {
            if (it.kind !== "file") continue;
            const f = it.getAsFile();
            if (f && f.type.startsWith("image/")) out.push(f);
        }
    }

    // files 兜底（拖拽时主要走这个）
    if (out.length === 0 && dt.files && dt.files.length > 0) {
        for (const f of Array.from(dt.files)) {
            if (f.type.startsWith("image/")) out.push(f);
        }
    }

    return out;
}
