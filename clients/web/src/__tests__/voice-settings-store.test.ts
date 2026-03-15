import { describe, it, expect, beforeEach } from "vitest";
import {
  useVoiceSettingsStore,
  sensitivityToThreshold,
} from "../stores/voiceSettingsStore";

// Reset zustand store state between tests
beforeEach(() => {
  useVoiceSettingsStore.setState({
    mode: "vad",
    vadSensitivity: 75,
    pttKey: "Space",
  });
});

describe("sensitivityToThreshold", () => {
  it("returns 50 at sensitivity 0 (least sensitive)", () => {
    expect(sensitivityToThreshold(0)).toBe(50);
  });

  it("returns ~15 at sensitivity 75 (matches legacy default)", () => {
    expect(sensitivityToThreshold(75)).toBe(15);
  });

  it("returns 3 at sensitivity 100 (most sensitive)", () => {
    expect(sensitivityToThreshold(100)).toBe(3);
  });

  it("returns a value between 3 and 50 for intermediate sensitivities", () => {
    const threshold = sensitivityToThreshold(50);
    expect(threshold).toBeGreaterThanOrEqual(3);
    expect(threshold).toBeLessThanOrEqual(50);
  });

  it("produces lower threshold for higher sensitivity (more triggers)", () => {
    expect(sensitivityToThreshold(90)).toBeLessThan(sensitivityToThreshold(10));
  });
});

describe("useVoiceSettingsStore", () => {
  it("has correct initial state", () => {
    const state = useVoiceSettingsStore.getState();
    expect(state.mode).toBe("vad");
    expect(state.vadSensitivity).toBe(75);
    expect(state.pttKey).toBe("Space");
  });

  it("setMode switches to ptt", () => {
    useVoiceSettingsStore.getState().setMode("ptt");
    expect(useVoiceSettingsStore.getState().mode).toBe("ptt");
  });

  it("setMode switches back to vad", () => {
    useVoiceSettingsStore.getState().setMode("ptt");
    useVoiceSettingsStore.getState().setMode("vad");
    expect(useVoiceSettingsStore.getState().mode).toBe("vad");
  });

  it("setVadSensitivity updates sensitivity", () => {
    useVoiceSettingsStore.getState().setVadSensitivity(40);
    expect(useVoiceSettingsStore.getState().vadSensitivity).toBe(40);
  });

  it("setVadSensitivity accepts boundary values", () => {
    useVoiceSettingsStore.getState().setVadSensitivity(0);
    expect(useVoiceSettingsStore.getState().vadSensitivity).toBe(0);

    useVoiceSettingsStore.getState().setVadSensitivity(100);
    expect(useVoiceSettingsStore.getState().vadSensitivity).toBe(100);
  });

  it("setPttKey updates the ptt key binding", () => {
    useVoiceSettingsStore.getState().setPttKey("KeyV");
    expect(useVoiceSettingsStore.getState().pttKey).toBe("KeyV");
  });

  it("setPttKey accepts modifier key codes", () => {
    useVoiceSettingsStore.getState().setPttKey("AltLeft");
    expect(useVoiceSettingsStore.getState().pttKey).toBe("AltLeft");
  });
});
