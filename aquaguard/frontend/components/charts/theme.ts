/**
 * Chart tokens (P4 Blue & White). The categorical order was validated with the dataviz palette validator on the
 * white chart surface: lightness band, chroma floor, adjacent CVD separation (worst ΔE 13.7, deutan), normal-vision
 * floor (worst ΔE 24.7) and 3:1 contrast all PASS. Colours follow the entity in this fixed order and are never
 * cycled. Status colours are reserved for risk states and always appear with a text label.
 */
export const SERIES = ["#0868CC", "#C2410C", "#0D9488", "#6250D6", "#D55181"] as const;

/** Fixed colour per entity (colour follows the entity, never its rank). */
export const SECTOR_COLOR: Record<string, string> = {
  agriculture: SERIES[0],
  domestic: SERIES[1],
  industry: SERIES[2],
  environment: SERIES[3],
  losses: SERIES[4],
};

export const NEUTRAL = {
  reference: "#536C8A", // observed / historical reference lines (not a categorical slot)
  band: "rgba(8,104,204,0.14)", // uncertainty band of the blue model series
  grid: "#E6EFF8",
  axis: "#B9CCE0",
  ink: "#102B50",
  muted: "#536C8A",
  surface: "#FFFFFF",
};

export const STATUS = { good: "#1B7F4C", warning: "#A15C00", critical: "#C62828" };

export const FONT = { family: "Inter, 'Hind Siliguri', system-ui, sans-serif", size: 12, color: NEUTRAL.ink };

/** Base Plotly layout: recessive grid and axes, legend on top, no dual axes. */
export function baseLayout(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    autosize: true,
    margin: { l: 56, r: 16, t: 8, b: 44 },
    paper_bgcolor: NEUTRAL.surface,
    plot_bgcolor: NEUTRAL.surface,
    font: FONT,
    hovermode: "x unified",
    hoverlabel: { bgcolor: "#FFFFFF", bordercolor: NEUTRAL.axis, font: { ...FONT, size: 12 } },
    legend: { orientation: "h", y: 1.12, x: 0, font: { size: 12, color: NEUTRAL.muted } },
    xaxis: { gridcolor: NEUTRAL.grid, linecolor: NEUTRAL.axis, zeroline: false, tickfont: { color: NEUTRAL.muted }, automargin: true },
    yaxis: { gridcolor: NEUTRAL.grid, linecolor: NEUTRAL.axis, zerolinecolor: NEUTRAL.axis, tickfont: { color: NEUTRAL.muted }, automargin: true },
    ...overrides,
  };
}

export const axisTitle = (text: string) => ({ text, font: { size: 12, color: NEUTRAL.muted } });

/**
 * Diverging class colours for weather indicators (tone -3 driest / most need ... +3 wettest), two hues with a
 * neutral grey midpoint (never a hue at the midpoint). Always shown with the class label in the legend and hover.
 */
export const TONE_COLOR: Record<number, string> = {
  [-3]: "#8C3209", [-2]: "#C2410C", [-1]: "#E8A27A", 0: "#D5DEE8", 1: "#9CC5EE", 2: "#3D8AD6", 3: "#0755B8",
};
export const NO_CLASS = "#EEF2F6";

/**
 * Sankey sources and pools (M4). They are neutral, directly labelled marks outside the categorical slots, so a
 * source never shares a colour with a sector (groundwater used to equal "losses"). Validator, white surface:
 * surface↔groundwater ΔE 18.1, groundwater↔pool ΔE 16.9, surface↔agriculture ΔE 17.8 (normal vision, all PASS);
 * surface is 2.9:1 on white, relieved by the direct labels and the table view.
 */
export const FLOW_COLOR: Record<string, string> = {
  surface: "#6F9CC4",
  groundwater: "#6B5A4E",
  available: "#1E3A5F",
  trwr: "#1E3A5F",
  storage: "#94A3B8",
  remainder: "#94A3B8",
  // AQUASTAT withdrawal names map onto the sector colours
  municipal: SECTOR_COLOR.domestic,
  industrial: SECTOR_COLOR.industry,
};
