// The Live Voice Assistant's icon: seven rounded sound bars, tallest in the
// middle. Drawn in currentColor so it takes whatever colour its button or
// status gives it. With `live` the bars move (see .voice-wave-live in
// globals.css) — used while the assistant is listening; still otherwise.
const BARS: Array<[number, number, number]> = [
  [68, 226, 338], [132, 130, 434], [196, 178, 386], [260, 66, 482], [324, 178, 386], [388, 130, 434], [452, 226, 338],
];

export default function VoiceWaveIcon({ className = "h-4 w-4", live = false }: { className?: string; live?: boolean }) {
  return (
    <svg viewBox="36 34 448 480" className={`shrink-0 ${className} ${live ? "voice-wave-live" : ""}`} fill="none" stroke="currentColor" strokeWidth={32} strokeLinecap="round" aria-hidden="true" focusable="false">
      {BARS.map(([x, y1, y2]) => <line key={x} x1={x} y1={y1} x2={x} y2={y2} />)}
    </svg>
  );
}
