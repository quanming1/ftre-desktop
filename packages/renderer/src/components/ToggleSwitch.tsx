import { type FC } from "react";

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: "sm" | "md";
}

/**
 * 轻量 Toggle Switch — 纯 CSS，无 Radix 依赖。
 */
export const ToggleSwitch: FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  size = "md",
}) => {
  const dims =
    size === "sm"
      ? { w: 36, h: 20, thumb: 14, pad: 3 }
      : { w: 44, h: 24, thumb: 18, pad: 3 };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className="relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200"
      style={{
        width: dims.w,
        height: dims.h,
        background: checked
          ? "var(--ftre-text-primary, #000000)"
          : "var(--ftre-border, #d1d5db)",
      }}
    >
      <span
        className="block rounded-full bg-white shadow-sm transition-transform duration-200"
        style={{
          width: dims.thumb,
          height: dims.thumb,
          transform: `translateX(${checked ? dims.w - dims.thumb - dims.pad : dims.pad}px)`,
        }}
      />
    </button>
  );
};
