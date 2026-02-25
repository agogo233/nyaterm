import { useTranslation } from "react-i18next";
import { MdClose, MdKeyboardArrowDown, MdKeyboardArrowUp } from "react-icons/md";

interface TerminalSearchBarProps {
  show: boolean;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export default function TerminalSearchBar({
  show,
  searchQuery,
  setSearchQuery,
  onNext,
  onPrev,
  onClose,
}: TerminalSearchBarProps) {
  const { t } = useTranslation();

  if (!show) return null;

  return (
    <div
      className="absolute top-1 right-1 flex items-center gap-1 px-2 py-1 rounded shadow-lg border z-50"
      style={{
        backgroundColor: "var(--df-bg-panel)",
        borderColor: "var(--df-border)",
        color: "var(--df-text)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        type="text"
        className="bg-transparent outline-none text-xs px-1 py-0.5"
        style={{ color: "var(--df-text)", width: "180px" }}
        placeholder={t("terminalCtx.find")}
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
          // the parent handles finding Next on query change
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (e.shiftKey) onPrev();
            else onNext();
          } else if (e.key === "Escape") {
            onClose();
          }
        }}
      />
      <MdKeyboardArrowUp
        className="text-sm cursor-pointer hover:opacity-80"
        style={{ color: "var(--df-text-muted)" }}
        onClick={onPrev}
        title="Previous"
      />
      <MdKeyboardArrowDown
        className="text-sm cursor-pointer hover:opacity-80"
        style={{ color: "var(--df-text-muted)" }}
        onClick={onNext}
        title="Next"
      />
      <MdClose
        className="text-sm cursor-pointer hover:opacity-80"
        style={{ color: "var(--df-text-muted)" }}
        onClick={onClose}
        title="Close"
      />
    </div>
  );
}
