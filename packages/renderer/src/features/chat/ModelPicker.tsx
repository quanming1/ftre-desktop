/**
 * ModelPicker — 通用模型选择下拉
 *
 * 从 ModelSelector 抽出来的下拉面板组件。供 ModelSelector（聊天输入栏切换主模型）
 * 和 ModelSettings 里的"标题生成模型"选择器复用，保持视觉/交互一致。
 *
 * 由调用方提供：
 * - providers          已经从 config 解析好的可用模型分组
 * - selected           当前选中的 provider + modelId（可空）
 * - onSelect           用户挑选某个模型时回调
 * - renderTrigger      触发按钮渲染（通常是 ModelSelector 的胶囊或表单中的 select 风格按钮）
 * - extraTopOption     可选的特殊项，渲染在搜索框下、模型列表上方（如"沿用主对话模型"）
 * - onOpenSettings     "打开设置"按钮点击；不传则不渲染底栏快捷入口
 * - placement          下拉浮层方向，默认向下展开（top 时向上展开）
 * - panelWidthClass    覆盖下拉面板宽度（默认 w-[280px]）
 */

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Pin, Search, Settings2 } from "lucide-react";
import { ModelBadges } from "./ModelBadges";
import type { ModelItem } from "@/services/api";

// ─────────────────────────────────────────────────────────────
// Pin 模型存储（纯前端，localStorage）
// ─────────────────────────────────────────────────────────────
const PINNED_MODELS_KEY = "ftre:pinned-models";
const HOVER_MENU_EVENT = "ftre:chat-hover-menu";
const HOVER_CLOSE_DELAY_MS = 80;

interface PinnedModelKey {
  provider: string;
  modelId: string;
}

function getPinnedModels(): PinnedModelKey[] {
  try {
    const raw = localStorage.getItem(PINNED_MODELS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PinnedModelKey[];
  } catch {
    return [];
  }
}

function setPinnedModels(pins: PinnedModelKey[]): void {
  try {
    localStorage.setItem(PINNED_MODELS_KEY, JSON.stringify(pins));
  } catch {
    // ignore
  }
}

function togglePin(provider: string, modelId: string): boolean {
  const pins = getPinnedModels();
  const idx = pins.findIndex(
    (p) => p.provider === provider && p.modelId === modelId,
  );
  const wasPinned = idx !== -1;
  if (wasPinned) {
    pins.splice(idx, 1);
  } else {
    pins.push({ provider, modelId });
  }
  setPinnedModels(pins);
  return !wasPinned; // 返回新的 pinned 状态
}

function isPinned(provider: string, modelId: string): boolean {
  return getPinnedModels().some(
    (p) => p.provider === provider && p.modelId === modelId,
  );
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export interface ProviderInfo {
  name: string;
  label: string;
  models: ModelItem[];
}

export interface ModelPickerSelection {
  provider: string;
  modelId: string;
}

export interface ModelPickerExtraOption {
  /** 唯一 key */
  key: string;
  /** 显示文案 */
  label: string;
  /** 是否选中（高亮 + Check） */
  selected: boolean;
  /** 点击回调 */
  onSelect: () => void | Promise<void>;
}

export interface ModelPickerProps {
  providers: ProviderInfo[];
  selected: ModelPickerSelection | null;
  onSelect: (provider: string, modelId: string) => void | Promise<void>;
  renderTrigger: (props: {
    open: boolean;
    toggle: () => void;
  }) => ReactNode;
  extraTopOption?: ModelPickerExtraOption;
  onOpenSettings?: () => void;
  placement?: "top" | "bottom" | "right";
  /** Hover 型触发器：鼠标进入触发器或子面板时打开，离开整个区域后关闭。 */
  openOnHover?: boolean;
  /** 同一组 hover 菜单的互斥 key。 */
  hoverMenuKey?: string;
  /** 仅对聊天输入框启用：首次打开只显示 Pin 模型，搜索或点击“更多”后展示全量。 */
  pinnedOnlyByDefault?: boolean;
  panelWidthClass?: string;
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────
const itemBaseClass =
  "w-full px-3 py-1 text-left text-[13px] flex items-center gap-2 rounded-lg transition-all duration-150";
const itemNormalClass =
  "text-t-secondary hover:text-t-primary hover:bg-hover active:bg-active active:text-t-primary";
const itemSelectedClass =
  "text-[#1a1a1a] bg-[#e2e2e3]";
const itemFocusedClass =
  "bg-[var(--ftre-hover,#e8e8ea)] text-t-primary";

function getItemStateClass(
  isSelected: boolean,
  isFocused: boolean,
  hasKeyboardFocus: boolean,
): string {
  // 一旦进入键盘导航，选中态只保留 Check，Active 背景只给当前 focus 项。
  if (isFocused) return itemFocusedClass;
  if (isSelected && !hasKeyboardFocus) return itemSelectedClass;
  return itemNormalClass;
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export function ModelPicker({
  providers,
  selected,
  onSelect,
  renderTrigger,
  extraTopOption,
  onOpenSettings,
  placement = "top",
  openOnHover = false,
  hoverMenuKey = "model",
  pinnedOnlyByDefault = false,
  panelWidthClass = "w-[320px]",
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [focusIndex, setFocusIndex] = useState(-1);
  const [showAllModels, setShowAllModels] = useState(!pinnedOnlyByDefault);
  const [floatingPosition, setFloatingPosition] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const floatingPanelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);
  const clearHoverClose = useCallback(() => {
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }, []);
  const scheduleHoverClose = useCallback(() => {
    if (!openOnHover) return;
    clearHoverClose();
    hoverCloseTimerRef.current = setTimeout(() => {
      setOpen(false);
      hoverCloseTimerRef.current = null;
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearHoverClose, openOnHover]);
  const handleMouseEnter = useCallback(() => {
    if (!openOnHover) return;
    window.dispatchEvent(new CustomEvent(HOVER_MENU_EVENT, { detail: hoverMenuKey }));
    clearHoverClose();
    setOpen(true);
  }, [clearHoverClose, hoverMenuKey, openOnHover]);

  useEffect(() => {
    if (!openOnHover) return;
    const handleOtherHoverMenu = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      if (key === hoverMenuKey) return;
      clearHoverClose();
      setOpen(false);
    };
    window.addEventListener(HOVER_MENU_EVENT, handleOtherHoverMenu);
    return () => window.removeEventListener(HOVER_MENU_EVENT, handleOtherHoverMenu);
  }, [clearHoverClose, hoverMenuKey, openOnHover]);

  const updateFloatingPosition = useCallback(() => {
    const trigger = panelRef.current;
    if (!trigger || typeof window === "undefined") return;
    const rect = trigger.getBoundingClientRect();
    const panel = floatingPanelRef.current;
    const panelWidth = panel?.offsetWidth || 300;
    const panelHeight = panel?.offsetHeight || Math.min(420, Math.max(160, window.innerHeight - 16));
    const viewportPadding = 8;
    const gap = 4;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding);
    const maxTop = Math.max(viewportPadding, window.innerHeight - panelHeight - viewportPadding);
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

    let left: number;
    let top: number;

    if (placement === "right") {
      const rightCandidate = rect.right + gap;
      const leftCandidate = rect.left - panelWidth - gap;
      left = rightCandidate + panelWidth <= window.innerWidth - viewportPadding
        ? rightCandidate
        : leftCandidate >= viewportPadding
          ? leftCandidate
          : clamp(rightCandidate, viewportPadding, maxLeft);
      top = clamp(rect.top, viewportPadding, maxTop);
    } else {
      left = clamp(rect.left, viewportPadding, maxLeft);
      const belowCandidate = rect.bottom + gap;
      const aboveCandidate = rect.top - panelHeight - gap;
      if (placement === "bottom") {
        top = belowCandidate + panelHeight <= window.innerHeight - viewportPadding
          ? belowCandidate
          : aboveCandidate >= viewportPadding
            ? aboveCandidate
            : clamp(belowCandidate, viewportPadding, maxTop);
      } else {
        top = aboveCandidate >= viewportPadding
          ? aboveCandidate
          : belowCandidate + panelHeight <= window.innerHeight - viewportPadding
            ? belowCandidate
            : clamp(aboveCandidate, viewportPadding, maxTop);
      }
    }

    const nextPosition = {
      left: Math.round(left),
      top: Math.round(top),
      maxHeight: Math.max(80, window.innerHeight - viewportPadding * 2),
    };
    setFloatingPosition((current) => (
      current &&
      current.left === nextPosition.left &&
      current.top === nextPosition.top &&
      current.maxHeight === nextPosition.maxHeight
        ? current
        : nextPosition
    ));
  }, [placement]);

  // Portal 首次挂载后重新测量真实尺寸，修正首帧的估算位置，避免高菜单被视口裁掉。
  useLayoutEffect(() => {
    if (open) updateFloatingPosition();
  }, [open, floatingPosition, updateFloatingPosition]);

  useEffect(() => {
    if (!open) {
      setFloatingPosition(null);
      return;
    }
    updateFloatingPosition();
    const handleViewportChange = () => updateFloatingPosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, updateFloatingPosition]);

  useEffect(() => () => clearHoverClose(), [clearHoverClose]);

  // Pin 模型列表（响应 localStorage 变化需要强制刷新）
  const [pinVersion, forceUpdate] = useState(0);
  const pinnedModels = useMemo(() => {
    if (providers.length === 0) return [];
    const pins = getPinnedModels();
    const result: { provider: ProviderInfo; model: ModelItem }[] = [];

    for (const pin of pins) {
      const p = providers.find((pr) => pr.name === pin.provider);
      if (!p) continue;
      const m = p.models.find((mm) => mm.id === pin.modelId);
      if (!m) continue;
      result.push({ provider: p, model: m });
    }
    return result;
    // pinVersion 变化时重新计算（togglePin 后 forceUpdate 触发）
  }, [providers, pinVersion]);

  useEffect(() => {
    if (open) {
      setSearch("");
      setShowAllModels(!pinnedOnlyByDefault);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [open, pinnedOnlyByDefault]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        !floatingPanelRef.current?.contains(target)
      ) {
        close();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  const handleSelect = async (providerName: string, modelId: string) => {
    close();
    await onSelect(providerName, modelId);
  };

  const handleTogglePin = (e: React.MouseEvent, providerName: string, modelId: string) => {
    e.preventDefault();
    e.stopPropagation();
    togglePin(providerName, modelId);
    forceUpdate((n) => n + 1);
  };

  const handleExtraSelect = async () => {
    if (!extraTopOption) return;
    close();
    await extraTopOption.onSelect();
  };

  const isPinnedModel = useCallback(
    (providerName: string, modelId: string) => pinnedModels.some(
      ({ provider, model }) => provider.name === providerName && model.id === modelId,
    ),
    [pinnedModels],
  );

  // 扁平可选项列表，用于键盘导航。每项包含 provider/modelId 和 select 回调。
  const flatItems = useMemo(() => {
    const items: { key: string; label: string; onSelect: () => void }[] = [];
    if (extraTopOption) {
      items.push({
        key: extraTopOption.key,
        label: extraTopOption.label,
        onSelect: handleExtraSelect,
      });
    }
    if (!search.trim()) {
      for (const { provider, model } of pinnedModels) {
        items.push({
          key: `pin:${provider.name}:${model.id}`,
          label: `${model.name || model.id} (${provider.label})`,
          onSelect: () => handleSelect(provider.name, model.id),
        });
      }
    }
    if (!pinnedOnlyByDefault || showAllModels || search.trim()) {
      for (const provider of providers) {
        for (const model of provider.models) {
          // Pin 区已经展示过的模型不在全量区重复渲染；搜索时只展示搜索结果。
          if (!search.trim() && isPinnedModel(provider.name, model.id)) continue;
          if (search.trim()) {
            const q = search.toLowerCase();
            if (!model.name.toLowerCase().includes(q) && !model.id.toLowerCase().includes(q)) continue;
          }
          items.push({
            key: `${provider.name}:${model.id}`,
            label: `${model.name || model.id} (${provider.label})`,
            onSelect: () => handleSelect(provider.name, model.id),
          });
        }
      }
    }
    return items;
  }, [extraTopOption, pinnedModels, providers, search, pinnedOnlyByDefault, showAllModels, isPinnedModel, handleSelect, handleExtraSelect]);

  // 搜索变化时重置焦点到第一项（仅 search 变化，不因 pin 导致的长度变化而重置/滚动）
  useEffect(() => {
    // 打开/筛选后不预选第一项；只有用户按上下键才出现键盘 Active。
    setFocusIndex(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, showAllModels]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { close(); return; }
    if (flatItems.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIndex((prev) => Math.min(prev + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && focusIndex >= 0) {
      e.preventDefault();
      flatItems[focusIndex]?.onSelect();
    }
  }, [flatItems, focusIndex, close]);

  // 滚动聚焦项到可视区域（仅键盘导航 focusIndex 变化时触发，避免 pin 等重渲染导致跳动）
  const flatItemsRef = useRef(flatItems);
  flatItemsRef.current = flatItems;
  useEffect(() => {
    if (focusIndex < 0 || !listRef.current) return;
    const target = listRef.current.querySelector(`[data-model-key="${flatItemsRef.current[focusIndex]?.key}"]`);
    (target as HTMLElement)?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  const isFocused = (key: string) => flatItems.findIndex((i) => i.key === key) === focusIndex;
  const hasKeyboardFocus = focusIndex >= 0;

  const floatingPanelStyle: CSSProperties = {
    position: "fixed",
    left: floatingPosition?.left,
    top: floatingPosition?.top,
    maxHeight: floatingPosition?.maxHeight,
  };

  const floatingPanel = open && floatingPosition ? (
    <div
      ref={floatingPanelRef}
      style={floatingPanelStyle}
      data-ftre-floating-menu="model-picker"
      onMouseEnter={openOnHover ? clearHoverClose : undefined}
      onMouseLeave={openOnHover ? scheduleHoverClose : undefined}
      className={`fixed ${panelWidthClass} z-[9999] flex flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-[0_12px_30px_rgba(15,23,42,0.14)]`}
    >
      {/* 搜索框 */}
      <div className="flex items-center gap-1.5 p-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ftre-text-ghost,#666)]"
          />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(e) => {
              const value = e.target.value;
              setSearch(value);
              if (pinnedOnlyByDefault) setShowAllModels(Boolean(value.trim()));
            }}
            placeholder="搜索模型..."
            className="h-8 w-full rounded-lg border border-border-subtle bg-surface pl-8 pr-3 text-[13px] text-t-primary outline-none transition-colors placeholder:text-t-ghost focus:border-accent"
            onKeyDown={handleKeyDown}
          />
        </div>
        {onOpenSettings && (
          <button
            type="button"
            aria-label="管理模型"
            title="管理模型"
            onClick={() => {
              close();
              onOpenSettings();
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ftre-text-ghost,#666)] transition-colors hover:bg-[var(--ftre-hover,#e8e8ea)] hover:text-[var(--ftre-text-primary,#e8e8e8)]"
          >
            <Settings2 size={14} />
          </button>
        )}
      </div>

      {providers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6">
          <div className="text-center text-[13px] text-[var(--ftre-text-muted,#999)]">
            未找到已配置的模型
          </div>
        </div>
      ) : (
        <div ref={listRef} className="max-h-[420px] overflow-y-auto py-1">
          {/* 顶部特殊项（如“沿用主对话模型”），不参与搜索过滤 */}
          {extraTopOption && (
            <div className="mb-1 px-1.5">
              <button
                onClick={() => void handleExtraSelect()}
                data-model-key={extraTopOption.key}
                className={`${itemBaseClass} ${getItemStateClass(extraTopOption.selected, isFocused(extraTopOption.key), hasKeyboardFocus)}`}
              >
                <span className="min-w-0 flex-1 truncate">{extraTopOption.label}</span>
                {extraTopOption.selected && <Check size={14} className="shrink-0" />}
              </button>
            </div>
          )}

           {!search.trim() && pinnedModels.length > 0 && (
            <div className="mb-1">
              <div className="flex items-center gap-1.5 px-4 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-wider text-[var(--ftre-text-ghost,#666)]">
                <Pin size={10} className="fill-current" />
                Pin
              </div>
              {pinnedModels.map(({ provider, model }) => {
                const isSelected = model.id === selected?.modelId && provider.name === selected?.provider;
                return (
                  <div key={`pin-${provider.name}-${model.id}`} className="px-1.5">
                    <div
                      className={`${itemBaseClass} ${getItemStateClass(isSelected, isFocused(`pin:${provider.name}:${model.id}`), hasKeyboardFocus)} group relative`}
                      data-model-key={`pin:${provider.name}:${model.id}`}
                    >
                      <button type="button" onClick={() => void handleSelect(provider.name, model.id)} className="absolute inset-0 h-full w-full cursor-pointer" aria-label={`选择 ${model.name || model.id}`} />
                      <span className="pointer-events-none relative min-w-0 flex-1 truncate">{model.name || model.id}</span>
                      <span className="pointer-events-none relative shrink-0 text-[11px] text-[var(--ftre-text-ghost,#666)]">{provider.label}</span>
                      <span className="relative flex shrink-0 items-center gap-0.5 overflow-hidden">
                        <span className="pointer-events-none flex max-w-0 items-center gap-1 opacity-0 transition-opacity transition-colors duration-150 group-hover:max-w-[80px] group-hover:opacity-100">
                          <ModelBadges contextWindow={model.context_window} vision={model.vision} />
                        </span>
                        <button type="button" onClick={(e) => handleTogglePin(e, provider.name, model.id)} className="relative z-10 cursor-pointer rounded p-0.5 text-[var(--ftre-accent,#00ff88)] transition-colors hover:bg-[var(--ftre-border,#3c3c3c)]/50" title="取消置顶">
                          <Pin size={13} className="fill-current" />
                        </button>
                      </span>
                      {isSelected && <Check size={14} className="pointer-events-none relative shrink-0" />}
                    </div>
                  </div>
                );
              })}
              <div className="mx-3 mb-1 mt-1.5 border-t border-[var(--ftre-border,#3c3c3c)]/60" />
             </div>
           )}

          {pinnedOnlyByDefault && !showAllModels && !search.trim() && pinnedModels.length === 0 && (
            <div className="px-4 py-3 text-[12px] text-t-ghost">暂无 Pin 模型</div>
          )}

          {pinnedOnlyByDefault && !showAllModels && !search.trim() && (
            <button
              type="button"
              role="menuitem"
              onClick={() => setShowAllModels(true)}
              className="mx-2 mt-0.5 flex w-[calc(100%-1rem)] items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] text-t-ghost transition-colors hover:bg-hover hover:text-t-primary"
            >
              <ChevronDown size={12} />
              更多模型
            </button>
          )}

          {(!pinnedOnlyByDefault || showAllModels || search.trim()) && providers.map((provider) => {
            const filteredModels = provider.models.filter((model) => {
              if (!search.trim()) return true;
              const q = search.toLowerCase();
              return model.name.toLowerCase().includes(q) || model.id.toLowerCase().includes(q);
            });
            if (filteredModels.length === 0) return null;
            return (
              <div key={provider.name}>
                <div className="px-4 pb-1.5 pt-3 text-[11px] font-medium uppercase tracking-wider text-[var(--ftre-text-ghost,#666)]">{provider.label}</div>
                {filteredModels.map((model) => {
                  if (!search.trim() && isPinnedModel(provider.name, model.id)) return null;
                  const isSelected = model.id === selected?.modelId && provider.name === selected?.provider;
                  const modelPinned = isPinned(provider.name, model.id);
                  return (
                    <div key={`${provider.name}-${model.id}`} className="px-1.5" data-model-key={`${provider.name}:${model.id}`}>
                      <div className={`${itemBaseClass} ${getItemStateClass(isSelected, isFocused(`${provider.name}:${model.id}`), hasKeyboardFocus)} group relative`}>
                        <button type="button" onClick={() => void handleSelect(provider.name, model.id)} className="absolute inset-0 h-full w-full cursor-pointer" aria-label={`选择 ${model.name || model.id}`} />
                        <span className="pointer-events-none relative min-w-0 flex-1 truncate">{model.name || model.id}</span>
                        <span className="relative flex shrink-0 items-center gap-0.5 overflow-hidden">
                          <span className={`pointer-events-none flex items-center gap-1 transition-opacity transition-colors duration-150 ${modelPinned ? "max-w-0 opacity-0" : "max-w-[80px] opacity-100 group-hover:max-w-0 group-hover:opacity-0"}`}>
                            <ModelBadges contextWindow={model.context_window} vision={model.vision} />
                          </span>
                          <button type="button" onClick={(e) => handleTogglePin(e, provider.name, model.id)} className={`relative z-10 cursor-pointer rounded p-0.5 transition-opacity transition-colors duration-150 ${modelPinned ? "max-w-[24px] opacity-100 text-[var(--ftre-accent,#00ff88)]" : "max-w-0 opacity-0 text-[var(--ftre-text-ghost,#666)] group-hover:max-w-[24px] group-hover:opacity-100"}`} title={modelPinned ? "取消置顶" : "置顶"}>
                            <Pin size={13} className={modelPinned ? "fill-current" : ""} />
                          </button>
                        </span>
                        {isSelected && <Check size={14} className="pointer-events-none relative shrink-0" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          }).filter(Boolean)}
        </div>
      )}

    </div>
  ) : null;

  return (
    <div
      className="relative"
      ref={panelRef}
      onMouseEnter={openOnHover ? handleMouseEnter : undefined}
      onMouseLeave={openOnHover ? scheduleHoverClose : undefined}
    >
      {renderTrigger({ open, toggle })}
      {typeof document === "undefined" ? null : createPortal(
        floatingPanel,
        document.body,
      )}
    </div>
  );
}
