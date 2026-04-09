import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import { Check, X, ChevronDown } from "lucide-react";
import { cn } from "../utils/cn";

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
}

export interface SearchableMultiSelectProps {
  options: SelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
}

export function SearchableMultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  disabled = false,
  className,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Group options
  const groupedOptions = options.reduce<Record<string, SelectOption[]>>(
    (acc, opt) => {
      const group = opt.group || "";
      if (!acc[group]) acc[group] = [];
      acc[group].push(opt);
      return acc;
    },
    {},
  );

  // Filter options
  const filteredGroups = Object.entries(groupedOptions)
    .map(([group, opts]) => ({
      group,
      options: opts.filter(
        (opt) =>
          !search ||
          opt.label.toLowerCase().includes(search.toLowerCase()) ||
          opt.value.toLowerCase().includes(search.toLowerCase()),
      ),
    }))
    .filter((g) => g.options.length > 0);

  const flatFiltered = filteredGroups.flatMap((g) => g.options);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus input when open
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Reset highlight on search change
  useEffect(() => {
    setHighlightIndex(0);
  }, [search]);

  const toggleOption = useCallback(
    (optionValue: string) => {
      if (value.includes(optionValue)) {
        onChange(value.filter((v) => v !== optionValue));
      } else {
        onChange([...value, optionValue]);
      }
    },
    [value, onChange],
  );

  const removeOption = useCallback(
    (optionValue: string, e: React.MouseEvent) => {
      e.stopPropagation();
      onChange(value.filter((v) => v !== optionValue));
    },
    [value, onChange],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, flatFiltered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flatFiltered[highlightIndex]) {
      e.preventDefault();
      toggleOption(flatFiltered[highlightIndex].value);
    } else if (e.key === "Escape") {
      setOpen(false);
      setSearch("");
    }
  };

  const selectedLabels = value
    .map((v) => options.find((o) => o.value === v)?.label || v)
    .slice(0, 3);
  const moreCount = value.length - 3;

  return (
    <div className={cn("relative", className)} ref={panelRef}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 w-full min-h-[32px] px-3 py-1.5 rounded text-left transition-colors",
          "bg-[var(--ftre-panel,#2d2d2d)] text-[var(--ftre-text-primary,#e8e8e8)]",
          "border border-[var(--ftre-border,#3c3c3c)]",
          "hover:border-[var(--ftre-border-subtle,#454545)]",
          "focus:outline-none focus:border-[var(--ftre-accent,#00ff88)] focus:ring-1 focus:ring-[var(--ftre-accent,#00ff88)]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        <div className="flex-1 flex flex-wrap gap-1.5 min-h-[20px]">
          {value.length === 0 ? (
            <span className="text-[13px] text-[var(--ftre-text-ghost,#888e98)]">
              {placeholder}
            </span>
          ) : (
            <>
              {selectedLabels.map((label, i) => (
                <span
                  key={value[i]}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[12px] bg-[var(--ftre-accent-dim,rgba(0,255,136,0.12))] text-[var(--ftre-text-primary,#e8e8e8)]"
                >
                  {label}
                  <button
                    type="button"
                    onClick={(e) => removeOption(value[i], e)}
                    className="hover:text-[var(--ftre-accent,#00ff88)] transition-colors"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              {moreCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] bg-[var(--ftre-border,#3c3c3c)] text-[var(--ftre-text-muted,#aab0b8)]">
                  +{moreCount}
                </span>
              )}
            </>
          )}
        </div>
        <ChevronDown
          size={14}
          className={cn(
            "shrink-0 text-[var(--ftre-text-ghost,#888e98)] transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute top-full left-0 mt-1 w-full max-h-[280px] bg-[var(--ftre-elevated,#252526)] border border-[var(--ftre-border-subtle,#454545)] rounded-md overflow-hidden flex flex-col shadow-xl z-[100]"
          style={{ animation: "fadeIn 0.1s ease-out" }}
        >
          {/* Search */}
          <div className="p-2 border-b border-[var(--ftre-border,#3c3c3c)]">
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="w-full px-2.5 py-1.5 text-[13px] bg-[var(--ftre-base,#1a1b1d)] rounded text-[var(--ftre-text-primary,#e8e8e8)] placeholder-[var(--ftre-text-dim,#969ca6)] outline-none"
            />
          </div>

          {/* Options */}
          <div className="flex-1 overflow-y-auto py-1">
            {flatFiltered.length === 0 && (
              <div className="px-4 py-3 text-[13px] text-[var(--ftre-text-dim,#969ca6)] text-center">
                No results found
              </div>
            )}

            {filteredGroups.map(({ group, options: groupOptions }) => (
              <div key={group}>
                {group && (
                  <div className="px-4 pt-2.5 pb-1 text-[11px] text-[var(--ftre-text-dim,#969ca6)] uppercase tracking-wider">
                    {group}
                  </div>
                )}
                {groupOptions.map((opt) => {
                  const isSelected = value.includes(opt.value);
                  const flatIndex = flatFiltered.findIndex(
                    (f) => f.value === opt.value,
                  );
                  const isHighlighted = flatIndex === highlightIndex;

                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleOption(opt.value)}
                      className={cn(
                        "w-full flex items-center gap-2 px-4 py-2 text-[13px] text-left transition-colors",
                        group ? "pl-6" : "",
                        isHighlighted
                          ? "bg-[var(--ftre-accent-ghost,rgba(0,255,136,0.06))]"
                          : "hover:bg-[rgba(255,255,255,0.04)]",
                        isSelected
                          ? "text-[var(--ftre-accent,#00ff88)]"
                          : "text-[var(--ftre-text-primary,#e8e8e8)]",
                      )}
                    >
                      <span
                        className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                          isSelected
                            ? "bg-[var(--ftre-accent,#00ff88)] border-[var(--ftre-accent,#00ff88)]"
                            : "border-[var(--ftre-border,#3c3c3c)]",
                        )}
                      >
                        {isSelected && (
                          <Check
                            size={12}
                            className="text-[var(--ftre-base,#1a1b1d)]"
                            strokeWidth={3}
                          />
                        )}
                      </span>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
