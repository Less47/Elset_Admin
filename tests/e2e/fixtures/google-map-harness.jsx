import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import GoogleJobsMap from "../../../src/components/map/GoogleJobsMap";
import { useThemePalette } from "../../../src/hooks/useThemePalette";
import { themePresets } from "../../../src/lib/theme-presets";
import "../../../src/index.css";

export default function Harness() {
  const [preset, setPreset] = useState(themePresets[0]);
  const { themePalette } = useThemePalette(preset.values);
  const state = window.mapFixture;
  return <div style={themePalette.rootStyle}>
    <select aria-label="Test appearance" value={preset.id} onChange={(event) => setPreset(themePresets.find((item) => item.id === event.target.value))} style={{ height: 48 }}>
      {themePresets.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
    </select>
    <div style={{ height: "calc(100dvh - 48px)" }}>
      <GoogleJobsMap customers={state.customers} jobs={state.jobs} dark={themePalette.dark}
        onOpenJob={(job) => { window.mapAction = ["job", job.id]; }}
        onOpenSite={(customer, site) => { window.mapAction = ["site", customer, site]; }} />
    </div>
  </div>;
}
createRoot(document.getElementById("root")).render(<StrictMode><Harness /></StrictMode>);
