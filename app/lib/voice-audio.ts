// Listening settings shared by both live voice assistants (Task AI and the
// Close Plan page), set when the realtime session is minted. Two profiles:
// "normal" for a quiet room or a headset, and "noisy" for an open office or a
// room with other people talking, which makes the assistant harder to trigger
// (speech has to be louder and clearer before it counts, and a longer pause
// ends a turn), so background chatter neither starts a request nor cuts the
// assistant off mid-answer. Every number can be tuned without a deploy through
// the OPENAI_VAD_* environment variables.

export type ListeningMode = "normal" | "noisy";

export const parseListeningMode = (value: unknown): ListeningMode => value === "noisy" ? "noisy" : "normal";

const num = (name: string, fallback: number, min: number, max: number) => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && process.env[name] ? Math.min(max, Math.max(min, raw)) : fallback;
};

// The audio.input part of the realtime session (merged with transcription by the caller).
export function audioInputSettings(mode: ListeningMode) {
  const noisy = mode === "noisy";
  return {
    // near_field = headset or laptop mic; far_field = a mic across the room.
    noise_reduction: { type: noisy ? "far_field" : "near_field" },
    turn_detection: {
      type: "server_vad",
      threshold: noisy ? num("OPENAI_VAD_THRESHOLD_NOISY", 0.8, 0.1, 0.99) : num("OPENAI_VAD_THRESHOLD", 0.6, 0.1, 0.99),
      prefix_padding_ms: 300,
      silence_duration_ms: noisy ? num("OPENAI_VAD_SILENCE_NOISY_MS", 800, 200, 3000) : num("OPENAI_VAD_SILENCE_MS", 550, 200, 3000),
      create_response: true,
      interrupt_response: true,
    },
  };
}

// Extra guidance for the model in a noisy room, appended to its instructions.
export const NOISY_ROOM_INSTRUCTION = " The room may be noisy. Treat faint, fragmentary or unclear audio, and anything that sounds like other people talking in the background, as not meant for you: do not call a tool and do not answer. If a request is only partly audible, ask once for it again, briefly.";
