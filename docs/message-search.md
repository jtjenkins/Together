⚠️ This document has been moved to the [Together docs site](https://docs.together-chat.com/features/message-search).
Please visit the new site for the latest version.

---

# Message Search

Together supports full-text search across all messages in a server, powered by PostgreSQL's built-in full-text search engine. This guide explains how to search, what results look like, and what limitations apply.

## Opening Search

Press the search icon in the channel toolbar (or use **Ctrl+F** / **Cmd+F** if bound) to open the search modal. The modal scopes search to the current server by default. If you open it from within a channel, results are pre-filtered to that channel.

## Basic Search

Type at least **2 characters** to trigger a search. Results appear automatically after a short pause — no need to press Enter.

Each result shows:

- The author's username
- The channel the message was sent in
- The message timestamp (shown as "Today", "Yesterday", "N days ago", or a full date)
- A **highlighted excerpt** with matching terms shown in bold/highlighted

Clicking a result navigates you to that message and closes the search modal.

## How Search Works

Search uses **natural language processing** (English stemming and stop-word removal). This means:

- **Stemming**: Searching `running` also matches `run`, `runs`, `ran`
- **Stop words**: Common words like `the`, `a`, `is`, `in` are ignored — they won't produce results on their own
- **Case insensitive**: `Hello` and `hello` return the same results

Search matches **whole words** by default. There is no substring or wildcard matching (e.g., `hel` will not match `hello`).

## Filtering by Channel

When you open search from inside a channel, results are automatically filtered to that channel. A channel filter badge is shown below the search input confirming the scope.

To search across the entire server, remove the channel filter (click the `×` on the badge if present, or open search from the server level rather than a channel).

## Result Ordering

Results are ordered by **relevance first**, then **recency**. The relevance score is calculated by PostgreSQL's `ts_rank_cd()` function, which weighs:

- How frequently the search terms appear in the message
- How close together matching terms are within the message

Messages with multiple matching terms close together rank higher than messages with a single distant match.

## Pagination

Search returns up to **50 results per page** by default (maximum 100). If more results exist, a **Load More** button appears below the result list. Clicking it appends the next page of results.

The total number of matching messages is shown at the top of the results panel.

## Limitations

| Limitation                | Details                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| **Minimum query length**  | 2 characters                                                           |
| **Maximum query length**  | 200 characters                                                         |
| **Language**              | English stemming/stop-word rules only                                  |
| **Deleted messages**      | Not searchable — soft-deleted messages are excluded                    |
| **Cross-server search**   | Not supported — each search is scoped to one server                    |
| **Attachments & embeds**  | Only message text content is indexed, not file names or embed metadata |
| **Wildcards / regex**     | Not supported                                                          |
| **Exact phrase matching** | Not supported — word order is not guaranteed in results                |
| **Results per page**      | 50 default, 100 maximum                                                |

## Access Control

Search respects server membership. You must be a member of the server to search its messages. If your membership changes (e.g., you are removed from the server), existing search sessions will return a 403 error.

## API Reference

For bot developers and integrations, the search endpoint is:

```
GET /servers/:server_id/search
Authorization: Bearer <token>
```

**Query parameters:**

| Parameter    | Type    | Required | Default | Notes                          |
| ------------ | ------- | -------- | ------- | ------------------------------ |
| `q`          | string  | yes      | —       | 2–200 characters               |
| `channel_id` | UUID    | no       | —       | Restrict to one channel        |
| `before`     | UUID    | no       | —       | Pagination cursor (message ID) |
| `limit`      | integer | no       | 50      | 1–100                          |

**Response:**

```json
{
  "results": [
    {
      "id": "message-uuid",
      "channel_id": "channel-uuid",
      "author_id": "user-uuid",
      "author_username": "alice",
      "content": "The full message text here",
      "highlight": "...the full <mark>message</mark> text here...",
      "created_at": "2026-03-14T10:30:00Z",
      "rank": 0.456
    }
  ],
  "total": 127,
  "has_more": true,
  "next_cursor": "last-result-message-uuid"
}
```

The `highlight` field contains a short excerpt with matching terms wrapped in `<mark>` tags. Render it as HTML (ensure you sanitize to allow only `<mark>` elements).

To paginate, pass the `next_cursor` value as the `before` parameter in your next request.
