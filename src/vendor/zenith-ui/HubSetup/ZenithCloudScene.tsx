"use client";
import { useEffect, useId, useRef } from "react";
import { cloudFrameAt, formations, glyphs, palette, plaque, wisps } from "./cloud-scene-geometry.ts";

export interface ZenithCloudSceneProps {
  paused?: boolean;
  /** A deterministic still for visual review/export; omitted enables ambient drift. */
  timeMs?: number;
}

/** Decorative, code-native artwork. Semantic product identity belongs to the host. */
export function ZenithCloudScene({ paused = false, timeMs }: ZenithCloudSceneProps) {
  const scene = useRef<SVGSVGElement>(null);
  const activeTime = useRef(0);
  const id = useId().replace(/:/g, "");
  useEffect(() => {
    const svg = scene.current;
    if (!svg) return;
    const groups = [...svg.querySelectorAll<SVGGElement>("[data-cloud]")];
    function draw(time: number) {
      cloudFrameAt(time).forEach(({ x, y }, index) => {
        const transform = `translate(${x} ${y})`;
        if (groups[index]?.getAttribute("transform") !== transform)
          groups[index]?.setAttribute("transform", transform);
      });
    }
    if (timeMs !== undefined) {
      draw(timeMs);
      svg.dataset.motion = "still";
      return;
    }
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    let frame = 0;
    let last: number | null = null;
    let refreshTimer = 0;
    function reason() {
      if (preference.matches) return "reduced";
      if (paused || document.querySelector("dialog[open]")) return "paused";
      if (document.hidden) return "hidden";
      if (!visible) return "offscreen";
      if (document.querySelector(
        ".zn-hermes-hud--composer:not(.is-collapsed):focus-within, .zn-hermes-hud--composer:not(.is-collapsed) .zn-hermes-hud__panel:not([hidden])"
      )) return "guide";
      return "running";
    }
    function tick(timestamp: number) {
      frame = 0;
      if (last !== null) activeTime.current += Math.max(0, timestamp - last);
      last = timestamp;
      draw(activeTime.current);
      frame = requestAnimationFrame(tick);
    }
    function reconcile() {
      const state = reason();
      svg!.dataset.motion = state;
      if (state === "running") {
        if (!frame) {
          last = null;
          frame = requestAnimationFrame(tick);
        }
      } else {
        cancelAnimationFrame(frame);
        frame = 0;
        last = null;
        if (state === "reduced") {
          activeTime.current = 0;
          draw(0);
        }
      }
    }
    function afterInteraction() {
      clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(reconcile, 0);
    }
    const observer = typeof IntersectionObserver === "undefined" ? null
      : new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
          reconcile();
        });
    observer?.observe(svg);
    preference.addEventListener("change", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    document.addEventListener("focusin", afterInteraction);
    document.addEventListener("focusout", afterInteraction);
    document.addEventListener("click", afterInteraction);
    document.addEventListener("zenith:hermes-guide-activity", afterInteraction);
    draw(activeTime.current);
    reconcile();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(refreshTimer);
      observer?.disconnect();
      preference.removeEventListener("change", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
      document.removeEventListener("focusin", afterInteraction);
      document.removeEventListener("focusout", afterInteraction);
      document.removeEventListener("click", afterInteraction);
      document.removeEventListener("zenith:hermes-guide-activity", afterInteraction);
    };
  }, [paused, timeMs]);
  return (
    <svg ref={scene} className="zn-cloud-scene" viewBox="0 0 1672 941" preserveAspectRatio="xMidYMid slice"
      aria-hidden="true" focusable="false" data-zenith-cloud-scene="" data-motion="still">
      <defs>
        <linearGradient id={id + "-sky"} x2="0" y2="1">
          <stop stopColor={palette.skyLight} />
          <stop offset=".42" stopColor={palette.sky} />
          <stop offset="1" stopColor={palette.skyDeep} />
        </linearGradient>
        <linearGradient id={id + "-ink"} x2="0" y2="1">
          <stop stopColor={palette.ink} />
          <stop offset=".78" stopColor="#0038b1" />
          <stop offset="1" stopColor={palette.inkDeep} />
        </linearGradient>
        <pattern id={id + "-lines"} patternUnits="userSpaceOnUse" width="1672" height="13">
          <path d="M0 1H1672" stroke="#75b2ff" strokeOpacity=".025" strokeWidth="1" />
          <path d="M0 5H1672" stroke="#001b78" strokeOpacity=".012" />
        </pattern>
      </defs>
      <rect width="1672" height="941" fill={"url(#" + id + "-sky)"} />
      {formations.map((cloud) => {
        const depth = cloud.id.includes("foot") ? .3 : cloud.id.includes("low") ? .45 : .9;
        return <g key={cloud.id} data-cloud={cloud.id}>
          <path d={cloud.outline} transform={`translate(${cloud.side * 48 * depth} ${56 * depth})`}
            fill={palette.deep} stroke={palette.deep} strokeWidth="40" strokeLinejoin="miter" opacity=".7" />
          <path d={cloud.outline} transform={`translate(${cloud.side * 32 * depth} ${42 * depth})`}
            fill={palette.shade} stroke={palette.shade} strokeWidth="24" strokeLinejoin="miter" opacity=".85" />
          <path d={cloud.outline} transform={`translate(${cloud.side * 16 * depth} ${26 * depth})`}
            fill={palette.blue} stroke={palette.blue} strokeWidth="16" strokeLinejoin="miter" />
          <path d={cloud.outline} transform={`translate(${cloud.side * 8 * depth} ${12 * depth})`}
            fill={palette.pale} />
          <path d={cloud.outline} fill={palette.white} />
          {cloud.facets.map((face, index) => (
            <g key={index}>
              <path d={face} transform={`translate(${cloud.side * 6} 10)`} fill={palette.blue} opacity=".7" />
              <path d={face} fill={index % 2 ? palette.pale : palette.frost} />
            </g>
          ))}
        </g>;
      })}
      <g data-cloud-plaque="">
        {wisps.map(([x, y, width, height], index) => (
          <g key={index}>
            <rect x={x - 16} y={y + 16} width={width + 16} height={height} fill={palette.blue} opacity=".18" />
            <rect x={x} y={y} width={width} height={height} fill={palette.pale} opacity={index % 3 === 0 ? ".28" : ".16"} />
          </g>
        ))}
        <path d={plaque} fill={palette.blue} stroke={palette.blue} strokeWidth="48" strokeLinejoin="miter" opacity=".10" />
        <path d={plaque} fill={palette.pale} stroke={palette.blue} strokeWidth="24" strokeLinejoin="miter" opacity=".18" />
        <path d={plaque} fill={palette.frost} stroke={palette.frost} strokeWidth="12" strokeLinejoin="miter" opacity=".5" />
        <path d={plaque} fill={palette.white} />
      </g>
      <g data-zenith-wordmark="" fill={"url(#" + id + "-ink)"}>
        {glyphs.map((glyph) => (
          <g key={glyph.name}>
            <path d={glyph.path} />
            <path d={glyph.shade} fill={palette.inkDeep} opacity=".75" />
          </g>
        ))}
      </g>
      <rect width="1672" height="941" fill={"url(#" + id + "-lines)"} />
    </svg>
  );
}
