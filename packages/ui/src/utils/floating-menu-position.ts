export type FloatingMenuPlacement = "top" | "bottom" | "left" | "right";
export type FloatingMenuAlign = "start" | "center" | "end";

export interface FloatingMenuAnchorRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface FloatingMenuViewport {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface FloatingMenuSize {
  width: number;
  height: number;
}

export interface FloatingMenuPositionOptions {
  placement: FloatingMenuPlacement;
  align: FloatingMenuAlign;
  gap: number;
  padding: number;
}

export interface FloatingMenuPosition {
  left: number;
  top: number;
  maxHeight: number;
  placement: FloatingMenuPlacement;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function availableSpace(
  anchor: FloatingMenuAnchorRect,
  viewport: FloatingMenuViewport,
  gap: number,
  padding: number,
) {
  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;
  return {
    top: Math.max(0, anchor.top - viewport.top - gap - padding),
    right: Math.max(0, viewportRight - anchor.right - gap - padding),
    bottom: Math.max(0, viewportBottom - anchor.bottom - gap - padding),
    left: Math.max(0, anchor.left - viewport.left - gap - padding),
  };
}

function choosePlacement(
  preferred: FloatingMenuPlacement,
  size: FloatingMenuSize,
  space: ReturnType<typeof availableSpace>,
): FloatingMenuPlacement {
  const opposite: Record<FloatingMenuPlacement, FloatingMenuPlacement> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
  };
  const dimension = (placement: FloatingMenuPlacement) =>
    placement === "left" || placement === "right" ? size.width : size.height;
  const fits = (placement: FloatingMenuPlacement) =>
    dimension(placement) <= space[placement];

  if (fits(preferred)) return preferred;
  if (fits(opposite[preferred])) return opposite[preferred];

  const pair = [preferred, opposite[preferred]] as const;
  return space[pair[1]] > space[pair[0]] ? pair[1] : pair[0];
}

function alignOffset(
  anchor: FloatingMenuAnchorRect,
  size: FloatingMenuSize,
  align: FloatingMenuAlign,
  axis: "horizontal" | "vertical",
): number {
  if (axis === "horizontal") {
    if (align === "center") return anchor.left + (anchor.width - size.width) / 2;
    if (align === "end") return anchor.right - size.width;
    return anchor.left;
  }
  if (align === "center") return anchor.top + (anchor.height - size.height) / 2;
  if (align === "end") return anchor.bottom - size.height;
  return anchor.top;
}

export function calculateFloatingMenuPosition(
  anchor: FloatingMenuAnchorRect,
  size: FloatingMenuSize,
  viewport: FloatingMenuViewport,
  options: FloatingMenuPositionOptions,
): FloatingMenuPosition {
  const { gap, padding, align } = options;
  const space = availableSpace(anchor, viewport, gap, padding);
  const placement = choosePlacement(options.placement, size, space);
  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;
  const minLeft = viewport.left + padding;
  const maxLeft = Math.max(minLeft, viewportRight - size.width - padding);
  const minTop = viewport.top + padding;
  const maxTop = Math.max(minTop, viewportBottom - size.height - padding);

  let left: number;
  let top: number;

  if (placement === "right") {
    left = anchor.right + gap;
    top = alignOffset(anchor, size, align, "vertical");
  } else if (placement === "left") {
    left = anchor.left - size.width - gap;
    top = alignOffset(anchor, size, align, "vertical");
  } else if (placement === "bottom") {
    left = alignOffset(anchor, size, align, "horizontal");
    top = anchor.bottom + gap;
  } else {
    left = alignOffset(anchor, size, align, "horizontal");
    top = anchor.top - size.height - gap;
  }

  const viewportMaxHeight = Math.max(1, viewport.height - padding * 2);
  const availableMaxHeight = placement === "top" || placement === "bottom"
    ? Math.max(1, space[placement])
    : viewportMaxHeight;
  const maxHeight = Math.floor(Math.min(viewportMaxHeight, availableMaxHeight));

  return {
    left: Math.round(clamp(left, minLeft, maxLeft)),
    top: Math.round(clamp(top, minTop, maxTop)),
    maxHeight,
    placement,
  };
}
