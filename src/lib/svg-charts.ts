/**
 * Tiny SVG chart generators — no dependencies, just template strings.
 * Output is intended to be fed to @resvg/resvg-js for PNG conversion,
 * which is then embedded into the XLSX workbook via ExcelJS's addImage.
 */

export interface Slice {
  label: string;
  value: number;
  color: string; // hex with #
}

const BG = "#0f1218";
const INK = "#e8ecf3";
const INK2 = "#b8c0cf";
const MUTED = "#7a8597";
const LINE = "#1f2531";

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Polar → cartesian for arc endpoints. Angles in degrees, 0° = 12 o'clock. */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** Build an SVG donut chart with right-side legend. */
export function pieSvg(title: string, slices: Slice[], width = 720, height = 420): string {
  const data = slices.filter((s) => s.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;

  const cx = 200;
  const cy = height / 2 + 10;
  const outer = 140;
  const inner = 80;

  let startAngle = 0;
  const paths = data.map((d) => {
    const sweep = (d.value / total) * 360;
    const endAngle = startAngle + sweep;
    const [x1o, y1o] = polar(cx, cy, outer, startAngle);
    const [x2o, y2o] = polar(cx, cy, outer, endAngle);
    const [x1i, y1i] = polar(cx, cy, inner, endAngle);
    const [x2i, y2i] = polar(cx, cy, inner, startAngle);
    const large = sweep > 180 ? 1 : 0;
    const segment = sweep >= 360
      ? `M ${x1o} ${y1o} A ${outer} ${outer} 0 1 1 ${x1o - 0.01} ${y1o} L ${x2i + 0.01} ${y1i} A ${inner} ${inner} 0 1 0 ${x2i} ${y2i} Z`
      : `M ${x1o.toFixed(2)} ${y1o.toFixed(2)}
         A ${outer} ${outer} 0 ${large} 1 ${x2o.toFixed(2)} ${y2o.toFixed(2)}
         L ${x1i.toFixed(2)} ${y1i.toFixed(2)}
         A ${inner} ${inner} 0 ${large} 0 ${x2i.toFixed(2)} ${y2i.toFixed(2)}
         Z`;
    startAngle = endAngle;
    return `<path d="${segment}" fill="${d.color}" stroke="${BG}" stroke-width="2"/>`;
  }).join("\n    ");

  const legendX = 400;
  const legendItems = data.map((d, i) => {
    const y = 60 + i * 32;
    const pct = Math.round((d.value / total) * 100);
    return `
      <g transform="translate(${legendX}, ${y})">
        <rect width="14" height="14" rx="3" fill="${d.color}"/>
        <text x="22" y="11" font-family="Inter, Arial, sans-serif" font-size="13" fill="${INK}">${escape(d.label)}</text>
        <text x="280" y="11" font-family="Inter, Arial, sans-serif" font-size="13" fill="${INK2}" text-anchor="end">${d.value}</text>
        <text x="300" y="11" font-family="Inter, Arial, sans-serif" font-size="12" fill="${MUTED}" text-anchor="start">${pct}%</text>
      </g>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${BG}"/>
  <text x="20" y="30" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="600" fill="${INK}">${escape(title)}</text>
  ${paths}
  <text x="${cx}" y="${cy - 4}" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="600" fill="${INK}" text-anchor="middle">${total}</text>
  <text x="${cx}" y="${cy + 18}" font-family="Inter, Arial, sans-serif" font-size="11" fill="${MUTED}" text-anchor="middle" letter-spacing="2">TOTAL</text>
  ${legendItems}
</svg>`;
}

export interface Bar {
  label: string;
  value: number;
  color?: string;
}

/** Vertical bar chart with grid + labels. */
export function barSvg(title: string, bars: Bar[], width = 720, height = 380, defaultColor = "#5eead4"): string {
  const data = bars.filter((b) => b.value !== undefined);
  if (!data.length) return emptySvg(title, width, height);

  const padding = { top: 50, right: 30, bottom: 50, left: 50 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const max = Math.max(...data.map((d) => d.value), 1);
  // Round max up to next "nice" number for the y-axis
  const niceMax = niceCeil(max);
  const ticks = 4;
  const tickStep = niceMax / ticks;

  const barW = innerW / data.length;
  const barInner = Math.max(8, barW * 0.7);
  const barGap = (barW - barInner) / 2;

  const gridLines = Array.from({ length: ticks + 1 }, (_, i) => {
    const y = padding.top + innerH - (i / ticks) * innerH;
    const v = Math.round(tickStep * i);
    return `
      <line x1="${padding.left}" y1="${y}" x2="${padding.left + innerW}" y2="${y}" stroke="${LINE}" stroke-width="1"/>
      <text x="${padding.left - 8}" y="${y + 4}" font-family="Inter, Arial, sans-serif" font-size="11" fill="${MUTED}" text-anchor="end">${v}</text>
    `;
  }).join("");

  const barsSvg = data.map((d, i) => {
    const h = (d.value / niceMax) * innerH;
    const x = padding.left + i * barW + barGap;
    const y = padding.top + innerH - h;
    const color = d.color || defaultColor;
    const labelTrunc = d.label.length > 14 ? d.label.slice(0, 12) + "…" : d.label;
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barInner.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${color}"/>
      <text x="${(x + barInner / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" font-family="Inter, Arial, sans-serif" font-size="11" font-weight="600" fill="${INK}" text-anchor="middle">${d.value}</text>
      <text x="${(x + barInner / 2).toFixed(1)}" y="${(padding.top + innerH + 18).toFixed(1)}" font-family="Inter, Arial, sans-serif" font-size="11" fill="${INK2}" text-anchor="middle">${escape(labelTrunc)}</text>
    `;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${BG}"/>
  <text x="20" y="30" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="600" fill="${INK}">${escape(title)}</text>
  ${gridLines}
  ${barsSvg}
</svg>`;
}

function emptySvg(title: string, width: number, height: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${BG}"/>
  <text x="20" y="30" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="600" fill="${INK}">${escape(title)}</text>
  <text x="${width / 2}" y="${height / 2}" font-family="Inter, Arial, sans-serif" font-size="13" fill="${MUTED}" text-anchor="middle">No data</text>
</svg>`;
}

function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(n)));
  const norm = n / pow;
  let nice: number;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * pow;
}
