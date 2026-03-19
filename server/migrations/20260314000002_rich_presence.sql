-- Add activity field for rich presence (manual activity text, like "Playing Minecraft")
ALTER TABLE users ADD COLUMN activity TEXT CHECK (char_length(activity) <= 128);
