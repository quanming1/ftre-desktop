import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Globe2 } from "lucide-react";

const HTTP_URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION_RE = /[.,!?;:，。！？；：]$/;
const DIRECT_FAVICON_PATHS = [
  "/favicon.ico",
  "/favicon.png",
  "/favicon.svg",
  "/apple-touch-icon.png",
] as const;

export function parseHttpUrl(href: string): URL | null {
  try {
    const url = new URL(href);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/** Return ordered favicon candidates without sending the full link path to a resolver. */
export function getFaviconUrls(href: string): string[] {
  const url = parseHttpUrl(href);
  if (!url) return [];

  const direct = DIRECT_FAVICON_PATHS.map((path) => `${url.origin}${path}`);
  const host = encodeURIComponent(url.hostname);
  const origin = encodeURIComponent(url.origin);
  return [
    ...direct,
    `https://icons.duckduckgo.com/ip3/${host}.ico`,
    `https://www.google.com/s2/favicons?domain_url=${origin}&sz=32`,
  ];
}

function trimTrailingPunctuation(value: string): { url: string; suffix: string } {
  let end = value.length;
  while (end > 0 && TRAILING_PUNCTUATION_RE.test(value.slice(0, end))) end -= 1;

  const pairs: Array<[string, string]> = [[")", "("], ["]", "["], ["}", "{"]];
  let changed = true;
  while (changed && end > 0) {
    changed = false;
    const candidate = value.slice(0, end);
    for (const [closing, opening] of pairs) {
      if (!candidate.endsWith(closing)) continue;
      const closes = candidate.split(closing).length - 1;
      const opens = candidate.split(opening).length - 1;
      if (closes > opens) {
        end -= 1;
        changed = true;
        break;
      }
    }
  }

  return { url: value.slice(0, end), suffix: value.slice(end) };
}

export interface HttpTextPart {
  text: string;
  href?: string;
}

/** Split plain text into HTTP links without consuming sentence punctuation. */
export function splitHttpUrls(text: string): HttpTextPart[] {
  if (!text) return [{ text }];
  const result: HttpTextPart[] = [];
  let cursor = 0;

  for (const match of text.matchAll(HTTP_URL_RE)) {
    const index = match.index ?? 0;
    const raw = match[0];
    const trimmed = trimTrailingPunctuation(raw);
    if (!trimmed.url || !parseHttpUrl(trimmed.url)) continue;

    if (index > cursor) result.push({ text: text.slice(cursor, index) });
    result.push({ text: trimmed.url, href: trimmed.url });
    if (trimmed.suffix) result.push({ text: trimmed.suffix });
    cursor = index + raw.length;
  }

  if (cursor < text.length) result.push({ text: text.slice(cursor) });
  return result.length > 0 ? result : [{ text }];
}

export const HttpLink = memo(function HttpLink({
  href,
  children,
  className,
  title = "Ctrl + 点击在浏览器打开",
}: {
  href: string;
  children?: ReactNode;
  className?: string;
  title?: string;
}) {
  const faviconUrls = useMemo(() => getFaviconUrls(href), [href]);
  const [faviconIndex, setFaviconIndex] = useState(0);

  useEffect(() => {
    setFaviconIndex(0);
  }, [faviconUrls]);

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (!event.ctrlKey && !event.metaKey) return;

    const openExternal = (window as typeof window & {
      desktop?: { openExternal?: (url: string) => Promise<void> };
    }).desktop?.openExternal;
    if (typeof openExternal === "function") {
      void openExternal(href);
    } else {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      title={title}
      className={`inline-flex max-w-full items-baseline gap-1 ${className ?? ""}`}
    >
      {faviconUrls[faviconIndex] ? (
        <img
          src={faviconUrls[faviconIndex]}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFaviconIndex((index) => index + 1)}
          className="relative top-px h-3.5 w-3.5 shrink-0 rounded-[3px] object-contain"
        />
      ) : (
        <Globe2
          data-testid="http-link-fallback-icon"
          size={13}
          aria-hidden="true"
          className="relative top-px shrink-0 text-t-ghost"
        />
      )}
      <span className="min-w-0 break-all">{children ?? href}</span>
    </a>
  );
});
