import { useState, useEffect, type FormEvent } from "react";
import {
  RefreshCw,
  Trash2,
  Copy,
  Check,
  Bot,
  ChevronDown,
  ChevronRight,
  Pencil,
  ScrollText,
  Settings,
  X,
} from "lucide-react";
import { api } from "../../api/client";
import type { BotDto, BotLogEntry } from "../../types";
import styles from "./BotManager.module.css";

interface BotManagerProps {
  /** Only shown when parent has confirmed this is the server owner. */
  serverId: string;
}

interface TokenRevealState {
  botId: string;
  token: string;
  copied: boolean;
}

type BotTab = "settings" | "logs";

export function BotManager({ serverId: _serverId }: BotManagerProps) {
  const [bots, setBots] = useState<BotDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Token reveal (creation or regen)
  const [tokenReveal, setTokenReveal] = useState<TokenRevealState | null>(null);

  // Per-bot action loading state
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>(
    {},
  );

  // Expanded bot detail
  const [expandedBotId, setExpandedBotId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BotTab>("settings");

  // Edit state
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState("");

  // Logs
  const [logs, setLogs] = useState<BotLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    void loadBots();
  }, []);

  async function loadBots() {
    setLoading(true);
    setError("");
    try {
      const res = await api.listBots();
      setBots(res.bots);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bots");
    } finally {
      setLoading(false);
    }
  }

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setCreateError("");
    setTokenReveal(null);
    try {
      const res = await api.createBot({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setBots((prev) => [...prev, res.bot]);
      setTokenReveal({ botId: res.bot.id, token: res.token, copied: false });
      setName("");
      setDescription("");
      setShowCreateForm(false);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create bot",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleRegen = async (botId: string) => {
    setActionLoading((prev) => ({ ...prev, [botId]: true }));
    setTokenReveal(null);
    try {
      const res = await api.regenerateBotToken(botId);
      setBots((prev) => prev.map((b) => (b.id === botId ? res.bot : b)));
      setTokenReveal({ botId, token: res.token, copied: false });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to regenerate token",
      );
    } finally {
      setActionLoading((prev) => ({ ...prev, [botId]: false }));
    }
  };

  const handleRevoke = async (botId: string, botName: string) => {
    if (
      !confirm(
        `Revoke bot "${botName}"? Its token will stop working immediately.`,
      )
    )
      return;
    setActionLoading((prev) => ({ ...prev, [botId]: true }));
    if (tokenReveal?.botId === botId) setTokenReveal(null);
    try {
      await api.revokeBot(botId);
      setBots((prev) =>
        prev.map((b) =>
          b.id === botId ? { ...b, revoked_at: new Date().toISOString() } : b,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke bot");
    } finally {
      setActionLoading((prev) => ({ ...prev, [botId]: false }));
    }
  };

  const handleCopy = (token: string, botId: string) => {
    navigator.clipboard?.writeText(token).catch(() => {});
    setTokenReveal((prev) =>
      prev?.botId === botId ? { ...prev, copied: true } : prev,
    );
    setTimeout(() => {
      setTokenReveal((prev) =>
        prev?.botId === botId ? { ...prev, copied: false } : prev,
      );
    }, 2000);
  };

  const handleExpandBot = (bot: BotDto) => {
    if (expandedBotId === bot.id) {
      setExpandedBotId(null);
      return;
    }
    setExpandedBotId(bot.id);
    setActiveTab("settings");
    setEditName(bot.name);
    setEditDescription(bot.description ?? "");
    setEditError("");
    setLogs([]);
  };

  const handleSaveEdit = async (botId: string) => {
    setEditing(true);
    setEditError("");
    try {
      const updated = await api.updateBot(botId, {
        name: editName.trim(),
        description: editDescription.trim() || null,
      });
      setBots((prev) => prev.map((b) => (b.id === botId ? updated : b)));
      setEditError("");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update bot");
    } finally {
      setEditing(false);
    }
  };

  const handleLoadLogs = async (botId: string) => {
    setLogsLoading(true);
    try {
      const res = await api.getBotLogs(botId);
      setLogs(res.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bot logs");
    } finally {
      setLogsLoading(false);
    }
  };

  const handleTabChange = (tab: BotTab, botId: string) => {
    setActiveTab(tab);
    if (tab === "logs" && logs.length === 0) {
      void handleLoadLogs(botId);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const formatTimestamp = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const eventLabel = (event: string) => {
    switch (event) {
      case "bot_created":
        return "Created";
      case "message_sent":
        return "Message";
      case "bot_revoked":
        return "Revoked";
      default:
        return event;
    }
  };

  const eventColor = (event: string) => {
    switch (event) {
      case "bot_created":
        return styles.logBadgeCreated;
      case "message_sent":
        return styles.logBadgeMessage;
      case "bot_revoked":
        return styles.logBadgeRevoked;
      default:
        return "";
    }
  };

  return (
    <div className={styles.manager}>
      <div className={styles.headerRow}>
        <h3 className={styles.heading}>Bot Management</h3>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          {showCreateForm ? (
            <>
              <X size={14} /> Cancel
            </>
          ) : (
            <>
              <Bot size={14} /> New Bot
            </>
          )}
        </button>
      </div>
      <p className={styles.hint}>
        Create bots to automate tasks in your server. Each bot gets a unique
        token for API access.
      </p>

      {/* Create bot form */}
      {showCreateForm && (
        <form onSubmit={handleCreate} className={styles.createForm}>
          <div className={styles.formFields}>
            <div className={styles.formField}>
              <label className={styles.fieldLabel} htmlFor="bot-name">
                Name
              </label>
              <input
                id="bot-name"
                className={styles.input}
                type="text"
                placeholder="My Bot"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                required
                autoFocus
              />
            </div>
            <div className={styles.formField}>
              <label className={styles.fieldLabel} htmlFor="bot-desc">
                Description <span className={styles.optional}>(optional)</span>
              </label>
              <input
                id="bot-desc"
                className={styles.input}
                type="text"
                placeholder="What does this bot do?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={512}
              />
            </div>
          </div>
          <button
            type="submit"
            className={styles.createBtn}
            disabled={!name.trim() || creating}
          >
            <Bot size={14} />
            {creating ? "Creating…" : "Create Bot"}
          </button>
          {createError && (
            <div className={styles.error} role="alert">
              {createError}
            </div>
          )}
        </form>
      )}

      {/* Token reveal banner */}
      {tokenReveal && (
        <div className={styles.tokenBanner}>
          <p className={styles.tokenLabel}>
            Copy this token now — it will not be shown again.
          </p>
          <div className={styles.tokenRow}>
            <code className={styles.tokenBox}>{tokenReveal.token}</code>
            <button
              type="button"
              className={styles.copyBtn}
              onClick={() => handleCopy(tokenReveal.token, tokenReveal.botId)}
              title="Copy token"
            >
              {tokenReveal.copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <p className={styles.tokenWarning}>
            Use this token as <code>Authorization: Bot {"<token>"}</code>
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {/* Bot list */}
      {loading ? (
        <p className={styles.empty}>Loading bots…</p>
      ) : bots.length === 0 ? (
        <p className={styles.empty}>
          No bots yet. Click &ldquo;New Bot&rdquo; above to create one.
        </p>
      ) : (
        <div className={styles.list}>
          {bots.map((bot) => {
            const revoked = bot.revoked_at !== null;
            const busy = actionLoading[bot.id] ?? false;
            const expanded = expandedBotId === bot.id;
            return (
              <div
                key={bot.id}
                className={`${styles.botCard} ${revoked ? styles.revoked : ""}`}
              >
                {/* Bot summary row */}
                <button
                  type="button"
                  className={styles.botSummary}
                  onClick={() => handleExpandBot(bot)}
                >
                  <span className={styles.expandIcon}>
                    {expanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </span>
                  <Bot size={16} className={styles.botIcon} />
                  <div className={styles.botInfo}>
                    <div className={styles.botHeader}>
                      <span className={styles.botName}>{bot.name}</span>
                      {revoked && (
                        <span className={styles.revokedBadge}>Revoked</span>
                      )}
                    </div>
                    {bot.description && (
                      <p className={styles.botDesc}>{bot.description}</p>
                    )}
                  </div>
                  <span className={styles.botDate}>
                    {formatDate(bot.created_at)}
                  </span>
                </button>

                {/* Expanded detail */}
                {expanded && (
                  <div className={styles.botDetail}>
                    {/* Tabs */}
                    <div className={styles.tabBar}>
                      <button
                        type="button"
                        className={`${styles.tab} ${activeTab === "settings" ? styles.tabActive : ""}`}
                        onClick={() => handleTabChange("settings", bot.id)}
                      >
                        <Settings size={13} /> Settings
                      </button>
                      <button
                        type="button"
                        className={`${styles.tab} ${activeTab === "logs" ? styles.tabActive : ""}`}
                        onClick={() => handleTabChange("logs", bot.id)}
                      >
                        <ScrollText size={13} /> Logs
                      </button>
                    </div>

                    {/* Settings tab */}
                    {activeTab === "settings" && (
                      <div className={styles.settingsPanel}>
                        <div className={styles.metaRow}>
                          <span className={styles.metaLabel}>Bot ID</span>
                          <code className={styles.metaValue}>{bot.id}</code>
                        </div>
                        <div className={styles.metaRow}>
                          <span className={styles.metaLabel}>User ID</span>
                          <code className={styles.metaValue}>
                            {bot.user_id}
                          </code>
                        </div>
                        <div className={styles.metaRow}>
                          <span className={styles.metaLabel}>Created</span>
                          <span className={styles.metaValue}>
                            {formatDate(bot.created_at)}
                          </span>
                        </div>
                        {revoked && (
                          <div className={styles.metaRow}>
                            <span className={styles.metaLabel}>Revoked</span>
                            <span className={styles.metaValue}>
                              {formatDate(bot.revoked_at!)}
                            </span>
                          </div>
                        )}

                        {!revoked && (
                          <>
                            <hr className={styles.divider} />
                            <div className={styles.editSection}>
                              <h4 className={styles.editHeading}>
                                <Pencil size={13} /> Edit Bot
                              </h4>
                              <div className={styles.formField}>
                                <label
                                  className={styles.fieldLabel}
                                  htmlFor={`edit-name-${bot.id}`}
                                >
                                  Name
                                </label>
                                <input
                                  id={`edit-name-${bot.id}`}
                                  className={styles.input}
                                  type="text"
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  maxLength={64}
                                />
                              </div>
                              <div className={styles.formField}>
                                <label
                                  className={styles.fieldLabel}
                                  htmlFor={`edit-desc-${bot.id}`}
                                >
                                  Description
                                </label>
                                <input
                                  id={`edit-desc-${bot.id}`}
                                  className={styles.input}
                                  type="text"
                                  value={editDescription}
                                  onChange={(e) =>
                                    setEditDescription(e.target.value)
                                  }
                                  maxLength={512}
                                  placeholder="What does this bot do?"
                                />
                              </div>
                              {editError && (
                                <div className={styles.error} role="alert">
                                  {editError}
                                </div>
                              )}
                              <button
                                type="button"
                                className={styles.saveBtn}
                                onClick={() => handleSaveEdit(bot.id)}
                                disabled={editing || !editName.trim()}
                              >
                                {editing ? "Saving…" : "Save Changes"}
                              </button>
                            </div>

                            <hr className={styles.divider} />
                            <div className={styles.dangerZone}>
                              <h4 className={styles.dangerHeading}>
                                Token & Access
                              </h4>
                              <div className={styles.dangerActions}>
                                <button
                                  type="button"
                                  className={styles.regenBtn}
                                  onClick={() => handleRegen(bot.id)}
                                  disabled={busy}
                                  title="Regenerate token"
                                >
                                  <RefreshCw size={13} />
                                  Regenerate Token
                                </button>
                                <button
                                  type="button"
                                  className={styles.revokeBtn}
                                  onClick={() => handleRevoke(bot.id, bot.name)}
                                  disabled={busy}
                                  title="Revoke bot"
                                >
                                  <Trash2 size={13} />
                                  Revoke Bot
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Logs tab */}
                    {activeTab === "logs" && (
                      <div className={styles.logsPanel}>
                        {logsLoading ? (
                          <p className={styles.empty}>Loading logs…</p>
                        ) : logs.length === 0 ? (
                          <p className={styles.empty}>
                            No activity recorded yet.
                          </p>
                        ) : (
                          <div className={styles.logList}>
                            {logs.map((log, i) => (
                              <div key={i} className={styles.logEntry}>
                                <span className={styles.logTime}>
                                  {formatTimestamp(log.timestamp)}
                                </span>
                                <span
                                  className={`${styles.logBadge} ${eventColor(log.event)}`}
                                >
                                  {eventLabel(log.event)}
                                </span>
                                {log.detail && (
                                  <span className={styles.logDetail}>
                                    {log.detail}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          className={styles.refreshLogsBtn}
                          onClick={() => handleLoadLogs(bot.id)}
                          disabled={logsLoading}
                        >
                          <RefreshCw size={13} />
                          Refresh
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
