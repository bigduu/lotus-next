import type { CSSProperties } from "react"

/** Bind typography to the app palette, including live light/dark/accent changes.
 * Tailwind's default gray prose palette is independent of our theme tokens. */
export const markdownTheme = {
  "--tw-prose-body": "var(--foreground)",
  "--tw-prose-headings": "var(--foreground)",
  "--tw-prose-lead": "var(--muted-foreground)",
  "--tw-prose-links": "var(--primary)",
  "--tw-prose-bold": "var(--foreground)",
  "--tw-prose-counters": "var(--muted-foreground)",
  "--tw-prose-bullets": "var(--muted-foreground)",
  "--tw-prose-hr": "var(--border)",
  "--tw-prose-quotes": "var(--muted-foreground)",
  "--tw-prose-quote-borders": "var(--border)",
  "--tw-prose-captions": "var(--muted-foreground)",
  "--tw-prose-code": "var(--foreground)",
  "--tw-prose-pre-code": "var(--foreground)",
  "--tw-prose-pre-bg": "var(--card)",
  "--tw-prose-th-borders": "var(--border)",
  "--tw-prose-td-borders": "var(--border)",
} as CSSProperties
