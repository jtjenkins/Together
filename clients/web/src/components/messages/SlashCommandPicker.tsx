import { searchCommands, type SlashCommand } from "../../utils/slashCommands";
import styles from "./SlashCommandPicker.module.css";

interface SlashCommandPickerProps {
  query: string;
  activeIndex: number;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
}

export function SlashCommandPicker({
  query,
  activeIndex,
  onSelect,
}: SlashCommandPickerProps) {
  const results = searchCommands(query);
  if (results.length === 0) return null;

  return (
    <div className={styles.dropdown} role="listbox" aria-label="Slash commands">
      {results.map((cmd, i) => (
        <div
          key={cmd.name}
          role="option"
          aria-selected={i === activeIndex}
          className={`${styles.row} ${i === activeIndex ? styles.active : ""}`}
          onMouseDown={(e) => {
            e.preventDefault(); // prevent textarea blur
            onSelect(cmd);
          }}
        >
          <span className={styles.name}>/{cmd.name}</span>
          {cmd.argHint && <span className={styles.hint}>{cmd.argHint}</span>}
          <span className={styles.desc}>{cmd.description}</span>
        </div>
      ))}
    </div>
  );
}
