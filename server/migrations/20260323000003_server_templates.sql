CREATE TABLE server_templates (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    description TEXT        NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
    category    TEXT        NOT NULL CHECK (category IN ('gaming', 'community', 'study', 'custom')),
    template_data JSONB     NOT NULL DEFAULT '{}'::jsonb,
    is_builtin  BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX server_templates_category_idx ON server_templates (category);

-- Seed built-in templates
INSERT INTO server_templates (name, description, category, template_data, is_builtin) VALUES
(
    'Gaming',
    'Perfect for gaming communities with voice and text channels.',
    'gaming',
    '{"channels": [
        {"name": "announcements", "type": "text",  "category": "Information",    "position": 0},
        {"name": "general",       "type": "text",  "category": "Text Channels",  "position": 1},
        {"name": "gaming-chat",   "type": "text",  "category": "Text Channels",  "position": 2},
        {"name": "General",       "type": "voice", "category": "Voice Channels", "position": 3},
        {"name": "Gaming",        "type": "voice", "category": "Voice Channels", "position": 4}
    ]}'::jsonb,
    TRUE
),
(
    'Community',
    'Great for general communities and friend groups.',
    'community',
    '{"channels": [
        {"name": "announcements", "type": "text",  "category": "Information",    "position": 0},
        {"name": "rules",         "type": "text",  "category": "Information",    "position": 1},
        {"name": "general",       "type": "text",  "category": "Text Channels",  "position": 2},
        {"name": "off-topic",     "type": "text",  "category": "Text Channels",  "position": 3},
        {"name": "General",       "type": "voice", "category": "Voice Channels", "position": 4}
    ]}'::jsonb,
    TRUE
),
(
    'Study Group',
    'Organised channels for study groups and academic communities.',
    'study',
    '{"channels": [
        {"name": "announcements", "type": "text",  "category": "Information",    "position": 0},
        {"name": "resources",     "type": "text",  "category": "Text Channels",  "position": 1},
        {"name": "homework-help", "type": "text",  "category": "Text Channels",  "position": 2},
        {"name": "Study Room",    "type": "voice", "category": "Voice Channels", "position": 3}
    ]}'::jsonb,
    TRUE
);
