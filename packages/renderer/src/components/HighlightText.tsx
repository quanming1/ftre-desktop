/**
 * HighlightText — 按 query 大小写不敏感高亮文本。
 *
 * 搜索结果（标题 / 摘要）命中词渲染为 <mark>（黄底）。
 * query 为空或未命中时原样渲染（单 span，不额外分段）。
 */
import { memo } from "react";

interface Segment {
  text: string;
  hit: boolean;
}

function splitByQuery(text: string, query: string): Segment[] {
  if (!query) return [{ text, hit: false }];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const segments: Segment[] = [];
  let cursor = 0;
  let idx = lowerText.indexOf(lowerQuery);
  while (idx >= 0) {
    if (idx > cursor) segments.push({ text: text.slice(cursor, idx), hit: false });
    segments.push({ text: text.slice(idx, idx + query.length), hit: true });
    cursor = idx + query.length;
    idx = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments;
}

export const HighlightText = memo(function HighlightText({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  const segments = splitByQuery(text, query);
  return (
    <>
      {segments.map((seg, i) =>
        seg.hit ? (
          <mark
            key={i}
            className="rounded-[2px] bg-amber-200/80 px-0.5 text-inherit dark:bg-amber-500/40"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
});
