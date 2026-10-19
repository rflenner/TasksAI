// Notices when the person is in a noisy room, so the voice assistants can offer
// "Noisy room" listening (app/lib/voice-audio.ts) instead of waiting for them to
// find it. Two signals: the steady background level of the microphone, and
// speech the assistant picked up but could not make words of.

// The mic's quietest moments (the 20th percentile over ~10 s, so pauses count
// and the person talking does not) louder than this, in dBFS, is a noisy room.
// The stream is already noise-suppressed by the browser, hence the low value.
export const NOISE_FLOOR_DB = -48;
const SAMPLE_MS = 200, WINDOW = 50, MIN_SAMPLES = 25;
// This many unintelligible "speech" events inside the span below is a noisy room too.
const GARBLED_COUNT = 3, GARBLED_SPAN_MS = 45000;

export const noiseFloorDb = (levels: number[]) => {
  if (levels.length < MIN_SAMPLES) return null;
  const sorted = [...levels].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.2)];
};

export const isGarbled = (transcript: string) => transcript.replace(/[^\p{L}\p{N}]/gu, "").length < 3;

// Tracks recent unintelligible speech; `note()` returns true once there is enough of it.
export function garbledTracker() {
  let times: number[] = [];
  return { note(now = Date.now()) { times = [...times.filter(t => now - t < GARBLED_SPAN_MS), now]; return times.length >= GARBLED_COUNT; } };
}

// Watches the microphone stream; calls `onNoisy(floorDb)` once when the room is
// noisy. Returns a stop function. Does nothing where Web Audio is unavailable.
export function watchBackgroundNoise(stream: MediaStream, onNoisy: (floorDb: number) => void): () => void {
  const Ctx = typeof window !== "undefined" ? (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  if (!Ctx) return () => {};
  let ctx: AudioContext;
  try { ctx = new Ctx(); } catch { return () => {}; }
  const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const levels: number[] = [];
  let fired = false;
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    levels.push(20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-6));
    if (levels.length > WINDOW) levels.shift();
    const floor = noiseFloorDb(levels);
    if (!fired && floor !== null && floor > NOISE_FLOOR_DB) { fired = true; onNoisy(floor); }
  }, SAMPLE_MS);
  return () => { clearInterval(timer); void ctx.close().catch(() => {}); };
}
