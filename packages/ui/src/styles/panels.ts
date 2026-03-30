/**
 * Shared panel styles — reusable style objects for consistent UI.
 * Replaces inline styles with centralized definitions.
 * Phase G — Design System.
 *
 * Note: CSS Modules require esbuild plugin configuration. These TypeScript
 * style objects work immediately with the current build pipeline and provide
 * the same benefits (consistency, reuse, type safety).
 */

import { colors, fonts, sizes } from './tokens.js';
import type { CSSProperties } from 'react';

/** Full-screen overlay backdrop. */
export const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 300,
  background: colors.bg.overlay,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/** Modal card with SC2-style chamfer. */
export const modalCard: CSSProperties = {
  background: `linear-gradient(180deg, ${colors.bg.secondary} 0%, ${colors.bg.primary} 100%)`,
  border: `1px solid ${colors.border.primary}`,
  fontFamily: fonts.mono,
  boxShadow: '0 4px 32px rgba(0,0,0,0.85)',
  clipPath: 'polygon(16px 0, 100% 0, 100% 100%, 0 100%, 0 16px)',
  padding: `${sizes.spacing.lg}px ${sizes.spacing.xl}px`,
};

/** Section header in a modal. */
export const modalHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  marginBottom: sizes.spacing.lg,
};

/** Header title text. */
export const modalTitle: CSSProperties = {
  flex: 1,
  fontSize: sizes.text.sm,
  fontWeight: 700,
  color: colors.text.secondary,
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
};

/** Close button (✕) in modal header. */
export const closeButton: CSSProperties = {
  background: 'none',
  border: 'none',
  color: colors.text.muted,
  cursor: 'pointer',
  fontSize: sizes.text.lg,
  padding: 0,
  lineHeight: 1,
};

/** Grid cell in a metrics/overview panel. */
export const gridCell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

/** Label text (dim, small). */
export const labelText: CSSProperties = {
  fontSize: sizes.text.xs,
  color: colors.text.dim,
  letterSpacing: '0.04em',
};

/** Value text (bright, larger). */
export const valueText: CSSProperties = {
  fontSize: sizes.text.md,
  color: colors.text.primary,
  fontFamily: fonts.mono,
};

/** Primary action button (green border, gradient bg). */
export const primaryButton: CSSProperties = {
  padding: '4px 10px',
  border: `1px solid ${colors.border.active}`,
  background: `linear-gradient(180deg, #1a3828 0%, #0f2018 100%)`,
  color: '#50c070',
  fontSize: sizes.text.sm - 1,
  fontFamily: fonts.mono,
  cursor: 'pointer',
  flexShrink: 0,
};

/** Secondary / ghost button. */
export const ghostButton: CSSProperties = {
  padding: '4px 10px',
  border: `1px solid ${colors.border.subtle}`,
  background: 'transparent',
  color: colors.text.dim,
  fontSize: sizes.text.sm - 1,
  fontFamily: fonts.mono,
  cursor: 'pointer',
};

/** Table header row. */
export const tableHeader: CSSProperties = {
  display: 'flex',
  gap: sizes.spacing.sm,
  padding: `${sizes.spacing.xs}px 0`,
  borderBottom: `1px solid ${colors.border.subtle}`,
  fontSize: sizes.text.xs,
  color: colors.text.dim,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
};
