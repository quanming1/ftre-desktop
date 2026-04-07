/**
 * Tailwind CSS preset for @ftre/ui
 *
 * This preset provides CSS custom properties that the components use.
 * Users can override these variables in their own CSS to customize the theme.
 */

import type { Config } from "tailwindcss";

export const ftreUiPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        // Background layers (dark to light)
        "ftre-base": "var(--ftre-base, #1e1e1e)",
        "ftre-surface": "var(--ftre-surface, #252526)",
        "ftre-elevated": "var(--ftre-elevated, #2d2d2d)",
        "ftre-panel": "var(--ftre-panel, #333333)",
        "ftre-menu-bg": "var(--ftre-menu-bg, #2d2d2d)",
        // Brand colors (neon green)
        "ftre-accent": "var(--ftre-accent, #00ff88)",
        "ftre-accent-hover": "var(--ftre-accent-hover, #00cc6e)",
        "ftre-accent-dim": "var(--ftre-accent-dim, rgba(0, 255, 136, 0.12))",
        "ftre-accent-ghost": "var(--ftre-accent-ghost, rgba(0, 255, 136, 0.06))",
        // Borders
        "ftre-border": "var(--ftre-border, #3c3c3c)",
        "ftre-border-subtle": "var(--ftre-border-subtle, #454545)",
        // Text hierarchy
        "ftre-text-primary": "var(--ftre-text-primary, #e8e8e8)",
        "ftre-text-secondary": "var(--ftre-text-secondary, #cccccc)",
        "ftre-text-muted": "var(--ftre-text-muted, #aab0b8)",
        "ftre-text-dim": "var(--ftre-text-dim, #969ca6)",
        "ftre-text-ghost": "var(--ftre-text-ghost, #888e98)",
        "ftre-text-faint": "var(--ftre-text-faint, #7a8088)",
        // Semantic colors
        "ftre-success": "var(--ftre-success, #00ff88)",
        "ftre-warning": "var(--ftre-warning, #d29922)",
        "ftre-error": "var(--ftre-error, #f85149)",
        "ftre-info": "var(--ftre-info, #58a6ff)",
      },
      keyframes: {
        "ftre-enter": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "ftre-exit": {
          from: { opacity: "1", transform: "scale(1)" },
          to: { opacity: "0", transform: "scale(0.95)" },
        },
        "ftre-fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "ftre-fade-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        "ftre-slide-in-from-top": {
          from: { transform: "translateY(-8px)" },
          to: { transform: "translateY(0)" },
        },
        "ftre-slide-in-from-bottom": {
          from: { transform: "translateY(8px)" },
          to: { transform: "translateY(0)" },
        },
        "ftre-slide-in-from-left": {
          from: { transform: "translateX(-8px)" },
          to: { transform: "translateX(0)" },
        },
        "ftre-slide-in-from-right": {
          from: { transform: "translateX(8px)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        "ftre-enter": "ftre-enter 150ms ease-out",
        "ftre-exit": "ftre-exit 100ms ease-in",
        "ftre-fade-in": "ftre-fade-in 150ms ease-out",
        "ftre-fade-out": "ftre-fade-out 100ms ease-in",
      },
    },
  },
};

export default ftreUiPreset;

/**
 * CSS variables reference (aligned with ftre design system):
 *
 * Background layers:
 * --ftre-base: Main background (default: #1e1e1e)
 * --ftre-surface: Sidebar/panel background (default: #252526)
 * --ftre-elevated: Floating elements (default: #2d2d2d)
 * --ftre-panel: Input/card background (default: #333333)
 * --ftre-menu-bg: Menu/dropdown background (default: #2d2d2d)
 *
 * Brand colors:
 * --ftre-accent: Primary accent/neon green (default: #00ff88)
 * --ftre-accent-hover: Accent hover state (default: #00cc6e)
 * --ftre-accent-dim: Low opacity accent for selection (default: rgba(0,255,136,0.12))
 * --ftre-accent-ghost: Ultra-low opacity accent (default: rgba(0,255,136,0.06))
 *
 * Borders:
 * --ftre-border: Primary border (default: #3c3c3c)
 * --ftre-border-subtle: Secondary border (default: #454545)
 *
 * Text hierarchy:
 * --ftre-text-primary: Primary text (default: #e8e8e8)
 * --ftre-text-secondary: Secondary text (default: #cccccc)
 * --ftre-text-muted: Auxiliary text (default: #aab0b8)
 * --ftre-text-dim: Dimmed text (default: #969ca6)
 * --ftre-text-ghost: Placeholder text (default: #888e98)
 * --ftre-text-faint: Timestamp/weakest text (default: #7a8088)
 *
 * Semantic colors:
 * --ftre-success: Success state (default: #00ff88)
 * --ftre-warning: Warning state (default: #d29922)
 * --ftre-error: Error state (default: #f85149)
 * --ftre-info: Info/link state (default: #58a6ff)
 */
