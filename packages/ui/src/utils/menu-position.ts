export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export function adjustMenuPosition(
  position: Position,
  menuSize: Size,
  viewport: Size,
  padding = 8,
): Position {
  let { x, y } = position;

  if (x + menuSize.width > viewport.width - padding) {
    x = viewport.width - menuSize.width - padding;
  }
  if (x < padding) {
    x = padding;
  }

  if (y + menuSize.height > viewport.height - padding) {
    y = viewport.height - menuSize.height - padding;
  }
  if (y < padding) {
    y = padding;
  }

  return { x, y };
}
