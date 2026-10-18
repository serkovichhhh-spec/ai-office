// 8×8 pixel characters, one per role. Static art; motion comes only from real activity (CSS .working).
const BASE = [
  "..HHHH..",
  ".HHHHHH.",
  ".HSSSSH.",
  ".SEsSEs.",
  "..SSSS..",
  ".CCCCCC.",
  "CCCCCCCP",
  "DDDDDDDD",
];

const PALETTES: Record<string, { H: string; C: string; P: string; glasses?: boolean }> = {
  orchestrator: { H: "#2b2b38", C: "#3e5c80", P: "#e8a92b" },
  strategist: { H: "#7a4a2a", C: "#2f7d5b", P: "#e8e2d0" },
  research_analyst: { H: "#c9a14a", C: "#5a6f8c", P: "#9fd0e6" },
  performance_analyst: { H: "#3a2418", C: "#8c5a2b", P: "#7fc49a" },
  creative_director: { H: "#b4442f", C: "#22252b", P: "#e8a92b" },
  copywriter: { H: "#1d1d1d", C: "#a8432d", P: "#f2f2f2" },
  reviewer: { H: "#6b6b6b", C: "#6b4fa0", P: "#c8402f", glasses: true },
  creative: { H: "#d9822b", C: "#e0b33a", P: "#3e5c80" },
  smm: { H: "#5a3a7a", C: "#d1557a", P: "#f2f2f2" },
  content_maker: { H: "#2a2a2a", C: "#3b8c8c", P: "#e8a92b" },
  designer: { H: "#8a5a3a", C: "#4a7fc1", P: "#f2c14e" },
  graphic_designer: { H: "#c0392b", C: "#2c3e50", P: "#1abc9c" },
  print_designer: { H: "#5d4037", C: "#7f8c8d", P: "#e74c3c" },
  video_editor: { H: "#111111", C: "#34495e", P: "#9b59b6", glasses: true },
};

export function PixelAvatar({ role, size = 48 }: { role: string; size?: number }) {
  const p = PALETTES[role] ?? PALETTES.orchestrator;
  const colors: Record<string, string> = {
    H: p.H, C: p.C, P: p.P, S: "#f1c8a5", s: "#f1c8a5", E: p.glasses ? "#16222f" : "#2a2a2a", D: "#9aa8b6",
  };
  if (p.glasses) colors.s = "#16222f";
  const rects: React.ReactElement[] = [];
  BASE.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const fill = colors[ch];
      if (fill) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={fill} />);
    }),
  );
  return (
    <svg className="avatar" viewBox="0 0 8 8" width={size} height={size} aria-hidden="true" shapeRendering="crispEdges">
      {rects}
    </svg>
  );
}
