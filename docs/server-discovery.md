# Server Discovery

Together includes a server browser that lets you find and join public communities without needing an invite link. This guide covers browsing, joining, making your server discoverable, and the privacy implications of doing so.

## Browsing Public Servers

Open the server browser from the sidebar by clicking **Browse Servers** (the compass icon next to your server list, or via the **+** menu → **Browse Public Servers**).

The browser shows up to **50 public servers**, ordered by member count (largest first), then by creation date. Each listing displays:

- Server name and icon
- Member count
- A **Join** button (or a **Joined** badge if you're already a member)

There is no pagination — the list is intentionally kept to the top 50 most active communities to keep discovery simple. If a server you're looking for doesn't appear, ask for a direct invite link instead.

## Filtering and Search

The server browser supports client-side filtering while the list is loaded:

- **Name filter**: Type in the search box to filter the visible list by server name (case-insensitive, substring match).
- **Joined / Not joined**: Toggle the **Hide Joined** checkbox to show only servers you haven't joined yet.

These filters apply to the already-loaded list of 50 servers — they do not trigger a new request to the server.

## Joining a Server

Click **Join** on any server card. You'll be added as a member immediately. The server appears in your sidebar and you can start reading channels straight away.

You can join any number of public servers. There is no approval step or invite required for public servers.

> **Note**: If a server's owner changes its visibility to private after you've joined, you keep your membership. The change only prevents new members from joining via discovery.

## Making Your Server Discoverable

Only server **owners** can change a server's discovery visibility.

### During Server Creation

In the **Create Server** dialog, check **Make this server public** before confirming. The server will appear in the browser immediately.

### After Creation

1. Open your server's **Settings** (gear icon next to the server name).
2. Go to the **General** tab.
3. Toggle **Public server** on or off.
4. Click **Save**.

Changes take effect immediately. Turning it on adds the server to the browse list; turning it off removes it.

## Privacy Considerations

Before making a server public, consider what that exposes:

| What becomes visible              | To whom                          |
| --------------------------------- | -------------------------------- |
| Server name                       | Any logged-in user               |
| Server icon                       | Any logged-in user               |
| Member count                      | Any logged-in user               |
| Channel names and message content | Only members (unchanged)         |
| Owner identity                    | Not shown in the browser listing |

**What stays private**: Message history, channel names, member lists, and roles are never exposed by the discovery feature. The browse endpoint only returns the server name, icon, member count, and creation date.

**Who can see your server**: Only authenticated users can call the browse endpoint — unauthenticated requests are rejected. The server list is not publicly crawlable.

**Leaving vs. the server going private**: If the owner sets `is_public = false`, the server disappears from discovery. Existing members are unaffected. New users cannot join via the browser; they need an invite (invite links are not yet implemented — see the roadmap).

**Joining a public server**: When you join, the server owner and members with permission to view the member list will see you. Your username is visible to other members in the normal way.

## API Reference

For bot developers and integrations:

### Browse public servers

```
GET /servers/browse
Authorization: Bearer <token>
```

No query parameters. Returns up to 50 servers ordered by member count descending.

**Response:**

```json
[
  {
    "id": "server-uuid",
    "name": "Cool Gaming Community",
    "owner_id": "owner-uuid",
    "icon_url": "https://example.com/icon.png",
    "is_public": true,
    "member_count": 142,
    "created_at": "2026-01-15T09:00:00Z",
    "updated_at": "2026-03-10T14:22:00Z"
  }
]
```

### Join a public server

```
POST /servers/:server_id/join
Authorization: Bearer <token>
```

No request body. Returns `201 Created` on success, `409 Conflict` if already a member. Returns `404 Not Found` for private servers (to avoid leaking their existence).

### Create a public server

```
POST /servers
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My Community",
  "icon_url": "https://example.com/icon.png",
  "is_public": true
}
```

`is_public` defaults to `false` if omitted.

### Update server visibility

```
PATCH /servers/:server_id
Authorization: Bearer <token>
Content-Type: application/json

{
  "is_public": true
}
```

Only the server owner can call this endpoint. All fields are optional; omitted fields are unchanged.
