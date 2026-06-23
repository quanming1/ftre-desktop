import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { JsonTree } from "./JsonTree";

describe("JsonTree", () => {
  it("renders the root by default and lazily expands nested containers", () => {
    render(
      <JsonTree
        value={{
          messages: [{ role: "user", content: "hello" }],
          temperature: 0.2,
        }}
      />,
    );

    expect(screen.getByText("Root")).toBeInTheDocument();
    expect(screen.getByText("Object(2)")).toBeInTheDocument();
    expect(screen.getByText("messages")).toBeInTheDocument();
    expect(screen.queryByText("hello")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开 messages" }));
    fireEvent.click(screen.getByRole("button", { name: "展开 0" }));

    expect(screen.getByText("role")).toBeInTheDocument();
    expect(screen.getByText(/hello/)).toBeInTheDocument();
  });

  it("can reveal all remaining children with one click", () => {
    render(<JsonTree value={Array.from({ length: 55 }, (_, index) => `item-${index}`)} />);

    expect(screen.queryByText(/item-54/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示全部剩余 5 项" }));
    expect(screen.getByText(/item-54/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收回到前 50 项" })).toBeInTheDocument();
  });

});
