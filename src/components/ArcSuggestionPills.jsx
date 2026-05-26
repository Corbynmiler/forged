import { T } from "../theme.js";

/** Horizontal helper pills above Arc coach input. */
export default function ArcSuggestionPills({ pills, onPill, disabled }) {
  if (!pills?.length || disabled) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        marginBottom: 8,
        paddingBottom: 2,
        scrollbarWidth: "none",
      }}
    >
      {pills.map((pill) => (
        <button
          key={pill.label}
          type="button"
          onClick={() => onPill(pill)}
          style={{
            flexShrink: 0,
            padding: "6px 12px",
            borderRadius: 999,
            border: `0.5px solid ${T.border}`,
            background: "rgba(255,255,255,0.04)",
            color: T.sub,
            fontSize: 12,
            fontWeight: 500,
            fontFamily: T.font,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {pill.label}
        </button>
      ))}
    </div>
  );
}
