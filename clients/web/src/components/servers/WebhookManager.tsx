import { useState, useEffect, useCallback, type FormEvent } from "react";
import { Webhook, Trash2, Copy, Check, Send, Power } from "lucide-react";
import { api } from "../../api/client";
import type { WebhookDto, WebhookEventType } from "../../types";
import styles from "./WebhookManager.module.css";

const ALL_EVENT_TYPES: WebhookEventType[] = [
  "message.created",
  "message.updated",
  "message.deleted",
  "member.joined",
  "member.left",
];

interface WebhookManagerProps {
  serverId: string;
}

interface SecretRevealState {
  webhookId: string;
  secret: string;
  copied: boolean;
}

export function WebhookManager({ serverId }: WebhookManagerProps) {
  const [webhooks, setWebhooks] = useState<WebhookDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create form
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<Set<WebhookEventType>>(
    new Set(["message.created"]),
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Secret reveal (creation only)
  const [secretReveal, setSecretReveal] = useState<SecretRevealState | null>(
    null,
  );

  // Per-webhook action loading state
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>(
    {},
  );

  const loadWebhooks = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.listWebhooks(serverId);
      setWebhooks(res.webhooks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void loadWebhooks();
  }, [loadWebhooks]);

  const toggleEventType = (type: WebhookEventType) => {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim() || selectedEvents.size === 0) return;
    setCreating(true);
    setCreateError("");
    setSecretReveal(null);
    try {
      const res = await api.createWebhook(serverId, {
        name: name.trim(),
        url: url.trim(),
        event_types: Array.from(selectedEvents),
      });
      setWebhooks((prev) => [...prev, res.webhook]);
      setSecretReveal({
        webhookId: res.webhook.id,
        secret: res.secret,
        copied: false,
      });
      setName("");
      setUrl("");
      setSelectedEvents(new Set(["message.created"]));
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create webhook",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleTest = async (webhookId: string) => {
    setActionLoading((prev) => ({ ...prev, [webhookId]: true }));
    try {
      await api.testWebhook(serverId, webhookId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send test");
    } finally {
      setActionLoading((prev) => ({ ...prev, [webhookId]: false }));
    }
  };

  const handleToggle = async (wh: WebhookDto) => {
    setActionLoading((prev) => ({ ...prev, [wh.id]: true }));
    try {
      const updated = await api.updateWebhook(serverId, wh.id, {
        enabled: !wh.enabled,
      });
      setWebhooks((prev) => prev.map((w) => (w.id === wh.id ? updated : w)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update webhook");
    } finally {
      setActionLoading((prev) => ({ ...prev, [wh.id]: false }));
    }
  };

  const handleDelete = async (webhookId: string, webhookName: string) => {
    if (!confirm(`Delete webhook "${webhookName}"? This cannot be undone.`))
      return;
    setActionLoading((prev) => ({ ...prev, [webhookId]: true }));
    if (secretReveal?.webhookId === webhookId) setSecretReveal(null);
    try {
      await api.deleteWebhook(serverId, webhookId);
      setWebhooks((prev) => prev.filter((w) => w.id !== webhookId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete webhook");
    } finally {
      setActionLoading((prev) => ({ ...prev, [webhookId]: false }));
    }
  };

  const handleCopySecret = (secret: string, webhookId: string) => {
    navigator.clipboard?.writeText(secret).catch(() => {});
    setSecretReveal((prev) =>
      prev?.webhookId === webhookId ? { ...prev, copied: true } : prev,
    );
    setTimeout(() => {
      setSecretReveal((prev) =>
        prev?.webhookId === webhookId ? { ...prev, copied: false } : prev,
      );
    }, 2000);
  };

  return (
    <div className={styles.manager}>
      <h3 className={styles.heading}>Webhooks</h3>
      <p className={styles.hint}>
        Send real-time event notifications to external services via HTTP POST.
        Payloads are signed with HMAC-SHA256.
      </p>

      {/* Create webhook form */}
      <form onSubmit={handleCreate} className={styles.createForm}>
        <div className={styles.formRow}>
          <input
            className={styles.nameInput}
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
          />
          <input
            className={styles.urlInput}
            type="url"
            placeholder="https://your-service.example/hook"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            maxLength={2000}
            required
          />
        </div>
        <div className={styles.eventCheckboxes}>
          {ALL_EVENT_TYPES.map((type) => (
            <label key={type} className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={selectedEvents.has(type)}
                onChange={() => toggleEventType(type)}
              />
              {type}
            </label>
          ))}
        </div>
        <button
          type="submit"
          className={styles.createBtn}
          disabled={
            !name.trim() || !url.trim() || selectedEvents.size === 0 || creating
          }
        >
          <Webhook size={14} />
          {creating ? "Creating…" : "Create Webhook"}
        </button>
      </form>
      {createError && (
        <div className={styles.error} role="alert">
          {createError}
        </div>
      )}

      {/* Secret reveal banner */}
      {secretReveal && (
        <div className={styles.secretBanner}>
          <p className={styles.secretLabel}>
            Copy this signing secret now — it will not be shown again.
          </p>
          <div className={styles.secretRow}>
            <code className={styles.secretBox}>{secretReveal.secret}</code>
            <button
              type="button"
              className={styles.copyBtn}
              onClick={() =>
                handleCopySecret(secretReveal.secret, secretReveal.webhookId)
              }
              title="Copy secret"
            >
              {secretReveal.copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <p className={styles.secretWarning}>
            Verify incoming requests by checking{" "}
            <code>
              X-Together-Signature-256: sha256=HMAC-SHA256(secret, body)
            </code>
          </p>
        </div>
      )}

      {/* Webhook list */}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className={styles.empty}>Loading webhooks…</p>
      ) : webhooks.length === 0 ? (
        <p className={styles.empty}>No webhooks yet. Create one above.</p>
      ) : (
        <div className={styles.list}>
          {webhooks.map((wh) => {
            const busy = actionLoading[wh.id] ?? false;
            return (
              <div
                key={wh.id}
                className={`${styles.webhookRow} ${!wh.enabled ? styles.disabled : ""}`}
              >
                <div className={styles.webhookInfo}>
                  <div className={styles.webhookHeader}>
                    <span className={styles.webhookName}>{wh.name}</span>
                    {!wh.enabled && (
                      <span className={styles.disabledBadge}>Disabled</span>
                    )}
                    {wh.delivery_failures > 0 && (
                      <span className={styles.failureBadge}>
                        {wh.delivery_failures} failure
                        {wh.delivery_failures !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <p className={styles.webhookUrl}>{wh.url}</p>
                  <div className={styles.eventTags}>
                    {wh.event_types.map((t) => (
                      <span key={t} className={styles.eventTag}>
                        {t}
                      </span>
                    ))}
                  </div>
                  <p className={styles.webhookMeta}>
                    Created{" "}
                    {new Date(wh.created_at).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                    {wh.last_used_at &&
                      ` · Last delivery ${new Date(wh.last_used_at).toLocaleDateString()}`}
                  </p>
                </div>
                <div className={styles.webhookActions}>
                  <button
                    type="button"
                    className={styles.testBtn}
                    onClick={() => handleTest(wh.id)}
                    disabled={busy || !wh.enabled}
                    title="Send test event"
                  >
                    <Send size={13} />
                    Test
                  </button>
                  <button
                    type="button"
                    className={styles.toggleBtn}
                    onClick={() => handleToggle(wh)}
                    disabled={busy}
                    title={wh.enabled ? "Disable webhook" : "Enable webhook"}
                  >
                    <Power size={13} />
                    {wh.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    onClick={() => handleDelete(wh.id, wh.name)}
                    disabled={busy}
                    title="Delete webhook"
                  >
                    <Trash2 size={13} />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
