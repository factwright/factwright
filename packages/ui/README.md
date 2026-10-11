# UI

The design system the desktop app and the web view share: colors, type, spacing and components, in light and dark mode.

- **Tokens** ([`src/tokens.ts`](src/tokens.ts)): every color for both themes, the tints for pills and badges, and the fonts, type sizes, spacing and corner radii. A test checks that each text color meets WCAG AA contrast on every background it's used on.
- **Theme** ([`src/theme.ts`](src/theme.ts)): turns the tokens into CSS variables. Render `<ThemeStyle />` once, at the root. The page follows the system's light or dark setting unless an element sets `data-theme="light"` or `data-theme="dark"`, which applies to everything inside it.
- **Components** ([`src/components`](src/components)): buttons, status pills, fit badges, Claude's run status, the views switcher, search, sidebar items, stats and notices. They style themselves only through the theme's variables, and an automated accessibility check runs over all of them.

## Gallery
Every component in light and dark, side by side, for checking changes by eye at small and large window sizes:

```sh
pnpm --filter @factwright/ui gallery
```

**Status:** in progress, in phase 3 of the [roadmap](../../docs/roadmap.md). The screens come next.
