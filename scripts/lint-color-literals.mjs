#!/usr/bin/env node

/**
 * lint-color-literals.mjs
 *
 * Scans packages/renderer/src/** and packages/ui/src/** for hardcoded color
 * literals that should use the Token system instead.
 *
 * Excludes:
 *   - node_modules
 *   - Files listed in scripts/color-literal-allowlist.json
 *
 * Exits with non-zero code if violations are found.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const ROOT = resolve(__dirname, '..');

// --- Configuration ---

const SCAN_DIRS = [
    join(ROOT, 'packages', 'renderer', 'src'),
    join(ROOT, 'packages', 'ui', 'src'),
];

const ALLOWLIST_PATH = join(ROOT, 'scripts', 'color-literal-allowlist.json');

// File extensions to scan
const SCAN_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.css', '.scss', '.less', '.svelte', '.vue', '.html',
]);

// Color literal patterns
const COLOR_PATTERNS = [
    /#[0-9a-fA-F]{3,8}\b/,
    /rgba?\(/,
    /hsla?\(/,
    /oklch\(/,
    /color\(/,
];

// --- Load allowlist ---

function loadAllowlist() {
    try {
        const raw = readFileSync(ALLOWLIST_PATH, 'utf-8');
        const list = JSON.parse(raw);
        // Normalize to absolute paths for comparison
        return new Set(list.map((f) => resolve(ROOT, f)));
    } catch {
        return new Set();
    }
}

// --- Recursive file collection ---

function collectFiles(dir) {
    const files = [];

    function walk(currentDir) {
        let entries;
        try {
            entries = readdirSync(currentDir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = join(currentDir, entry.name);

            // Skip node_modules
            if (entry.name === 'node_modules') continue;

            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile()) {
                const ext = extname(entry.name);
                if (SCAN_EXTENSIONS.has(ext)) {
                    files.push(fullPath);
                }
            }
        }
    }

    walk(dir);
    return files;
}

// --- Scan a single file for violations ---

function scanFile(filePath) {
    const violations = [];
    let content;

    try {
        content = readFileSync(filePath, 'utf-8');
    } catch {
        return violations;
    }

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of COLOR_PATTERNS) {
            if (pattern.test(line)) {
                violations.push({ file: filePath, line: i + 1, content: line.trim() });
                break; // One violation per line is enough
            }
        }
    }

    return violations;
}

// --- Main ---

function main() {
    const allowlist = loadAllowlist();
    const allViolations = [];

    for (const dir of SCAN_DIRS) {
        const files = collectFiles(dir);

        for (const file of files) {
            // Skip allowlisted files
            if (allowlist.has(file)) continue;

            const violations = scanFile(file);
            allViolations.push(...violations);
        }
    }

    if (allViolations.length > 0) {
        console.error(`\n❌ Found ${allViolations.length} color literal violation(s):\n`);

        for (const v of allViolations) {
            const relPath = relative(ROOT, v.file);
            console.error(`  ${relPath}:${v.line}`);
            console.error(`    ${v.content}\n`);
        }

        console.error(
            'Color literals must use Token system variables (--ftre-*).\n' +
            'If a file legitimately needs color literals, add it to scripts/color-literal-allowlist.json.\n'
        );

        process.exit(1);
    }

    console.log('✅ No color literal violations found.');
    process.exit(0);
}

main();
