// Violet tile with a voice waveform — the app files what you say.
export default function Brand({ size = 32 }: { size?: number }) {
  return (
    <span className="inline-flex items-center justify-center rounded-[10px] bg-primary shrink-0"
      style={{ width: size, height: size }} aria-hidden>
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 18 18" fill="none">
        {[[2, 7, 11], [6, 4, 14], [10, 2, 16], [14, 6, 12]].map(([x, y1, y2]) => (
          <line key={x} x1={x + 1} y1={y1} x2={x + 1} y2={y2} stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        ))}
      </svg>
    </span>
  );
}
