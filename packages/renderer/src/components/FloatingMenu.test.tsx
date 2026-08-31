import { createRef, type ReactNode } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FloatingMenu } from "@ftre/ui";

class TestResizeObserver {
  static instances = new Set<TestResizeObserver>();
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.instances.add(this);
  }

  observe() {}

  disconnect() {
    TestResizeObserver.instances.delete(this);
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
let panelHeight = 120;

function TestContent({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

describe("FloatingMenu", () => {
  beforeEach(() => {
    panelHeight = 120;
    TestResizeObserver.instances.clear();
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.dataset.testid === "anchor") {
        return {
          top: 400,
          right: 180,
          bottom: 428,
          left: 100,
          width: 80,
          height: 28,
          x: 100,
          y: 400,
          toJSON: () => ({}),
        };
      }
      if (this.dataset.ftreFloatingMenu === "test-menu") {
        return {
          top: 0,
          right: 300,
          bottom: panelHeight,
          left: 100,
          width: 200,
          height: panelHeight,
          x: 100,
          y: 0,
          toJSON: () => ({}),
        };
      }
      return originalGetBoundingClientRect.call(this);
    };
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    TestResizeObserver.instances.clear();
    vi.unstubAllGlobals();
  });

  it("repositions after the panel grows and the preferred side no longer fits", async () => {
    const anchorRef = createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={anchorRef} data-testid="anchor" type="button">触发</button>
        <FloatingMenu
          open
          anchorRef={anchorRef}
          placement="bottom"
          align="start"
          gap={4}
          viewportPadding={8}
          menuId="test-menu"
        >
          <TestContent>菜单内容</TestContent>
        </FloatingMenu>
      </>,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-ftre-floating-menu="test-menu"]')).not.toBeNull();
    });
    const panel = document.querySelector('[data-ftre-floating-menu="test-menu"]');
    expect(panel).not.toBeNull();
    if (!panel) return;
    await waitFor(() => expect(panel).toHaveStyle({ top: "432px" }));

    panelHeight = 300;
    act(() => {
      for (const observer of TestResizeObserver.instances) observer.trigger();
    });

    await waitFor(() => expect(panel).toHaveStyle({ top: "96px" }));
  });
});
