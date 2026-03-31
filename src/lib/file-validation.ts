/** 非法字符正则：/ \ : * ? " < > | */
export const ILLEGAL_CHARS_REGEX = /[/\\:*?"<>|]/;

export interface ValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * 验证文件名是否合法
 * @param name - 待验证的文件名
 * @param siblingNames - 同目录下已有的文件/文件夹名称列表
 * @returns 验证结果
 */
export function validateFileName(name: string, siblingNames: string[]): ValidationResult {
    // 空白字符检查：空字符串或仅包含空白字符
    if (!name || name.trim().length === 0) {
        return { valid: false, error: '文件名不能为空或仅包含空格。' };
    }

    // 非法字符检查
    if (ILLEGAL_CHARS_REGEX.test(name)) {
        return { valid: false, error: '文件名包含非法字符（/ \\ : * ? " < > |）。' };
    }

    // 同级重名检查（不区分大小写）
    const lowerName = name.toLowerCase();
    if (siblingNames.some((s) => s.toLowerCase() === lowerName)) {
        return { valid: false, error: '已存在同名的文件或文件夹。' };
    }

    return { valid: true };
}
