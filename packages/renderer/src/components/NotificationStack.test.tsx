import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NotificationStack } from "./NotificationStack";
import { useNotification } from "../stores/notification";

beforeEach(() => {
  vi.useFakeTimers();
  useNotification.setState({ notifications: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

function addNotification(level: "info" | "warning" | "error", message: string, actions?: { label: string; onClick: () => void }[]) {
  let id: string;
  act(() => {
    id = useNotification.getState().addNotification({ level, message, actions });
  });
  return id!;
}

// ── rendering ────────────────────────────────────────────────────────

describe("NotificationStack — rendering", () => {
  it("renders nothing when there are no notifications", () => {
    const { container } = render(<NotificationStack />);
    expect(container.innerHTML).toBe("");
  });

  it("renders notifications from the store", () => {
    addNotification("info", "Hello world");
    render(<NotificationStack />);
    expect(screen.getByText("Hello world")).toBeTruthy();
  });

  it("renders multiple notifications stacked", () => {
    addNotification("info", "First");
    addNotification("warning", "Second");
    addNotification("error", "Third");
    render(<NotificationStack />);

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(3);
  });

  it("newest notification appears last in the DOM", () => {
    addNotification("info", "First");
    addNotification("info", "Second");
    render(<NotificationStack />);

    const alerts = screen.getAllByRole("alert");
    expect(alerts[0].textContent).toContain("First");
    expect(alerts[1].textContent).toContain("Second");
  });
});

// ── level-specific styling ───────────────────────────────────────────

describe("NotificationStack — level styles", () => {
  it("applies info styling with cyan accent", () => {
    addNotification("info", "Info message");
    render(<NotificationStack />);

    const alert = screen.getByRole("alert");
    expect(alert.dataset.level).toBe("info");
    expect(alert.className).toContain("border-cyan");
  });

  it("applies warning styling with amber accent", () => {
    addNotification("warning", "Warning message");
    render(<NotificationStack />);

    const alert = screen.getByRole("alert");
    expect(alert.dataset.level).toBe("warning");
    expect(alert.className).toContain("border-amber");
  });

  it("applies error styling with red accent", () => {
    addNotification("error", "Error message");
    render(<NotificationStack />);

    const alert = screen.getByRole("alert");
    expect(alert.dataset.level).toBe("error");
    expect(alert.className).toContain("border-red");
  });

  it("renders the correct icon for each level", () => {
    addNotification("info", "Info");
    addNotification("warning", "Warn");
    addNotification("error", "Err");
    render(<NotificationStack />);

    expect(screen.getByLabelText("Info")).toBeTruthy();
    expect(screen.getByLabelText("Warning")).toBeTruthy();
    expect(screen.getByLabelText("Error")).toBeTruthy();
  });
});

// ── close button ─────────────────────────────────────────────────────

describe("NotificationStack — close button", () => {
  it("removes notification when close button is clicked", () => {
    addNotification("info", "Dismiss me");
    const { rerender } = render(<NotificationStack />);

    expect(screen.getByText("Dismiss me")).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByLabelText("Close notification"));
    });
    rerender(<NotificationStack />);

    expect(screen.queryByText("Dismiss me")).toBeNull();
  });

  it("removes only the targeted notification", () => {
    addNotification("info", "Keep me");
    addNotification("warning", "Remove me");
    const { rerender } = render(<NotificationStack />);

    const closeButtons = screen.getAllByLabelText("Close notification");
    act(() => {
      fireEvent.click(closeButtons[1]); // close the second one
    });
    rerender(<NotificationStack />);

    expect(screen.getByText("Keep me")).toBeTruthy();
    expect(screen.queryByText("Remove me")).toBeNull();
  });
});

// ── auto-dismiss ─────────────────────────────────────────────────────

describe("NotificationStack — auto-dismiss", () => {
  it("auto-removes info notification after 5 seconds", () => {
    addNotification("info", "Auto dismiss");
    const { rerender } = render(<NotificationStack />);

    expect(screen.getByText("Auto dismiss")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    rerender(<NotificationStack />);

    expect(screen.queryByText("Auto dismiss")).toBeNull();
  });

  it("auto-removes warning notification after 5 seconds", () => {
    addNotification("warning", "Warning auto");
    const { rerender } = render(<NotificationStack />);

    expect(screen.getByText("Warning auto")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    rerender(<NotificationStack />);

    expect(screen.queryByText("Warning auto")).toBeNull();
  });

  it("does NOT auto-remove error notifications", () => {
    addNotification("error", "Persistent error");
    const { rerender } = render(<NotificationStack />);

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    rerender(<NotificationStack />);

    expect(screen.getByText("Persistent error")).toBeTruthy();
  });

  it("does not dismiss before 5 seconds", () => {
    addNotification("info", "Not yet");
    const { rerender } = render(<NotificationStack />);

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    rerender(<NotificationStack />);

    expect(screen.getByText("Not yet")).toBeTruthy();
  });
});

// ── action buttons ───────────────────────────────────────────────────

describe("NotificationStack — action buttons", () => {
  it("renders action buttons when provided", () => {
    const onClick = vi.fn();
    addNotification("info", "With action", [{ label: "Retry", onClick }]);
    render(<NotificationStack />);

    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("calls action onClick and removes notification when action button is clicked", () => {
    const onClick = vi.fn();
    addNotification("warning", "Action test", [{ label: "Fix", onClick }]);
    const { rerender } = render(<NotificationStack />);

    act(() => {
      fireEvent.click(screen.getByText("Fix"));
    });
    rerender(<NotificationStack />);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Action test")).toBeNull();
  });

  it("renders multiple action buttons", () => {
    addNotification("error", "Multi action", [
      { label: "Retry", onClick: vi.fn() },
      { label: "Ignore", onClick: vi.fn() },
    ]);
    render(<NotificationStack />);

    expect(screen.getByText("Retry")).toBeTruthy();
    expect(screen.getByText("Ignore")).toBeTruthy();
  });

  it("does not render action area when no actions provided", () => {
    addNotification("info", "No actions");
    render(<NotificationStack />);

    const alert = screen.getByRole("alert");
    // Should only have the message row, no action buttons
    expect(alert.querySelectorAll("button")).toHaveLength(1); // only close button
  });
});

// ── slide-in animation ──────────────────────────────────────────────

describe("NotificationStack — animation", () => {
  it("applies slide-in animation class", () => {
    addNotification("info", "Animated");
    render(<NotificationStack />);

    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("animate-slide-in-right");
  });
});
