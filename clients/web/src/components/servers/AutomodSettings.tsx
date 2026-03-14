import { useState, useEffect, type FormEvent } from "react";
import type {
  AutomodConfig,
  AutomodWordFilter,
  AutomodLog,
  UpdateAutomodConfigRequest,
} from "../../types";
import { api } from "../../api/client";
import styles from "./AutomodSettings.module.css";

interface Props {
  serverId: string;
}

export function AutomodSettings({ serverId }: Props) {
  const [config, setConfig] = useState<AutomodConfig | null>(null);
  const [words, setWords] = useState<AutomodWordFilter[]>([]);
  const [logs, setLogs] = useState<AutomodLog[]>([]);
  const [tab, setTab] = useState<"rules" | "words" | "logs">("rules");
  const [newWord, setNewWord] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getAutomodConfig(serverId).catch(() => null),
      api.listWordFilters(serverId),
      api.listAutomodLogs(serverId),
    ]).then(([cfg, ws, ls]) => {
      if (cancelled) return;
      setConfig(cfg);
      setWords(ws);
      setLogs(ls);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  async function patch(updates: UpdateAutomodConfigRequest) {
    setError("");
    try {
      const updated = await api.updateAutomodConfig(serverId, updates);
      setConfig(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update config");
    }
  }

  async function handleAddWord(e: FormEvent) {
    e.preventDefault();
    const word = newWord.trim();
    if (!word) return;
    try {
      const filter = await api.addWordFilter(serverId, word);
      setWords((prev) => [...prev, filter]);
      setNewWord("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add word");
    }
  }

  async function handleRemoveWord(word: string) {
    try {
      await api.removeWordFilter(serverId, word);
      setWords((prev) => prev.filter((w) => w.word !== word));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove word");
    }
  }

  if (loading) return <div className={styles.loading}>Loading…</div>;

  const c = config ?? {
    server_id: serverId,
    enabled: false,
    spam_enabled: false,
    spam_max_messages: 5,
    spam_window_secs: 5,
    spam_action: "delete" as const,
    duplicate_enabled: false,
    word_filter_enabled: false,
    word_filter_action: "delete" as const,
    timeout_minutes: 10,
    updated_at: "",
  };

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>Auto-Moderation</h3>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.tabs}>
        <button
          className={tab === "rules" ? styles.activeTab : styles.tab}
          onClick={() => setTab("rules")}
        >
          Rules
        </button>
        <button
          className={tab === "words" ? styles.activeTab : styles.tab}
          onClick={() => setTab("words")}
        >
          Word Filter
        </button>
        <button
          className={tab === "logs" ? styles.activeTab : styles.tab}
          onClick={() => setTab("logs")}
        >
          Logs
        </button>
      </div>

      {tab === "rules" && (
        <div className={styles.rulesTab}>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              aria-label="Enable Auto-Moderation"
              checked={c.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            <span>Enable Auto-Moderation</span>
          </label>

          <fieldset className={styles.section} disabled={!c.enabled}>
            <legend className={styles.legend}>Spam Detection</legend>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={c.spam_enabled}
                onChange={(e) => patch({ spam_enabled: e.target.checked })}
              />
              <span>Enable spam detection</span>
            </label>
            {c.spam_enabled && (
              <div className={styles.subFields}>
                <label className={styles.field}>
                  Max messages
                  <input
                    type="number"
                    className={styles.numberInput}
                    min={1}
                    max={50}
                    value={c.spam_max_messages}
                    onChange={(e) =>
                      patch({ spam_max_messages: Number(e.target.value) })
                    }
                  />
                </label>
                <label className={styles.field}>
                  Per (seconds)
                  <input
                    type="number"
                    className={styles.numberInput}
                    min={1}
                    max={60}
                    value={c.spam_window_secs}
                    onChange={(e) =>
                      patch({ spam_window_secs: Number(e.target.value) })
                    }
                  />
                </label>
                <label className={styles.field}>
                  Action
                  <select
                    className={styles.select}
                    value={c.spam_action}
                    onChange={(e) =>
                      patch({
                        spam_action: e.target
                          .value as AutomodConfig["spam_action"],
                      })
                    }
                  >
                    <option value="delete">Delete message</option>
                    <option value="timeout">Timeout user</option>
                    <option value="kick">Kick user</option>
                    <option value="ban">Ban user</option>
                  </select>
                </label>
              </div>
            )}
          </fieldset>

          <fieldset className={styles.section} disabled={!c.enabled}>
            <legend className={styles.legend}>Duplicate Messages</legend>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={c.duplicate_enabled}
                onChange={(e) => patch({ duplicate_enabled: e.target.checked })}
              />
              <span>Block duplicate messages (within 30s)</span>
            </label>
          </fieldset>

          <fieldset className={styles.section} disabled={!c.enabled}>
            <legend className={styles.legend}>Word Filter</legend>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={c.word_filter_enabled}
                onChange={(e) =>
                  patch({ word_filter_enabled: e.target.checked })
                }
              />
              <span>Enable word filter</span>
            </label>
            {c.word_filter_enabled && (
              <label className={styles.field}>
                Action
                <select
                  className={styles.select}
                  value={c.word_filter_action}
                  onChange={(e) =>
                    patch({
                      word_filter_action: e.target
                        .value as AutomodConfig["word_filter_action"],
                    })
                  }
                >
                  <option value="delete">Delete message</option>
                  <option value="timeout">Timeout user</option>
                  <option value="kick">Kick user</option>
                  <option value="ban">Ban user</option>
                </select>
              </label>
            )}
            {(c.spam_action === "timeout" ||
              c.word_filter_action === "timeout") && (
              <label className={styles.field}>
                Timeout duration (minutes)
                <input
                  type="number"
                  className={styles.numberInput}
                  min={1}
                  max={10080}
                  value={c.timeout_minutes}
                  onChange={(e) =>
                    patch({ timeout_minutes: Number(e.target.value) })
                  }
                />
              </label>
            )}
          </fieldset>
        </div>
      )}

      {tab === "words" && (
        <div className={styles.wordsTab}>
          <form onSubmit={handleAddWord} className={styles.addWordForm}>
            <input
              className={styles.wordInput}
              placeholder="Add a word or phrase…"
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              maxLength={100}
            />
            <button type="submit" className={styles.addButton}>
              Add
            </button>
          </form>
          {words.length === 0 ? (
            <p className={styles.empty}>No words in filter.</p>
          ) : (
            <ul className={styles.wordList}>
              {words.map((w) => (
                <li key={w.id} className={styles.wordItem}>
                  <span className={styles.wordText}>{w.word}</span>
                  <button
                    className={styles.removeButton}
                    onClick={() => handleRemoveWord(w.word)}
                    aria-label={`Remove ${w.word}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "logs" && (
        <div className={styles.logsTab}>
          {logs.length === 0 ? (
            <p className={styles.empty}>No automod actions yet.</p>
          ) : (
            <table className={styles.logsTable}>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Rule</th>
                  <th>Action</th>
                  <th>Match</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{log.username ?? "—"}</td>
                    <td>{log.rule_type}</td>
                    <td>{log.action_taken}</td>
                    <td>{log.matched_term ?? "—"}</td>
                    <td>{new Date(log.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
