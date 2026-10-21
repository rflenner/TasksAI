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

// Both profiles, sent to the browser so it can switch a running session (session.update) when asked to.
export const audioInputProfiles = () => ({ normal: audioInputSettings("normal"), noisy: audioInputSettings("noisy") });

// Transcription settings for the audit trail and the on-screen "heard" line. Without a language the transcriber
// guessed Chinese for background noise ("是", "嗯"), and a vocabulary hint helps with names and terms it kept
// mishearing (internal as "Intel", CluePoints as "clue points").
export function transcriptionSettings(model: string, vocabulary: string[]) {
  const words = [...new Set(vocabulary.map(w => w.trim()).filter(Boolean))].slice(0, 60).join(", ");
  return { model, language: "en", prompt: `Business conversation about tasks and plans. Words that may come up: internal, shared, milestone, phase, subtask, overdue, ${words}.`.slice(0, 600) };
}

// Added to the instructions of both assistants after the audit trail showed the model talking on its own.
export const NO_CHATTER_INSTRUCTION = " Never say anything like 'got it', 'let me check', 'let me think' or 'sure' before or while a tool runs: stay completely silent until the tool returns, then speak only its spokenAnswer. If spokenAnswer is empty, say nothing at all. Never answer a question about the plan or the tasks from your own knowledge, not even a general one like what a phase is: call the tool. Do not comment on, repeat or acknowledge background sounds.";

// Extra guidance for the model in a noisy room, appended to its instructions.
export const NOISY_ROOM_INSTRUCTION = " The room may be noisy. Treat faint, fragmentary or unclear audio, and anything that sounds like other people talking in the background, as not meant for you: do not call a tool and do not answer. If a request is only partly audible, ask once for it again, briefly.";
