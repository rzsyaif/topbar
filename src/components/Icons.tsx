const base = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true } as const;

export const PlayIcon = () => (
  <svg {...base}><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" /></svg>
);
export const PauseIcon = () => (
  <svg {...base}><rect x="6" y="4.5" width="4" height="15" rx="1.2" /><rect x="14" y="4.5" width="4" height="15" rx="1.2" /></svg>
);
export const NextIcon = () => (
  <svg {...base}><path d="M4 6.2v11.6a.9.9 0 0 0 1.38.76L14 13.1V17.8a.9.9 0 0 0 1.38.76l7.5-5.8a.9.9 0 0 0 0-1.52l-7.5-5.8A.9.9 0 0 0 14 6.2v4.7L5.38 5.44A.9.9 0 0 0 4 6.2Z" /></svg>
);
export const PrevIcon = () => (
  <svg {...base} style={{ transform: "scaleX(-1)" }}><path d="M4 6.2v11.6a.9.9 0 0 0 1.38.76L14 13.1V17.8a.9.9 0 0 0 1.38.76l7.5-5.8a.9.9 0 0 0 0-1.52l-7.5-5.8A.9.9 0 0 0 14 6.2v4.7L5.38 5.44A.9.9 0 0 0 4 6.2Z" /></svg>
);
export const ResetIcon = () => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
  </svg>
);
export const SkipIcon = () => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" /><path d="m13 6 6 6-6 6" />
  </svg>
);

/** Little animated equalizer shown while music plays. */
export const Bars = ({ playing }: { playing: boolean }) => (
  <span className={`bars ${playing ? "is-playing" : ""}`} aria-hidden>
    <i /><i /><i /><i />
  </span>
);

export const CheckIcon = () => (
  <svg {...base} width={11} height={11} fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
export const CloseIcon = () => (
  <svg {...base} width={10} height={10} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
