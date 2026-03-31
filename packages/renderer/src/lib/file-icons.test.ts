import { describe, it, expect } from "vitest";
import {
    getFileIcon,
    EXTENSION_MAP,
    SPECIAL_FILE_MAP,
} from "./file-icons";
import {
    File,
    FileCode,
    FileJson,
    FileText,
    FileType,
    Folder,
    FolderOpen,
    GitBranch,
    Image,
    Package,
    Settings,
    Zap,
} from "lucide-react";

describe("getFileIcon — extension mapping", () => {
    it.each([
        ["app.ts", FileCode, "#3178c6"],
        ["App.tsx", FileCode, "#3178c6"],
        ["index.js", FileCode, "#f7df1e"],
        ["Component.jsx", FileCode, "#f7df1e"],
        ["data.json", FileJson, "#cbcb41"],
        ["styles.css", FileType, "#563d7c"],
        ["index.html", FileCode, "#e34c26"],
        ["README.md", FileText, "#519aba"],
        ["script.py", FileCode, "#3572A5"],
        ["photo.png", Image, "#a074c4"],
        ["photo.jpg", Image, "#a074c4"],
        ["logo.svg", Image, "#ffb13b"],
        [".gitignore", GitBranch, "#f05032"],
        [".env", Settings, "#ecd53f"],
    ])("returns correct icon for %s", (fileName, expectedIcon, expectedColor) => {
        const result = getFileIcon(fileName, false);
        expect(result.icon).toBe(expectedIcon);
        expect(result.color).toBe(expectedColor);
    });
});

describe("getFileIcon — special file names", () => {
    it("returns Package icon for package.json", () => {
        const result = getFileIcon("package.json", false);
        expect(result.icon).toBe(Package);
        expect(result.color).toBe("#cb3837");
    });

    it("returns Settings icon for tsconfig.json", () => {
        const result = getFileIcon("tsconfig.json", false);
        expect(result.icon).toBe(Settings);
        expect(result.color).toBe("#3178c6");
    });

    it("returns Zap icon for vite.config.ts", () => {
        const result = getFileIcon("vite.config.ts", false);
        expect(result.icon).toBe(Zap);
        expect(result.color).toBe("#646cff");
    });

    it("special file names take priority over extension mapping", () => {
        // package.json should match special map, not the .json extension map
        const result = getFileIcon("package.json", false);
        expect(result.icon).toBe(Package);
        expect(result.color).toBe("#cb3837");
    });
});

describe("getFileIcon — directories", () => {
    it("returns FolderOpen for expanded directory", () => {
        const result = getFileIcon("src", true, true);
        expect(result.icon).toBe(FolderOpen);
        expect(result.color).toBe("#dcb67a");
    });

    it("returns Folder for collapsed directory", () => {
        const result = getFileIcon("src", true, false);
        expect(result.icon).toBe(Folder);
        expect(result.color).toBe("#dcb67a");
    });

    it("returns Folder when isExpanded is undefined", () => {
        const result = getFileIcon("node_modules", true);
        expect(result.icon).toBe(Folder);
        expect(result.color).toBe("#dcb67a");
    });

    it("directory check takes priority over file name matching", () => {
        // Even if the dir name matches a special file, it should return folder icon
        const result = getFileIcon("package.json", true, false);
        expect(result.icon).toBe(Folder);
    });
});

describe("getFileIcon — default fallback", () => {
    it("returns default File icon for unknown extension", () => {
        const result = getFileIcon("data.xyz", false);
        expect(result.icon).toBe(File);
        expect(result.color).toBe("#9da5b4");
    });

    it("returns default File icon for file with no extension", () => {
        const result = getFileIcon("Makefile", false);
        expect(result.icon).toBe(File);
        expect(result.color).toBe("#9da5b4");
    });

    it("returns default File icon for empty filename", () => {
        const result = getFileIcon("", false);
        expect(result.icon).toBe(File);
        expect(result.color).toBe("#9da5b4");
    });
});

describe("getFileIcon — case insensitivity", () => {
    it("matches extensions case-insensitively", () => {
        const result = getFileIcon("App.TS", false);
        expect(result.icon).toBe(FileCode);
        expect(result.color).toBe("#3178c6");
    });

    it("matches special file names case-insensitively", () => {
        const result = getFileIcon("Package.JSON", false);
        expect(result.icon).toBe(Package);
        expect(result.color).toBe("#cb3837");
    });
});

describe("EXTENSION_MAP completeness", () => {
    it("covers all required file types from requirements", () => {
        const requiredExtensions = [
            "ts", "tsx", "js", "jsx", "json", "css", "html",
            "md", "py", "png", "jpg", "svg", "gitignore", "env",
        ];
        for (const ext of requiredExtensions) {
            expect(EXTENSION_MAP[ext]).toBeDefined();
        }
    });
});

describe("SPECIAL_FILE_MAP completeness", () => {
    it("covers all required special files from design", () => {
        const requiredFiles = [
            "package.json", "tsconfig.json", "vite.config.ts", ".gitignore",
        ];
        for (const file of requiredFiles) {
            expect(SPECIAL_FILE_MAP[file]).toBeDefined();
        }
    });
});
