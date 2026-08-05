import { Resvg } from '@resvg/resvg-js';

// resvg is a static SVG renderer (no foreignObject/HTML support) — a non-issue here
// since htmlLabels defaults to false and this server always emits <text>/<tspan> labels.
// Rendering is synchronous, native (Rust via napi), and fast enough at our 50,000-char
// diagram cap that pooling/timeout (config.png.poolSize / config.png.timeout) buys nothing;
// see REFERENCE.md and _AGENT_PRIMER.md for the measured rationale.
export function svgToPng(svg: string): Buffer {
  const resvg = new Resvg(svg);
  return resvg.render().asPng();
}
