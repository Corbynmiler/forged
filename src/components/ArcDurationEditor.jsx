import { T } from "../theme.js";
import {
  ARC_DURATION_PRESETS,
  arcDurationWeeksLabel,
  clampArcDurationDays,
  arcDurationDaysFromEndDate,
  arcEndDateFromStart,
} from "../arcProofMatch.js";
import { todayStr } from "../utils.js";

const styleInp = {
  width: "100%",
  boxSizing: "border-box",
  background: T.surface,
  border: `0.5px solid ${T.borderStrong}`,
  borderRadius: T.rsm,
  padding: "10px 12px",
  fontSize: 14,
  color: T.text,
  fontFamily: T.font,
  outline: "none",
};

/**
 * Preset week buttons + custom weeks + optional end-date picker.
 * value = durationDays on the Arc draft.
 */
export function ArcDurationEditor({ durationDays, onChange, startDate = todayStr() }) {
  const d = clampArcDurationDays(durationDays);
  const endYmd = arcEndDateFromStart(startDate, d);
  const customWeeks = d % 7 === 0 ? String(d / 7) : "";
  const isPreset = ARC_DURATION_PRESETS.includes(d);

  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.hint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
        Duration
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {ARC_DURATION_PRESETS.map(preset => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            style={{
              flex: "1 1 22%",
              minWidth: 56,
              padding: "8px 0",
              borderRadius: T.rsm,
              fontFamily: T.font,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              border: `0.5px solid ${d === preset ? "rgba(200,144,42,0.6)" : T.border}`,
              background: d === preset ? "rgba(200,144,42,0.14)" : T.surface,
              color: d === preset ? T.gold : T.muted,
            }}
          >
            {arcDurationWeeksLabel(preset)}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: T.muted, flexShrink: 0 }}>Custom weeks</label>
        <input
          type="number"
          min={2}
          max={14}
          step={1}
          placeholder="e.g. 6"
          value={!isPreset && d % 7 === 0 ? customWeeks : ""}
          onChange={e => {
            const w = parseInt(e.target.value, 10);
            if (Number.isFinite(w) && w >= 2 && w <= 14) onChange(w * 7);
          }}
          style={{ ...styleInp, flex: 1, padding: "8px 10px" }}
        />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: T.muted, flexShrink: 0 }}>End date</label>
        <input
          type="date"
          value={endYmd}
          onChange={e => {
            const end = e.target.value;
            if (end) onChange(arcDurationDaysFromEndDate(startDate, end));
          }}
          style={{ ...styleInp, flex: 1, padding: "8px 10px", colorScheme: "dark" }}
        />
      </div>
      <div style={{ fontSize: 11, color: T.hint, marginTop: 6 }}>
        {arcDurationWeeksLabel(d)} ({d} days) · ends {endYmd}
      </div>
    </div>
  );
}
