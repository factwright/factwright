/** Factwright's mark: a checked box, for a fact that holds up. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="6" fill="var(--fw-accent)" />
      <path
        d="M7.5 12.5l3 3 6-7"
        fill="none"
        stroke="var(--fw-accent-ink)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
