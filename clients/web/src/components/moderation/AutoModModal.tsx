import { useState, useEffect, type FormEvent } from "react";
import { Shield, Trash2, Plus, RefreshCw } from "lucide-react";
import { Modal } from "../common/Modal";
import { useAutoModStore } from "../../stores/autoModStore";
import type { AutoModAction, UpdateAutoModConfigRequest } from "../../types";
import styles from "./AutoModModal.module.css";

interface AutoModModalProps {
  open: boolean;
  onClose: () => void;
  serverId: string;
}

type Tab = "overview" | "words" | "logs";

const ACTION_LABELS: Record<AutoModAction, string> = {
  delete: "Delete message",
  timeout: "Delete + Timeout",
  kick: "Delete + Kick",
  ban: "Delete + Ban",
};

export function AutoModModal({ open, onClose, serverId }: AutoModModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const config = useAutoModStore((s) => s.config);
  const words = useAutoModStore((s) => s.words);
  const logs = useAutoModStore((s) => s.logs);
  const isLoading = useAutoModStore((s) => s.isLoading);
  const isSaving = useAutoModStore((s) => s.isSaving);
  const error = useAutoModStore((s) => s.error);
  const fetchConfig = useAutoModStore((s) => s.fetchConfig);
  const updateConfig = useAutoModStore((s) => s.updateConfig);
  const fetchWords = useAutoModStore((s) => s.fetchWords);
  const addWord = useAutoModStore((s) => s.addWord);
  const removeWord = useAutoModStore((s) => s.removeWord);
  const fetchLogs = useAutoModStore((s) => s.fetchLogs);
  const clearError = useAutoModStore((s) => s.clearError);

  // Load data when the modal opens or tab changes.
  useEffect(() => {
    if (!open) return;
    if (activeTab === "overview") fetchConfig(serverId);
    if (activeTab === "words") {
      fetchConfig(serverId);
      fetchWords(serverId);
    }
    if (activeTab === "logs") fetchLogs(serverId);
  }, [open, activeTab, serverId, fetchConfig, fetchWords, fetchLogs]);

  const handleClose = () => {
    clearError();
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Auto-Moderation">
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === "overview" ? styles.activeTab : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          <Shield size={14} />
          Overview
        </button>
        <button
          className={`${styles.tab} ${activeTab === "words" ? styles.activeTab : ""}`}
          onClick={() => setActiveTab("words")}
        >
          Word Filters
        </button>
        <button
          className={`${styles.tab} ${activeTab === "logs" ? styles.activeTab : ""}`}
          onClick={() => setActiveTab("logs")}
        >
          Audit Log
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {isLoading && !config ? (
        <div className={styles.loading}>Loading...</div>
      ) : (
        <>
          {activeTab === "overview" && (
            <OverviewTab
              serverId={serverId}
              config={config}
              isSaving={isSaving}
              updateConfig={updateConfig}
            />
          )}
          {activeTab === "words" && (
            <WordsTab
              serverId={serverId}
              words={words}
              config={config}
              isSaving={isSaving}
              updateConfig={updateConfig}
              addWord={addWord}
              removeWord={removeWord}
            />
          )}
          {activeTab === "logs" && (
            <LogsTab
              logs={logs}
              isLoading={isLoading}
              onRefresh={() => fetchLogs(serverId)}
            />
          )}
        </>
      )}
    </Modal>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────

interface OverviewTabProps {
  serverId: string;
  config: ReturnType<typeof useAutoModStore.getState>["config"];
  isSaving: boolean;
  updateConfig: (
    serverId: string,
    data: UpdateAutoModConfigRequest,
  ) => Promise<void>;
}

function OverviewTab({
  serverId,
  config,
  isSaving,
  updateConfig,
}: OverviewTabProps) {
  const [enabled, setEnabled] = useState(config?.enabled ?? false);
  const [spamEnabled, setSpamEnabled] = useState(config?.spam_enabled ?? false);
  const [spamMax, setSpamMax] = useState(
    String(config?.spam_max_messages ?? 5),
  );
  const [spamWindow, setSpamWindow] = useState(
    String(config?.spam_window_secs ?? 5),
  );
  const [spamAction, setSpamAction] = useState<AutoModAction>(
    config?.spam_action ?? "delete",
  );
  const [duplicateEnabled, setDuplicateEnabled] = useState(
    config?.duplicate_enabled ?? false,
  );
  const [timeoutMinutes, setTimeoutMinutes] = useState(
    String(config?.timeout_minutes ?? 10),
  );
  const [saveError, setSaveError] = useState("");

  // Sync local state when config loads.
  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    setSpamEnabled(config.spam_enabled);
    setSpamMax(String(config.spam_max_messages));
    setSpamWindow(String(config.spam_window_secs));
    setSpamAction(config.spam_action);
    setDuplicateEnabled(config.duplicate_enabled);
    setTimeoutMinutes(String(config.timeout_minutes));
  }, [config]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaveError("");
    try {
      await updateConfig(serverId, {
        enabled,
        spam_enabled: spamEnabled,
        spam_max_messages: parseInt(spamMax, 10) || 5,
        spam_window_secs: parseInt(spamWindow, 10) || 5,
        spam_action: spamAction,
        duplicate_enabled: duplicateEnabled,
        timeout_minutes: parseInt(timeoutMinutes, 10) || 10,
      });
    } catch {
      setSaveError("Failed to save settings");
    }
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {saveError && <div className={styles.error}>{saveError}</div>}

      <div className={styles.section}>
        <label className={styles.toggleRow}>
          <span className={styles.toggleLabel}>Enable Auto-Moderation</span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
        </label>
        <p className={styles.hint}>
          When disabled, no rules are enforced (active timeouts still apply).
        </p>
      </div>

      <div className={styles.divider} />

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Spam Detection</h3>
        <label className={styles.toggleRow}>
          <span className={styles.toggleLabel}>Enable spam filter</span>
          <input
            type="checkbox"
            checked={spamEnabled}
            onChange={(e) => setSpamEnabled(e.target.checked)}
            disabled={!enabled}
          />
        </label>
        {spamEnabled && enabled && (
          <div className={styles.subFields}>
            <div className={styles.field}>
              <label className={styles.label}>Max messages</label>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={50}
                value={spamMax}
                onChange={(e) => setSpamMax(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>within (seconds)</label>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={60}
                value={spamWindow}
                onChange={(e) => setSpamWindow(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Action</label>
              <select
                className={styles.select}
                value={spamAction}
                onChange={(e) => setSpamAction(e.target.value as AutoModAction)}
              >
                {(
                  Object.entries(ACTION_LABELS) as [AutoModAction, string][]
                ).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      <div className={styles.divider} />

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Duplicate Detection</h3>
        <label className={styles.toggleRow}>
          <span className={styles.toggleLabel}>
            Block identical messages within 30 seconds
          </span>
          <input
            type="checkbox"
            checked={duplicateEnabled}
            onChange={(e) => setDuplicateEnabled(e.target.checked)}
            disabled={!enabled}
          />
        </label>
      </div>

      <div className={styles.divider} />

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Timeout Duration</h3>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="timeout-minutes">
            Default timeout (minutes)
          </label>
          <input
            id="timeout-minutes"
            className={styles.input}
            type="number"
            min={1}
            max={10080}
            value={timeoutMinutes}
            onChange={(e) => setTimeoutMinutes(e.target.value)}
          />
          <span className={styles.hint}>
            Applied when any rule&apos;s action is set to &quot;Timeout&quot;.
          </span>
        </div>
      </div>

      <div className={styles.actions}>
        <button type="submit" className={styles.saveBtn} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}

// ── Words tab ─────────────────────────────────────────────────────────────────

interface WordsTabProps {
  serverId: string;
  words: ReturnType<typeof useAutoModStore.getState>["words"];
  config: ReturnType<typeof useAutoModStore.getState>["config"];
  isSaving: boolean;
  updateConfig: (
    serverId: string,
    data: UpdateAutoModConfigRequest,
  ) => Promise<void>;
  addWord: (serverId: string, word: string) => Promise<void>;
  removeWord: (serverId: string, wordId: string) => Promise<void>;
}

function WordsTab({
  serverId,
  words,
  config,
  isSaving,
  updateConfig,
  addWord,
  removeWord,
}: WordsTabProps) {
  const [newWord, setNewWord] = useState("");
  const [wordAction, setWordAction] = useState<AutoModAction>(
    config?.word_filter_action ?? "delete",
  );
  const [wordEnabled, setWordEnabled] = useState(
    config?.word_filter_enabled ?? false,
  );
  const [addError, setAddError] = useState("");

  useEffect(() => {
    if (!config) return;
    setWordAction(config.word_filter_action);
    setWordEnabled(config.word_filter_enabled);
  }, [config]);

  const handleAddWord = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newWord.trim();
    if (!trimmed) return;
    setAddError("");
    try {
      await addWord(serverId, trimmed);
      setNewWord("");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add word");
    }
  };

  const handleSaveSettings = async () => {
    await updateConfig(serverId, {
      word_filter_enabled: wordEnabled,
      word_filter_action: wordAction,
    });
  };

  return (
    <div className={styles.form}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Word Filter Settings</h3>
        <label className={styles.toggleRow}>
          <span className={styles.toggleLabel}>Enable word filter</span>
          <input
            type="checkbox"
            checked={wordEnabled}
            onChange={(e) => setWordEnabled(e.target.checked)}
          />
        </label>
        <div className={styles.field}>
          <label className={styles.label}>Action when triggered</label>
          <select
            className={styles.select}
            value={wordAction}
            onChange={(e) => setWordAction(e.target.value as AutoModAction)}
          >
            {(Object.entries(ACTION_LABELS) as [AutoModAction, string][]).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </select>
        </div>
        <button
          type="button"
          className={styles.saveBtn}
          onClick={handleSaveSettings}
          disabled={isSaving}
        >
          {isSaving ? "Saving..." : "Save Settings"}
        </button>
      </div>

      <div className={styles.divider} />

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Blocked Words ({words.length})</h3>
        <p className={styles.hint}>
          Words are matched case-insensitively anywhere in a message.
        </p>

        {addError && <div className={styles.error}>{addError}</div>}

        <form onSubmit={handleAddWord} className={styles.addRow}>
          <input
            className={styles.input}
            type="text"
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            placeholder="Add a word or phrase…"
            maxLength={100}
          />
          <button type="submit" className={styles.addBtn} title="Add word">
            <Plus size={16} />
          </button>
        </form>

        <div className={styles.wordList}>
          {words.length === 0 && (
            <p className={styles.empty}>No blocked words yet.</p>
          )}
          {words.map((w) => (
            <div key={w.id} className={styles.wordRow}>
              <span className={styles.wordText}>{w.word}</span>
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => removeWord(serverId, w.id)}
                title="Remove"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Logs tab ──────────────────────────────────────────────────────────────────

interface LogsTabProps {
  logs: ReturnType<typeof useAutoModStore.getState>["logs"];
  isLoading: boolean;
  onRefresh: () => void;
}

const RULE_LABELS: Record<string, string> = {
  spam: "Spam",
  duplicate: "Duplicate",
  word_filter: "Word Filter",
};

const ACTION_BADGE: Record<string, string> = {
  delete: "Delete",
  timeout: "Timeout",
  kick: "Kick",
  ban: "Ban",
};

function LogsTab({ logs, isLoading, onRefresh }: LogsTabProps) {
  return (
    <div className={styles.form}>
      <div className={styles.logsHeader}>
        <h3 className={styles.sectionTitle}>Recent Actions ({logs.length})</h3>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={onRefresh}
          disabled={isLoading}
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {logs.length === 0 && !isLoading && (
        <p className={styles.empty}>No auto-mod actions recorded yet.</p>
      )}

      <div className={styles.logList}>
        {logs.map((log) => (
          <div key={log.id} className={styles.logRow}>
            <div className={styles.logMeta}>
              <span className={styles.logUser}>{log.username}</span>
              <span
                className={`${styles.logBadge} ${styles[`badge_${log.action_taken}`] ?? ""}`}
              >
                {ACTION_BADGE[log.action_taken] ?? log.action_taken}
              </span>
              <span className={styles.logRule}>
                {RULE_LABELS[log.rule_type] ?? log.rule_type}
              </span>
            </div>
            {log.message_content && (
              <div className={styles.logContent}>
                &quot;{log.message_content}&quot;
              </div>
            )}
            {log.matched_term && (
              <div className={styles.logMatched}>
                Matched: <code>{log.matched_term}</code>
              </div>
            )}
            <div className={styles.logTime}>
              {new Date(log.created_at).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
