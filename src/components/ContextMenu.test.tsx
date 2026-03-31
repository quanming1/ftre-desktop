import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Copy, Trash2, Edit } from "lucide-react";

// ── helpers ──────────────────────────────────────────────────────────

function makeItems(overrides?: Partial<ContextMenuItem>[]): ContextMenuItem[] {
  const defaults: ContextMenuItem[] = [
    { id: "open", label: "Open", shortcut: "Enter", icon: Edit, action: vi.fn() },
    { id: "sep1", label: "", separator: true, action: vi.fn() },
    { id: "copy", label: "Copy Path", shortcut: "Ctrl+C", icon: Copy, action: vi.fn() },
    { id: "delete", label: "Delete", icon: Trash2, disabled: true, action: vi.fn() },
    { id: "rename", label: "Rename", action: vi.fn() },
  ];
  if (overrides) {
    overrides.forEach((o, i) => {
      if (defaults[i]) Object.assign(defaults[i], o);
    });
  }
  return defaults;
}

const defaultPosition = { x: 100, y: 200 };

function renderMenu(items?: ContextMenuItem[], onClose?: () => void) {
  const menuItems = items ?? makeItems();
  const close = onClose ?? vi.fn();
  return { ...render(<ContextMenu items={menuItems} position={defaultPosition} onClose={close} />), onClose: close, items: menuItems };
}

// ── tests ────────────────────────────────────────────────────────────

describe("ContextMenu — rendering", () => {
  it("renders via portal into document.body", () => {
    renderMenu();
    const menu = screen.getByRole("menu");
    expect(menu.parentElement).toBe(document.body);
  });

  it("positions at the given x, y coordinates", () => {
    renderMenu();
    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("100px");
    expect(menu.style.top).toBe("200px");
  });

  it("renders all non-separator items as menuitems", () => {
    renderMenu();
    const menuItems = screen.getAllByRole("menuitem");
    // 5 items total, 1 separator → 4 menuitems
    expect(menuItems).toHaveLength(4);
  });

  it("renders separator as a divider", () => {
    renderMenu();
    const separators = screen.getAllByRole("separator");
    expect(separators).toHaveLength(1);
  });

  it("displays label text for each item", () => {
    renderMenu();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Copy Path")).toBeTruthy();
    expect(screen.getByText("Delete")).toBeTruthy();
    expect(screen.getByText("Rename")).toBeTruthy();
  });

  it("displays shortcut text when provided", () => {
    renderMenu();
    expect(screen.getByText("Enter")).toBeTruthy();
    expect(screen.getByText("Ctrl+C")).toBeTruthy();
  });

  it("renders disabled items as visually dimmed", () => {
    renderMenu();
    const deleteBtn = screen.getByText("Delete").closest("button");
    expect(deleteBtn).toBeDisabled();
    expect(deleteBtn?.className).toContain("opacity-50");
  });
});

describe("ContextMenu — item click actions", () => {
  it("calls action and onClose when clicking an enabled item", () => {
    const { items, onClose } = renderMenu();
    fireEvent.click(screen.getByText("Open"));
    expect(items[0].action).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call action when clicking a disabled item", () => {
    const { items, onClose } = renderMenu();
    fireEvent.click(screen.getByText("Delete"));
    expect(items[3].action).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls the correct action for each item", () => {
    const { items } = renderMenu();
    fireEvent.click(screen.getByText("Copy Path"));
    expect(items[2].action).toHaveBeenCalledTimes(1);
    expect(items[0].action).not.toHaveBeenCalled();
  });
});

describe("ContextMenu — close behavior", () => {
  it("closes on Escape key", () => {
    const { onClose } = renderMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on click outside the menu", () => {
    const { onClose } = renderMenu();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on click inside the menu", () => {
    const onClose = vi.fn();
    const items: ContextMenuItem[] = [{ id: "a", label: "Item A", disabled: true, action: vi.fn() }];
    renderMenu(items, onClose);
    const menu = screen.getByRole("menu");
    fireEvent.mouseDown(menu);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ContextMenu — keyboard navigation", () => {
  it("ArrowDown moves focus to the first focusable item", () => {
    renderMenu();
    fireEvent.keyDown(document, { key: "ArrowDown" });

    // First focusable item is "Open" (index 0)
    const menuItems = screen.getAllByRole("menuitem");
    expect(menuItems[0].className).toContain("bg-neon-ghost");
  });

  it("ArrowDown skips separators and disabled items", () => {
    renderMenu();
    // Press down 3 times: Open → Copy Path → Rename (skips separator and disabled Delete)
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowDown" });

    // Third focusable item is "Rename" (index 4, but 3rd focusable)
    const renameBtn = screen.getByText("Rename").closest("button");
    expect(renameBtn?.className).toContain("bg-neon-ghost");
  });

  it("ArrowDown wraps around to the first item", () => {
    renderMenu();
    // Focusable items: Open(0), Copy Path(2), Rename(4) → 3 items
    fireEvent.keyDown(document, { key: "ArrowDown" }); // → Open
    fireEvent.keyDown(document, { key: "ArrowDown" }); // → Copy Path
    fireEvent.keyDown(document, { key: "ArrowDown" }); // → Rename
    fireEvent.keyDown(document, { key: "ArrowDown" }); // → wraps to Open

    const openBtn = screen.getByText("Open").closest("button");
    expect(openBtn?.className).toContain("bg-neon-ghost");
  });

  it("ArrowUp moves focus to the last focusable item from initial state", () => {
    renderMenu();
    fireEvent.keyDown(document, { key: "ArrowUp" });

    // From -1 (no focus), ArrowUp should go to last focusable: Rename
    const renameBtn = screen.getByText("Rename").closest("button");
    expect(renameBtn?.className).toContain("bg-neon-ghost");
  });

  it("ArrowUp wraps around from first to last", () => {
    renderMenu();
    fireEvent.keyDown(document, { key: "ArrowDown" }); // → Open (first)
    fireEvent.keyDown(document, { key: "ArrowUp" }); // → wraps to Rename (last)

    const renameBtn = screen.getByText("Rename").closest("button");
    expect(renameBtn?.className).toContain("bg-neon-ghost");
  });

  it("Enter activates the focused item and closes menu", () => {
    const { items, onClose } = renderMenu();
    fireEvent.keyDown(document, { key: "ArrowDown" }); // → Open
    fireEvent.keyDown(document, { key: "Enter" });

    expect(items[0].action).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter does nothing when no item is focused", () => {
    const { items, onClose } = renderMenu();
    fireEvent.keyDown(document, { key: "Enter" });

    items.forEach((item) => expect(item.action).not.toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("mouse hover updates focused index", () => {
    renderMenu();
    const renameBtn = screen.getByText("Rename").closest("button")!;
    fireEvent.mouseEnter(renameBtn);
    expect(renameBtn.className).toContain("bg-neon-ghost");
  });

  it("mouse hover on disabled item does not update focus", () => {
    renderMenu();
    // First focus on Open
    fireEvent.keyDown(document, { key: "ArrowDown" });
    const openBtn = screen.getByText("Open").closest("button")!;
    expect(openBtn.className).toContain("bg-neon-ghost");

    // Hover on disabled Delete
    const deleteBtn = screen.getByText("Delete").closest("button")!;
    fireEvent.mouseEnter(deleteBtn);

    // Open should still be focused (Delete hover is ignored)
    expect(openBtn.className).toContain("bg-neon-ghost");
    expect(deleteBtn.className).not.toContain("bg-neon-ghost");
  });
});

describe("ContextMenu — edge cases", () => {
  it("handles empty items array", () => {
    renderMenu([], vi.fn());
    const menu = screen.getByRole("menu");
    expect(menu).toBeTruthy();
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });

  it("handles all items being separators", () => {
    const items: ContextMenuItem[] = [
      { id: "s1", label: "", separator: true, action: vi.fn() },
      { id: "s2", label: "", separator: true, action: vi.fn() },
    ];
    renderMenu(items, vi.fn());
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });

  it("handles all items being disabled", () => {
    const items: ContextMenuItem[] = [
      { id: "a", label: "A", disabled: true, action: vi.fn() },
      { id: "b", label: "B", disabled: true, action: vi.fn() },
    ];
    const onClose = vi.fn();
    renderMenu(items, onClose);

    // ArrowDown should not focus anything (no focusable items)
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Enter" });

    items.forEach((item) => expect(item.action).not.toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("handles single enabled item", () => {
    const items: ContextMenuItem[] = [{ id: "only", label: "Only Item", action: vi.fn() }];
    const onClose = vi.fn();
    renderMenu(items, onClose);

    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Enter" });

    expect(items[0].action).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
