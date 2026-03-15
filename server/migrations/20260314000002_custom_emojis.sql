CREATE TABLE custom_emojis (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id    UUID        NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    created_by   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT        NOT NULL
                             CONSTRAINT custom_emoji_name_format
                             CHECK (name ~ '^[a-z0-9_-]{1,32}$'),
    filename     TEXT        NOT NULL,
    content_type TEXT        NOT NULL,
    file_size    BIGINT      NOT NULL
                             CONSTRAINT custom_emoji_max_size CHECK (file_size <= 262144),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT custom_emojis_server_name_unique UNIQUE (server_id, name)
);

CREATE INDEX custom_emojis_server_idx ON custom_emojis (server_id);
