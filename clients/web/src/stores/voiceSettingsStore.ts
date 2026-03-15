import { create } from "zustand";
import { persist } from "zustand/middleware";

export type VoiceMode = "vad" | "ptt";

interface VoiceSettingsStore {
  mode: VoiceMode;
  /**
   * VAD sensitivity: 0 = least sensitive (high threshold), 100 = most sensitive (low threshold).
   * Default 75 approximates the legacy hardcoded threshold of 15.
   */
  vadSensitivity: number;
  /** KeyboardEvent.code for the PTT key, e.g. "Space", "KeyV". */
  pttKey: string;

  setMode: (mode: VoiceMode) => void;
  setVadSensitivity: (value: number) => void;
  setPttKey: (key: string) => void;
}

/**
 * Converts a 0–100 sensitivity value to the RMS amplitude threshold used by
 * the Web Audio API analyser (0–255 scale).
 *   sensitivity 0   → threshold 50  (barely triggers)
 *   sensitivity 75  → threshold 15  (legacy default)
 *   sensitivity 100 → threshold 3   (very sensitive)
 */
export function sensitivityToThreshold(sensitivity: number): number {
  return Math.round(50 - (sensitivity / 100) * 47);
}

export const useVoiceSettingsStore = create<VoiceSettingsStore>()(
  persist(
    (set) => ({
      mode: "vad",
      vadSensitivity: 75,
      pttKey: "Space",

      setMode: (mode) => set({ mode }),
      setVadSensitivity: (vadSensitivity) => set({ vadSensitivity }),
      setPttKey: (pttKey) => set({ pttKey }),
    }),
    { name: "voice-settings" },
  ),
);
