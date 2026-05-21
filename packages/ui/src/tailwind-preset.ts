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
        // Background layers
        "ftre-base": "var(--ftre-base)",
        "ftre-surface": "var(--ftre-surface)",
        "ftre-elevated": "var(--ftre-elevated)",
        "ftre-panel": "var(--ftre-panel)",
        "ftre-menu-bg": "var(--ftre-menu-bg)",
        // Brand colors (neon green)
        "ftre-accent": "var(--ftre-accent)",
        "ftre-accent-hover": "var(--ftre-accent-hover)",
        "ftre-accent-dim": "var(--ftre-accent-dim)",
        "ftre-accent-ghost": "var(--ftre-accent-ghost)",
        // Borders
        "ftre-border": "var(--ftre-border)",
        "ftre-border-subtle": "var(--ftre-border-subtle)",
        // Text hierarchy
        "ftre-text-primary": "var(--ftre-text-primary)",
        "ftre-text-secondary": "var(--ftre-text-secondary)",
        "ftre-text-muted": "var(--ftre-text-muted)",
        "ftre-text-dim": "var(--ftre-text-dim)",
        "ftre-text-ghost": "var(--ftre-text-ghost)",
        "ftre-text-faint": "var(--ftre-text-faint)",
        // Semantic colors
        "ftre-success": "var(--ftre-success)",
        "ftre-warning": "var(--ftre-warning)",
        "ftre-error": "var(--ftre-error)",
        "ftre-info": "var(--ftre-info)",
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
 * All variables are defined in tokens.css with light/dark values.
 * No fallback values are needed — the Token file guarantees definitions.
 *
 * Background layers:
 * --ftre-base: Main background
 * --ftre-surface: Sidebar/panel background
 * --ftre-elevated: Floating elements
 * --ftre-panel: Input/card background
 * --ftre-menu-bg: Menu/dropdown background
 *
 * Brand colors:
 * --ftre-accent: Primary accent/neon green
 * --ftre-accent-hover: Accent hover state
 * --ftre-accent-dim: Low opacity accent for selection
 * --ftre-accent-ghost: Ultra-low opacity accent
 *
 * Borders:
 * --ftre-border: Primary border
 * --ftre-border-subtle: Secondary border
 *
 * Text hierarchy:
 * --ftre-text-primary: Primary text
 * --ftre-text-secondary: Secondary text
 * --ftre-text-muted: Auxiliary text
 * --ftre-text-dim: Dimmed text
 * --ftre-text-ghost: Placeholder text
 * --ftre-text-faint: Timestamp/weakest text
 *
 * Semantic colors:
 * --ftre-success: Success state
 * --ftre-warning: Warning state
 * --ftre-error: Error state
 * --ftre-info: Info/link state
 */
