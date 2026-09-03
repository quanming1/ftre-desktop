import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getFaviconUrls, HttpLink, splitHttpUrls } from "./HttpLink";

describe("HttpLink", () => {
  it("uses the target origin favicon and keeps trailing punctuation outside the link", () => {
    expect(getFaviconUrls("https://developers.openai.com/api/docs")).toEqual([
      "https://developers.openai.com/favicon.ico",
      "https://developers.openai.com/favicon.png",
      "https://developers.openai.com/favicon.svg",
      "https://developers.openai.com/apple-touch-icon.png",
      "https://icons.duckduckgo.com/ip3/developers.openai.com.ico",
      "https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Fdevelopers.openai.com&sz=32",
    ]);
    expect(splitHttpUrls("查看 https://example.com/docs。"))
      .toEqual([
        { text: "查看 " },
        { text: "https://example.com/docs", href: "https://example.com/docs" },
        { text: "。" },
      ]);
  });

  it("tries alternate site icon formats before using the local fallback", () => {
    const { container } = render(<HttpLink href="https://example.com/docs">文档</HttpLink>);

    const icon = container.querySelector("img");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("src", "https://example.com/favicon.ico");
    fireEvent.error(icon!);

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/favicon.png",
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/favicon.svg",
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/apple-touch-icon.png",
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://icons.duckduckgo.com/ip3/example.com.ico",
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Fexample.com&sz=32",
    );
    fireEvent.error(container.querySelector("img")!);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("http-link-fallback-icon")).toBeInTheDocument();
  });
});
