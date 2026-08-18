/**
 * FileRenderer — 文件预览渲染器
 *
 * 优先使用 content 快照（来自 read 工具 metadata），
 * 无快照时从磁盘读取。filePreviewCache 缓存已加载文件，切回时秒切。
 * 轮询校验 mtime，文件被外部修改时自动清除缓存并重载。
 * 使用 @jiang_quan_ming/react-code-diff 的 preview 模式展示文件内容。
 * md / html 文件额外支持「渲染预览」：markdown 走共享渲染管线（MarkdownPreview），
 * html 走 sandbox iframe（HtmlPreview），默认打开即渲染视图，工具栏按钮可切回源码。
 * git 已跟踪且有未暂存修改（M）的文件，工具栏显示「暂存区 Diff」按钮：
 * 点击新开一个 DiffTab（before = 暂存区版本 git show :path，after = 当前工作区内容）。
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { BookOpen, Code2, GitCompareArrows, Loader2, WrapText } from "lucide-react";
import { CodeDiff } from "@jiang_quan_ming/react-code-diff";
import { useInspector } from "@/stores/inspector";
import { filePreviewCache } from "../filePreviewCache";
import { MarkdownPreview } from "./MarkdownPreview";
import { HtmlPreview } from "./HtmlPreview";
import { PreviewHeader, PreviewToolbarButton } from "./PreviewHeader";
import { codeDiffLightConfig } from "./codeDiffConfig";
import type { TabRendererProps } from "../tabRegistry";
import type { FileTab } from "@/stores/inspector";

function detectLanguage(filePath: string): string {
  const ext = filePath.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    py: "python", json: "json", md: "markdown", markdown: "markdown",
    go: "go", rs: "rust",
    java: "java", c: "c", cpp: "cpp", sh: "bash", yml: "yaml", yaml: "yaml",
    html: "html", htm: "html", css: "css", xml: "xml", sql: "sql", toml: "toml",
  };
  return map[ext] ?? ext ?? "plaintext";
}

/** 支持「渲染预览」的语言：markdown 渲染为富文本，html 走 sandbox iframe */
const RENDERABLE_LANGUAGES = new Set(["markdown", "html"]);

interface LoadedFile {
  content: string;
  language: string;
}

export function FileRenderer({ tab, active, wordWrap }: TabRendererProps) {
  const { filePath, content, revealNonce } = tab as FileTab;
  const displayPath = filePath.replace(/\\/g, "/");

  // 有 content 快照时直接使用，不走磁盘读取和缓存
  const snapshotFile = useMemo<LoadedFile | null>(() => {
    if (content == null) return null;
    return { content, language: detectLanguage(filePath) };
  }, [content, filePath]);

  // mtime 失效后，放弃 snapshot 从磁盘重载（解决 read 快照过期问题）
  const [snapshotInvalidated, setSnapshotInvalidated] = useState(false);
  const effectiveSnapshot = snapshotInvalidated ? null : snapshotFile;

  // 非 snapshot 场景下，invalidation 后 effectiveSnapshot 不变（null→null），
  // load effect 不会重跑。用 reloadNonce 强制重跑。
  const [reloadNonce, setReloadNonce] = useState(0);

  const [file, setFile] = useState<LoadedFile | null>(() => {
    if (effectiveSnapshot) return effectiveSnapshot;
    const cached = filePreviewCache.get(filePath);
    if (cached) {
      return { content: cached.content, language: cached.language };
    }
    return null;
  });
  const [loading, setLoading] = useState(
    effectiveSnapshot == null && !filePreviewCache.has(filePath),
  );
  const [error, setError] = useState<string | null>(null);

  // ── 渲染预览（md / html）─────────────────────────────────────────
  // rendered：当前展示的视图（源码 / 渲染）；md / html 默认渲染视图
  // renderOpened：keep-alive 标记——渲染视图挂载后不卸载，
  //   源码 / 渲染用 CSS hidden 切换显示，避免反复解析 markdown / 重建 iframe。
  // userChoseMode：用户手动切换过后，后续文件重载不再覆盖其选择。
  const [rendered, setRendered] = useState(false);
  const [renderOpened, setRenderOpened] = useState(false);
  const [userChoseMode, setUserChoseMode] = useState(false);

  const renderable = file != null && RENDERABLE_LANGUAGES.has(file.language);

  const toggleRendered = useCallback(() => {
    setUserChoseMode(true);
    setRenderOpened(true);
    setRendered((prev) => !prev);
  }, []);

  // ── 暂存区 Diff（git 已跟踪且有未暂存修改 M 的文件）──────────────
  // 按文件自身路径查询其所在仓库（indexDiff IPC），不依赖工作区级
  // gitService 缓存——预览的文件可能位于任意仓库，工作区根目录甚至不是
  // git 仓库。available=true 表示工作区与暂存区有真实差异（Y 列为 M）；
  // 仅已暂存的修改（"M "）工作区与暂存区一致，无 diff 可看。
  // 按钮点击后新开一个 DiffTab（openDiffPreview），不在本预览 tab 内嵌。
  const [diffAvailable, setDiffAvailable] = useState(false);

  // 查询时机：挂载 / 换文件 / 文件重载（mtime 失效）/ tab 重新激活
  // （切走再切回可捕获外部的 stage / 还原操作）。查询失败视为不可用。
  // 注意：preload 与 renderer 可能短暂版本撕裂（dev 下主进程不随 HMR 重启），
  // indexDiff 不存在或抛错时静默降级为无按钮，不产生 unhandled rejection。
  useEffect(() => {
    if (!active) return;
    if (typeof window.desktop.git?.indexDiff !== "function") return;
    let cancelled = false;
    (async () => {
      try {
        const result = await window.desktop.git.indexDiff(filePath);
        if (!cancelled) {
          setDiffAvailable(!result.error && result.available === true);
        }
      } catch {
        if (!cancelled) setDiffAvailable(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filePath, active, reloadNonce, revealNonce]);

  // 点击时重新查询一次拿新鲜暂存区内容（与按钮显示的查询解耦），
  // 然后新开 DiffTab：before = 暂存区版本，after = 当前预览内容。
  const openIndexDiff = useCallback(async () => {
    if (typeof window.desktop.git?.indexDiff !== "function") return;
    try {
      const result = await window.desktop.git.indexDiff(filePath);
      if (result.error || !result.available) return;
      const name = displayPath.split("/").pop() ?? displayPath;
      useInspector.getState().openDiffPreview(
        `gitdiff-${displayPath}`,
        filePath,
        result.staged ?? "",
        file?.content ?? "",
        0,
        0,
        name,
      );
    } catch {
      // 查询失败静默：按钮本身不可见，点不到这里
    }
  }, [filePath, file?.content, displayPath]);

  const loadFile = useCallback(async (path: string) => {
    // 先查缓存，但校验 mtime 防止脏读
    const cached = filePreviewCache.get(path);
    if (cached) {
      try {
        const stat = await window.desktop.fs.stat(path);
        if (stat.mtime !== null && stat.mtime === cached.mtime) {
          // mtime 一致，使用缓存
          setFile({ content: cached.content, language: cached.language });
          setLoading(false);
          setError(null);
          return;
        }
        // mtime 不一致，清除缓存继续从磁盘读取
        filePreviewCache.delete(path);
      } catch {
        filePreviewCache.delete(path);
      }
    }
    setLoading(true);
    setError(null);
    try {
      const result = await window.desktop.fs.readFile(path);
      if (result.error) {
        setError(result.error);
      } else {
        const lang = result.language || detectLanguage(path);
        // 读取 mtime 存入缓存
        const stat = await window.desktop.fs.stat(path);
        filePreviewCache.set(path, {
          content: result.content ?? "",
          language: lang,
          mtime: stat.mtime ?? 0,
        });
        setFile({ content: result.content ?? "", language: lang });
      }
    } catch (e) {
      setError(`无法读取文件: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载文件：effectiveSnapshot 优先，否则从磁盘读
  useEffect(() => {
    if (effectiveSnapshot) {
      setFile(effectiveSnapshot);
      setLoading(false);
      setError(null);
    } else {
      loadFile(filePath);
    }
  }, [filePath, loadFile, effectiveSnapshot, revealNonce, reloadNonce]);

  // snapshot 文件注册到 filePreviewCache，使 mtime 轮询能检测到外部修改
  // 没有 this，snapshot 文件不在缓存中，轮询不会监控它，onInvalidate 永远不触发
  useEffect(() => {
    if (!effectiveSnapshot) return;
    let cancelled = false;
    (async () => {
      try {
        const stat = await window.desktop.fs.stat(filePath);
        if (!cancelled && !filePreviewCache.has(filePath)) {
          filePreviewCache.set(filePath, {
            content: effectiveSnapshot.content,
            language: effectiveSnapshot.language,
            mtime: stat.mtime ?? 0,
          });
        }
      } catch {
        // stat 失败（文件不存在等），无法监控
      }
    })();
    return () => { cancelled = true; };
  }, [effectiveSnapshot, filePath]);

  // 监听缓存失效（mtime 变化），触发重载
  useEffect(() => {
    const unsubscribe = filePreviewCache.onInvalidate((changedPath) => {
      if (changedPath === filePath) {
        // 文件被外部修改（含 edit 工具），放弃 snapshot 并强制从磁盘重载
        setSnapshotInvalidated(true);
        setReloadNonce((n) => n + 1);
      }
    });
    return unsubscribe;
  }, [filePath]);

  // filePath 变化时重置 invalidation 标记
  useEffect(() => {
    setSnapshotInvalidated(false);
  }, [filePath]);

  // filePath 变化时重置渲染预览状态（同一 tab 复用打开不同文件，新文件重新走默认渲染）
  useEffect(() => {
    setRendered(false);
    setRenderOpened(false);
    setUserChoseMode(false);
    setDiffAvailable(false);
  }, [filePath]);

  // md / html 默认进入渲染视图（声明在上方重置 effect 之后，保证重置先执行）；
  // 用户手动切换过后（userChoseMode）文件内容重载不再覆盖其选择
  useEffect(() => {
    if (renderable && !userChoseMode) {
      setRendered(true);
      setRenderOpened(true);
    }
  }, [filePath, renderable, userChoseMode]);

  return (
    <div className="flex flex-col h-full bg-surface relative p-2 gap-2">
      {/* 文件信息（与 diff 预览共用矮版 header，见 PreviewHeader） */}
      <PreviewHeader
        fileName={filePath}
        right={
          <>
            {/* 暂存区 Diff（仅 git 已跟踪且有未暂存修改的文件，点击新开 DiffTab） */}
            {diffAvailable && (
              <PreviewToolbarButton title="查看与暂存区的差异" onClick={openIndexDiff}>
                <GitCompareArrows size={14} />
              </PreviewToolbarButton>
            )}
            {/* 渲染预览切换（仅 md / html） */}
            {renderable && (
              <PreviewToolbarButton
                title={rendered ? "查看源码" : "预览渲染结果"}
                onClick={toggleRendered}
                active={rendered}
              >
                {rendered ? <Code2 size={14} /> : <BookOpen size={14} />}
              </PreviewToolbarButton>
            )}
            {/* 换行切换 */}
            <PreviewToolbarButton
              title={wordWrap ? "关闭自动换行" : "开启自动换行"}
              onClick={() => useInspector.getState().toggleWordWrap()}
              active={wordWrap}
            >
              {wordWrap ? <WrapText size={14} /> : <WrapText size={14} className="opacity-40" />}
            </PreviewToolbarButton>
          </>
        }
      />

      {/* 内容预览：源码 / 渲染 双视图切换 */}
      <div className="flex-1 min-h-0 bg-surface">
        {file ? (
          <>
            {/* 源码视图（rendered 状态下隐藏但保持挂载，切回无需重新高亮） */}
            <div className={rendered && renderable ? "hidden" : "h-full"}>
              <CodeDiff
                oldValue=""
                newValue={file.content}
                language={file.language}
                fileName={displayPath}
                viewMode="preview"
                theme="light"
                config={codeDiffLightConfig}
                showToolbar={false}
                wrapLines={wordWrap}
                style={{ height: "100%" }}
              />
            </div>
            {/* 渲染视图：首次切换才挂载；markdown keep-alive（隐藏切换），
                html iframe 仅在展示时挂载，避免后台持续执行脚本 */}
            {renderable && renderOpened && (
              <div className={rendered ? "h-full" : "hidden"}>
                {file.language === "markdown" ? (
                  <MarkdownPreview content={file.content} />
                ) : rendered ? (
                  <HtmlPreview content={file.content} title={displayPath} />
                ) : null}
              </div>
            )}
          </>
        ) : (
          <div className="h-full flex items-center justify-center">
            {loading && <Loader2 size={16} className="animate-spin text-t-ghost" />}
          </div>
        )}
      </div>

      {/* 错误遮罩 */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface/80 z-10 p-4">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}
    </div>
  );
}
