// Icons for the system controls. 24×24 grid, stroked, currentColor.
const s = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export const WifiIcon = () => (
  <svg {...s}>
    <path d="M2.5 8.8a14 14 0 0 1 19 0" />
    <path d="M5.8 12.4a9 9 0 0 1 12.4 0" />
    <path d="M9.1 15.9a4.3 4.3 0 0 1 5.8 0" />
    <circle cx="12" cy="19.2" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

export const BluetoothIcon = () => (
  <svg {...s}>
    <path d="m7 7 10 10-5 4.5V2.5L17 7 7 17" />
  </svg>
);

export const SpeakerIcon = ({ level, muted }: { level: number; muted: boolean }) => (
  <svg {...s}>
    <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" />
    {muted ? (
      <path d="m16 9.5 5 5m0-5-5 5" />
    ) : (
      <>
        {level > 0.02 && <path d="M15.5 9.6a3.6 3.6 0 0 1 0 4.8" />}
        {level > 0.5 && <path d="M18.2 7a7.4 7.4 0 0 1 0 10" />}
      </>
    )}
  </svg>
);

export const SunIcon = () => (
  <svg {...s}>
    <circle cx="12" cy="12" r="3.6" fill="currentColor" />
    <path d="M12 2.8v1.8M12 19.4v1.8M2.8 12h1.8M19.4 12h1.8M5.5 5.5l1.3 1.3M17.2 17.2l1.3 1.3M5.5 18.5l1.3-1.3M17.2 6.8l1.3-1.3" />
  </svg>
);

/** Wi-Fi strength, 0–4 bars, as filled arcs. */
export const SignalIcon = ({ bars }: { bars: number }) => {
  const on = (n: number) => (bars >= n ? 1 : 0.25);
  return (
    <svg {...s} width={14} height={14}>
      <path d="M2.5 8.8a14 14 0 0 1 19 0" opacity={on(4)} />
      <path d="M5.8 12.4a9 9 0 0 1 12.4 0" opacity={on(3)} />
      <path d="M9.1 15.9a4.3 4.3 0 0 1 5.8 0" opacity={on(2)} />
      <circle cx="12" cy="19.2" r="1.3" fill="currentColor" stroke="none" opacity={on(1)} />
    </svg>
  );
};

export const LockIcon = () => (
  <svg {...s} width={11} height={11} strokeWidth={2.6}>
    <rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor" stroke="none" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </svg>
);

export const GearIcon = () => (
  <svg {...s} width={14} height={14}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);

export const RefreshIcon = () => (
  <svg {...s} width={14} height={14}>
    <path d="M20 11a8 8 0 1 0-2.3 6" />
    <path d="M20 4v7h-7" />
  </svg>
);

export const ArrowIcon = () => (
  <svg {...s} width={13} height={13} strokeWidth={2.6}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/** Picks a device glyph from the Bluetooth device's name. */
export const DeviceIcon = ({ name }: { name: string }) => {
  const n = name.toLowerCase();
  if (/(bud|pod|headphone|headset|wh-|wf-|earphone|beats|jbl|sony|qc|tws)/.test(n))
    return (
      <svg {...s} width={14} height={14}>
        <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
        <rect x="3" y="14" width="4.5" height="7" rx="1.6" fill="currentColor" stroke="none" />
        <rect x="16.5" y="14" width="4.5" height="7" rx="1.6" fill="currentColor" stroke="none" />
      </svg>
    );
  if (/(keyboard|keys|mx keys|k\d)/.test(n))
    return (
      <svg {...s} width={14} height={14}>
        <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
        <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8" />
      </svg>
    );
  if (/(mouse|mx master|trackpad|mx anywhere)/.test(n))
    return (
      <svg {...s} width={14} height={14}>
        <rect x="6.5" y="3" width="11" height="18" rx="5.5" />
        <path d="M12 7v3" />
      </svg>
    );
  if (/(phone|iphone|galaxy|pixel|redmi|oppo|vivo)/.test(n))
    return (
      <svg {...s} width={14} height={14}>
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
        <path d="M11 18.5h2" />
      </svg>
    );
  return <BluetoothIcon />;
};

/** Screen record: a ring with a solid dot. */
export const RecordIcon = () => (
  <svg {...s}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
  </svg>
);
