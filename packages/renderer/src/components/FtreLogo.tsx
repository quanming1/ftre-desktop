import logoUrl from "@/assets/ftre-logo.svg";

export type FtreLogoProps = {
  /** 与旧 Logo 的数值约定保持一致；数值越大，显示尺寸越大。 */
  size?: number;
  className?: string;
};

/**
 * 应用壳统一使用的 Ftre 品牌图形。
 *
 * Logo 本身是静态资源，组件只负责尺寸和可访问属性，不持有状态，
 * 这样 TitleBar 与 LoadingScreen 不会各自维护一套图形实现。
 */
export function FtreLogo({ size = 2, className = "" }: FtreLogoProps) {
  const dimension = Math.max(1, Math.round(size * 10));

  return (
    <img
      src={logoUrl}
      alt="Ftre"
      role="img"
      width={dimension}
      height={dimension}
      draggable={false}
      className={`block select-none object-contain ${className}`.trim()}
    />
  );
}
