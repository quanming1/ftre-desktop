export interface Position {
    x: number;
    y: number;
}

export interface Size {
    width: number;
    height: number;
}

export interface Viewport {
    width: number;
    height: number;
}

/**
 * Adjusts a context menu position to keep it fully within the viewport.
 *
 * - If the menu bottom would exceed the viewport bottom, adjusts y upward.
 * - If the menu right would exceed the viewport right, adjusts x leftward.
 * - Ensures x >= 0 and y >= 0.
 */
export function adjustMenuPosition(
    position: Position,
    menuSize: Size,
    viewport: Viewport,
): Position {
    let { x, y } = position;

    if (y + menuSize.height > viewport.height) {
        y = viewport.height - menuSize.height - 4;
    }
    if (x + menuSize.width > viewport.width) {
        x = viewport.width - menuSize.width - 4;
    }

    return { x: Math.max(0, x), y: Math.max(0, y) };
}
