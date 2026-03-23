import { useState, useEffect, useCallback } from "react";
import { api, ApiRequestError } from "../../api/client";
import type { InstanceSettings, RegistrationMode } from "../../types";
import styles from "./AdminSettings.module.css";

const MODE_OPTIONS: {
  value: RegistrationMode;
  label: string;
  description: string;
}[] = [
  {
    value: "open",
    label: "Open",
    description: "Anyone can create an account",
  },
  {
    value: "invite_only",
    label: "Invite-Only",
    description: "New users must have a valid invite code to register",
  },
  {
    value: "closed",
    label: "Closed",
    description: "No new registrations allowed",
  },
];

export function AdminSettings() {
  const [settings, setSettings] = useState<InstanceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<RegistrationMode>("open");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAdminSettings();
      setSettings(data);
      setSelectedMode(data.registration_mode);
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to load settings";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const updated = await api.updateAdminSettings({
        registration_mode: selectedMode,
      });
      setSettings(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to save settings";
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className={styles.loading}>Loading settings...</div>;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  const hasChanges = settings?.registration_mode !== selectedMode;

  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Registration Mode</h3>
        <p className={styles.sectionDesc}>
          Control who can create new accounts on this instance.
        </p>

        {saveSuccess && (
          <div className={styles.success}>Settings saved successfully.</div>
        )}
        {saveError && <div className={styles.inlineError}>{saveError}</div>}

        <div className={styles.radioGroup}>
          {MODE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`${styles.radioOption} ${
                selectedMode === opt.value ? styles.radioOptionSelected : ""
              }`}
            >
              <input
                type="radio"
                name="registration_mode"
                className={styles.radioInput}
                value={opt.value}
                checked={selectedMode === opt.value}
                onChange={() => setSelectedMode(opt.value)}
              />
              <div className={styles.radioContent}>
                <span className={styles.radioLabel}>{opt.label}</span>
                <span className={styles.radioDesc}>{opt.description}</span>
              </div>
            </label>
          ))}
        </div>

        <button
          className={styles.saveBtn}
          onClick={handleSave}
          disabled={saving || !hasChanges}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
