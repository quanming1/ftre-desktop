import { useCallback, useEffect, useState } from "react";
import { Box } from "lucide-react";
import { Tooltip, TooltipProvider } from "@ftre/ui";
import { HttpLink, splitHttpUrls } from "@/components/HttpLink";
import { classifySkillOrigin, formatSkillName } from "@/lib/skill-display";
import { fetchSkill, type SkillDetail } from "@/services/api";
import { useInspector } from "@/stores/inspector";
import { useLayout } from "@/stores/layout";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";

export interface FtreExtensionRef {
  version: "v1";
  type: string;
  name: string;
  args: Record<string, string>;
  raw: string;
}

const FTRE_URI_RE = /^ftre:\/\/(v\d+)\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:\?([^\s)]*))?$/i;
const FTRE_TOKEN_RE = /!\[ftre:([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\]\(ftre:\/\/(v\d+)\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:\?([^()\s]*))?\)/gi;
const FTRE_URI_TOKEN_RE = /ftre:\/\/(v\d+)\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\?[^\s)]+)?/gi;

export function parseFtreUri(src: string, alt = ""): FtreExtensionRef | null {
  const match = FTRE_URI_RE.exec(src);
  if (!match || match[1].toLowerCase() !== "v1") return null;
  const type = match[2].toLowerCase();
  if (alt && alt.toLowerCase() !== `ftre:${type}`) return null;
  const args: Record<string, string> = {};
  if (match[4]) {
    for (const [key, value] of new URLSearchParams(match[4])) {
      if (key) args[key] = value;
    }
  }
  return {
    version: "v1",
    type,
    name: match[3].toLowerCase(),
    args,
    raw: `![ftre:${type}](${src})`,
  };
}

export function serializeFtreRef(ref: Omit<FtreExtensionRef, "raw">): string {
  const query = new URLSearchParams(
    Object.entries(ref.args).sort(([a], [b]) => a.localeCompare(b)),
  ).toString();
  return `![ftre:${ref.type}](ftre://${ref.version}/${ref.type}/${ref.name}${query ? `?${query}` : ""})`;
}

export function parseFtreTokens(text: string): Array<{ text: string; ref?: FtreExtensionRef }> {
  type Match = { index: number; raw: string; ref: FtreExtensionRef | null };
  const matches: Match[] = [];
  for (const match of text.matchAll(FTRE_TOKEN_RE)) {
    const raw = match[0];
    const open = raw.indexOf("(");
    const src = raw.slice(open + 1, -1);
    matches.push({
      index: match.index ?? 0,
      raw,
      ref: parseFtreUri(src, `ftre:${match[1]}`),
    });
  }
  // 允许从消息或文档直接复制裸 ftre:// URI。Markdown token 内部的 URI
  // 会与外层 token 重叠，下面按起点排序后由 cursor 自动跳过。
  for (const match of text.matchAll(FTRE_URI_TOKEN_RE)) {
    matches.push({
      index: match.index ?? 0,
      raw: match[0],
      ref: parseFtreUri(match[0]),
    });
  }
  matches.sort((a, b) => a.index - b.index || b.raw.length - a.raw.length);

  const result: Array<{ text: string; ref?: FtreExtensionRef }> = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index < cursor) continue;
    if (match.index > cursor) result.push({ text: text.slice(cursor, match.index) });
    result.push(match.ref ? { text: match.raw, ref: match.ref } : { text: match.raw });
    cursor = match.index + match.raw.length;
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor) });
  return result.length > 0 ? result : [{ text }];
}

export function hasFtreToken(text: string): boolean {
  return parseFtreTokens(text).some((part) => Boolean(part.ref));
}

const skillDetails = new Map<string, SkillDetail>();
const skillDetailRequests = new Map<string, Promise<SkillDetail | null>>();

function currentSkillContext(): { agentId: string; workspace: string | null } {
  const chat = useChat.getState?.() ?? {};
  const sessions = useSession.getState?.() ?? { sessions: [], allSessions: [] };
  const current = [...sessions.sessions, ...sessions.allSessions].find(
    (session) => session.session_id === chat.sessionId,
  );
  return {
    agentId: current?.agent_id || chat.agentId || "default",
    workspace: current ? current.workspace || null : chat.pendingWorkspace || null,
  };
}

function skillCacheKey(name: string, agentId: string, workspace: string | null): string {
  return `${name}\0${agentId}\0${workspace || ""}`;
}

async function loadSkillDetail(
  name: string,
  agentId: string,
  workspace: string | null,
): Promise<SkillDetail | null> {
  const key = skillCacheKey(name, agentId, workspace);
  const cached = skillDetails.get(key);
  if (cached) return cached;

  const pending = skillDetailRequests.get(key);
  if (pending) return pending;

  const request = fetchSkill(name, agentId, workspace)
    .then((result) => {
      if (!("skill" in result)) return null;
      skillDetails.set(key, result.skill);
      return result.skill;
    })
    .catch(() => null)
    .finally(() => skillDetailRequests.delete(key));
  skillDetailRequests.set(key, request);
  return request;
}

export function SkillReferenceCard({
  ref,
  offsetTop = false,
  descriptionFallback,
}: {
  ref: FtreExtensionRef;
  offsetTop?: boolean;
  descriptionFallback?: string;
}) {
  const context = currentSkillContext();
  const cacheKey = skillCacheKey(ref.name, context.agentId, context.workspace);
  const displayName = formatSkillName(ref.name);
  const [detail, setDetail] = useState<SkillDetail | null>(() => skillDetails.get(cacheKey) ?? null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const args = Object.entries(ref.args);

  useEffect(() => {
    setDetail(skillDetails.get(cacheKey) ?? null);
    setLoadError(false);
  }, [cacheKey]);

  const ensureDetail = useCallback(async () => {
    const cached = skillDetails.get(cacheKey);
    if (cached) {
      if (detail !== cached) setDetail(cached);
      return cached;
    }
    if (loading) return loadSkillDetail(ref.name, context.agentId, context.workspace);
    setLoading(true);
    setLoadError(false);
    const next = await loadSkillDetail(ref.name, context.agentId, context.workspace);
    setDetail(next);
    setLoadError(!next);
    setLoading(false);
    return next;
  }, [cacheKey, context.agentId, context.workspace, detail, loading, ref.name]);

  const handleOpen = useCallback(async () => {
    const loaded = await ensureDetail();
    if (!loaded) return;
    const filesystemPath = loaded.source?.kind === "filesystem" && loaded.capabilities?.browse !== false
      ? loaded.source.path
      : "";
    const filePath = filesystemPath || `${loaded.uri || `ftre://v1/skill/${ref.name}`}/SKILL.md`;
    const previewId = filesystemPath ? `skill:${filesystemPath}` : `skill:${loaded.uri || ref.name}`;
    useInspector.getState().openFilePreview(
      previewId,
      filePath,
      "SKILL.md",
      undefined,
      undefined,
      loaded.content,
    );
    if (!useLayout.getState().panelVisible.inspector) {
      useLayout.getState().togglePanelVisible("inspector");
    }
  }, [ensureDetail, ref.name]);

  const origin = classifySkillOrigin({
    origin: detail?.origin,
    scope: detail?.scope,
    route: detail?.route,
    sourcePath: detail?.source?.kind === "filesystem" ? detail.source.path : undefined,
    workspace: context.workspace,
  });
  const tooltipDescription = detail?.description || descriptionFallback || ref.args.note || "点击打开 SKILL.md";
  const skillRoute = detail?.uri || `ftre://v1/skill/${ref.name}`;
  const skillCommand = serializeFtreRef({
    version: ref.version,
    type: ref.type,
    name: ref.name,
    args: ref.args,
  });
  const filesystemRoute = detail?.source?.kind === "filesystem" ? detail.source.path : null;

  return (
    <span className={`mx-0.5 inline-flex max-w-full flex-col align-baseline ${offsetTop ? "relative -top-px" : ""}`}>
      <TooltipProvider>
        <Tooltip
          content={
            <span className="flex max-w-[320px] flex-col gap-1">
              <span className="font-semibold text-emerald-400">
                {formatSkillName(detail?.name || ref.name)}
              </span>
              <span className="leading-relaxed text-[12px] text-t-secondary">
                {loading ? "正在加载 Skill 信息…" : loadError ? "无法加载 Skill 信息" : tooltipDescription}
              </span>
              <span className="text-[11px] leading-relaxed text-t-ghost">
                Command <code className="break-all font-mono text-t-secondary">{skillCommand}</code>
              </span>
              <span className="break-all text-[11px] leading-relaxed text-t-ghost">
                Route <code className="font-mono text-t-secondary">{skillRoute}</code>
              </span>
              {filesystemRoute && (
                <span className="break-all text-[11px] leading-relaxed text-t-ghost">
                  Path <code className="font-mono text-t-secondary">{filesystemRoute}</code>
                </span>
              )}
              {args.length > 0 && (
                <span className="text-[11px] text-t-ghost">
                  {args.map(([key, value]) => `${key}=${value}`).join(" · ")}
                </span>
              )}
              <span className="self-start rounded-full bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                {origin.label}
              </span>
            </span>
          }
          side="top"
          sideOffset={5}
          className="max-w-[340px]"
        >
          <button
            type="button"
            aria-label={`打开 Skill：${displayName}`}
            title={ref.name}
            data-skill-origin={origin.kind}
            onClick={() => void handleOpen()}
            onPointerEnter={() => void ensureDetail()}
            onFocus={() => void ensureDetail()}
            className="group inline-flex max-w-full items-baseline gap-1 bg-transparent p-0 text-[13px] font-bold leading-[inherit] text-emerald-700 transition-colors hover:text-emerald-800 hover:underline hover:underline-offset-2 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            <Box size={12} className="relative top-px shrink-0" aria-hidden="true" />
            <span className="truncate">{displayName}</span>
          </button>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

export function renderFtreInlineText(text: string, options?: { offsetTop?: boolean }) {
  return parseFtreTokens(text).flatMap((part, index) => {
    if (part.ref) {
      return [<SkillReferenceCard key={index} ref={part.ref} offsetTop={options?.offsetTop} />];
    }
    return splitHttpUrls(part.text).map((piece, pieceIndex) =>
      piece.href ? (
        <HttpLink key={`${index}-${pieceIndex}`} href={piece.href}>
          {piece.text}
        </HttpLink>
      ) : (
        <span key={`${index}-${pieceIndex}`}>{piece.text}</span>
      ),
    );
  });
}

export function FtreExtensionImage({
  src,
  alt,
  ...props
}: React.ComponentPropsWithoutRef<"img">) {
  const ref = parseFtreUri(src || "", alt || "");
  if (ref) return <SkillReferenceCard ref={ref} />;
  if (src?.toLowerCase().startsWith("ftre://")) {
    return <span className="text-t-dim">{alt || "不支持的扩展"}</span>;
  }
  return <img src={src} alt={alt} {...props} />;
}
