import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Tests for file operation IPC handlers (fs:createFile, fs:createFolder, fs:rename, fs:delete).
 * These test the same fs logic used in main.js handlers against a real temp directory.
 */

let tmpDir: string;

// Replicate the handler logic from main.js for testability
function createFile(filePath: string): { success: boolean; error?: string } {
    try {
        if (fs.existsSync(filePath)) {
            return { success: false, error: 'File already exists' };
        }
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '', 'utf-8');
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

function createFolder(dirPath: string): { success: boolean; error?: string } {
    try {
        fs.mkdirSync(dirPath, { recursive: true });
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

function rename(oldPath: string, newPath: string): { success: boolean; error?: string } {
    try {
        fs.renameSync(oldPath, newPath);
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

function deleteItem(targetPath: string, isDir: boolean): { success: boolean; error?: string } {
    try {
        if (isDir) {
            fs.rmSync(targetPath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(targetPath);
        }
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-ops-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('fs:createFile', () => {
    it('creates an empty file in an existing directory', () => {
        const filePath = path.join(tmpDir, 'test.txt');
        const result = createFile(filePath);
        expect(result.success).toBe(true);
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('');
    });

    it('creates parent directories if they do not exist', () => {
        const filePath = path.join(tmpDir, 'a', 'b', 'deep.txt');
        const result = createFile(filePath);
        expect(result.success).toBe(true);
        expect(fs.existsSync(filePath)).toBe(true);
    });

    it('returns error if file already exists', () => {
        const filePath = path.join(tmpDir, 'existing.txt');
        fs.writeFileSync(filePath, 'content', 'utf-8');
        const result = createFile(filePath);
        expect(result.success).toBe(false);
        expect(result.error).toBe('File already exists');
    });
});

describe('fs:createFolder', () => {
    it('creates a new directory', () => {
        const dirPath = path.join(tmpDir, 'newdir');
        const result = createFolder(dirPath);
        expect(result.success).toBe(true);
        expect(fs.statSync(dirPath).isDirectory()).toBe(true);
    });

    it('creates nested directories recursively', () => {
        const dirPath = path.join(tmpDir, 'a', 'b', 'c');
        const result = createFolder(dirPath);
        expect(result.success).toBe(true);
        expect(fs.statSync(dirPath).isDirectory()).toBe(true);
    });

    it('succeeds even if directory already exists', () => {
        const dirPath = path.join(tmpDir, 'existing');
        fs.mkdirSync(dirPath);
        const result = createFolder(dirPath);
        expect(result.success).toBe(true);
    });
});

describe('fs:rename', () => {
    it('renames a file', () => {
        const oldPath = path.join(tmpDir, 'old.txt');
        const newPath = path.join(tmpDir, 'new.txt');
        fs.writeFileSync(oldPath, 'hello', 'utf-8');
        const result = rename(oldPath, newPath);
        expect(result.success).toBe(true);
        expect(fs.existsSync(oldPath)).toBe(false);
        expect(fs.existsSync(newPath)).toBe(true);
        expect(fs.readFileSync(newPath, 'utf-8')).toBe('hello');
    });

    it('renames a directory', () => {
        const oldPath = path.join(tmpDir, 'olddir');
        const newPath = path.join(tmpDir, 'newdir');
        fs.mkdirSync(oldPath);
        fs.writeFileSync(path.join(oldPath, 'file.txt'), 'data', 'utf-8');
        const result = rename(oldPath, newPath);
        expect(result.success).toBe(true);
        expect(fs.existsSync(oldPath)).toBe(false);
        expect(fs.existsSync(path.join(newPath, 'file.txt'))).toBe(true);
    });

    it('returns error when source does not exist', () => {
        const oldPath = path.join(tmpDir, 'nonexistent.txt');
        const newPath = path.join(tmpDir, 'new.txt');
        const result = rename(oldPath, newPath);
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });
});

describe('fs:delete', () => {
    it('deletes a file', () => {
        const filePath = path.join(tmpDir, 'todelete.txt');
        fs.writeFileSync(filePath, 'bye', 'utf-8');
        const result = deleteItem(filePath, false);
        expect(result.success).toBe(true);
        expect(fs.existsSync(filePath)).toBe(false);
    });

    it('deletes a directory recursively', () => {
        const dirPath = path.join(tmpDir, 'dirdelete');
        fs.mkdirSync(path.join(dirPath, 'sub'), { recursive: true });
        fs.writeFileSync(path.join(dirPath, 'sub', 'file.txt'), 'data', 'utf-8');
        const result = deleteItem(dirPath, true);
        expect(result.success).toBe(true);
        expect(fs.existsSync(dirPath)).toBe(false);
    });

    it('returns error when deleting a non-existent file', () => {
        const filePath = path.join(tmpDir, 'ghost.txt');
        const result = deleteItem(filePath, false);
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });

    it('succeeds when deleting a non-existent directory (force: true)', () => {
        const dirPath = path.join(tmpDir, 'ghostdir');
        const result = deleteItem(dirPath, true);
        // rmSync with force: true does not throw for non-existent paths
        expect(result.success).toBe(true);
    });
});
