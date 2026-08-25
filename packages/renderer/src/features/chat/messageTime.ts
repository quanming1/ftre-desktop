/**
 * 消息元数据统一时间格式：一周内显示相对时间，较早消息显示完整本地时间。
 * Assistant 和 User 共用，避免两种消息的时间表达逐渐分叉。
 */
export function formatMessageTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minute = Math.floor(elapsed / 60_000);
  const hour = Math.floor(elapsed / 3_600_000);
  const day = Math.floor(elapsed / 86_400_000);
  if (day >= 7) return formatAbsoluteMessageTime(timestamp);
  if (minute < 1) return "刚刚";
  if (minute < 60) return `${minute}m`;
  if (hour < 24) return `${hour}h`;
  return `${day}d`;
}

export function formatAbsoluteMessageTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()} ${pad(date.getMonth() + 1)} ${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
