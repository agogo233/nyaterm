// ── Resolved rule (single color already chosen for the current theme) ───────

/** Rule shape passed to the highlighting engine after dark/light resolution. */
export interface ResolvedHighlightRule {
  id: string;
  name: string;
  patterns: string[];
  color: string;
  enabled: boolean;
}

// ── Luminance helper ────────────────────────────────────────────────────────

/** Perceived brightness of a "#rrggbb" hex color (0–1). */
export function hexLuminance(hex: string): number {
  const h = hex.replace("#", "");
  if (h.length < 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function requireTokenBoundary(pattern: string): string {
  // remove the \b to avoid conflicts
  const cleanPattern = pattern.replace(/\\b/g, "");
  return `(?<![\\w-])(?:${cleanPattern})(?![\\w-])`;
}

// ── Built-in rule patterns ───────────────────────────────────────────────────
// All patterns are compiled with the `gi` flag (global + case-insensitive).

const BUILTIN_PATTERNS = {
  error:   ["error", "fail(?:ed|ure)?", "fatal", "exception", "traceback", "panic", "critical"].map(requireTokenBoundary),
  warn:    ["warn(?:ing)?", "deprecated", "caution"].map(requireTokenBoundary),
  success: ["success(?:ful(?:ly)?)?", "ok", "done", "pass(?:ed)?", "complet(?:e|ed)"].map(requireTokenBoundary),
  info:    ["info(?:rmation)?", "notice"].map(requireTokenBoundary),
  debug:   ["debug", "trace", "verbose"].map(requireTokenBoundary),
  option: [
    "(?<![\\w-])--[a-zA-Z][\\w-]*(?![\\w-])",
    "(?<![\\w-])-[a-zA-Z](?:[a-zA-Z0-9])*(?![\\w-])"
  ],
  datetime: [
    "\\b\\d{4}[-/]\\d{2}[-/]\\d{2}(?:T(?:[01]\\d|2[0-3])[-:][0-5]\\d[-:][0-5]\\d(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:?\\d{2})?)?\\b",
    "\\b(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?(?:\\.\\d{1,6})?\\b"
  ],
  number: [
    "(?<![\\w-])[-+]?0x[0-9a-f]+(?![\\w-])",
    "(?<![\\w.-])[-+]?(?:\\.\\d+|\\d+\\.\\d*|\\d+[eE][-+]?\\d+|\\d{2,})(?:[eE][-+]?\\d+)?(?:\\s*%)?(?![\\w.-])"
  ],
  constant: [
    "true",
    "false",
    "null",
    "nil",
    "none",
    "undefined",
    "NaN",
    "Infinity",
    "nullptr",
    "EOF",
    "stop(?:ped)?",
  ].map(requireTokenBoundary),
  address: [
    "\\b(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\b",
    "(?<![0-9A-Fa-f:])(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}|(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}|(?:[0-9A-Fa-f]{1,3}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}|(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}|[0-9A-Fa-f]{1,4}:(?:(?::[0-9A-Fa-f]{1,4}){1,6})|:(?:(?::[0-9A-Fa-f]{1,4}){1,7}|:))(?![0-9A-Fa-f:])",
    "\\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\\b"
  ],
  url: [
    "\\b(?:https?|ftp|wss?):\\/\\/[-\\w+&@#/%?=~_|!:,.;]*[-\\w+&@#/%=~_|]"
  ],
  uuid: [
    "\\b[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\\b",
  ],
  string: [
    "\"(?:[^\"\\\\]|\\\\.)*\"|\'(?:[^\'\\\\]|\\\\.)*\'"
  ],
  operator: [
    "[\\[\\]{}()=+&*]+"
  ],
  version: [
    "\\bv\\d+(?:\\.\\d+){1,2}(?:-[a-z0-9.-]+)?\\b",
    "\\b\\d+(?:\\.\\d+){2,}(?:-[a-z0-9.-]+)?\\b",
    "\\blatest\\b",
    "\\brelease\\b",
    "\\bstable\\b",
    "\\bbeta\\b",
    "\\balpha\\b",
    "\\brevision\\b",
  ],
  size: [
    "\\b\\d+(?:\\.\\d+)?\\s*(?:[kmgtep]i?b|b|bytes?|[kmgtep]bps)\\b"
  ],
  duration: [
    "\\b[-+]?\\d+(?:\\.\\d+)?\\s*(?:[nµum]?s|sec|m|mins?|minutes|h|hrs?|hours|d|days|weeks|months|years)\\b"
  ],
} as const;

// ── Color sets ───────────────────────────────────────────────────────────────
// Colors chosen to be clearly visible against the respective terminal backgrounds
// while harmonising with each theme family's palette.

/** For dark terminal backgrounds (github-dark, dracula, nord, monokai, catppuccin-mocha …) */
const DARK_RULE_COLORS = {
  error: "#ff7b72",
  warn: "#e3b341",
  success: "#3fb950",
  info: "#79c0ff",
  debug: "#d2a8ff",
  option: "#ff9e64",
  datetime: "#f1fa8c",
  number: "#bd93f9",
  constant: "#ffb86c",
  address: "#56d364",
  url: "#8be9fd",
  uuid: "#ffb86c",
  string: "#f1fa8c",
  operator: "#8b949e",
  version: "#ff9e64",
  size: "#2ac3de",
  duration: "#f1fa8c",
};

/** For light terminal backgrounds (github-light, solarized-light, catppuccin-latte …) */
const LIGHT_RULE_COLORS = {
  error: "#cf222e",
  warn: "#9a6700",
  success: "#116329",
  info: "#0969da",
  debug: "#8250df",
  option: "#b04a00",
  datetime: "#a58900",
  number: "#6f42c1",
  constant: "#cb4b16",
  address: "#1a7f37",
  url: "#2aa198",
  uuid: "#bc4c00",
  string: "#1a8c8c",
  operator: "#57606a",
  version: "#b04a00",
  size: "#007197",
  duration: "#859900",
};

// ── Built-in rule factory ────────────────────────────────────────────────────

/**
 * Returns the 5 built-in highlight rules coloured for the current theme family.
 * IDs use the "builtin-" prefix so they never collide with user-created IDs
 * (which are timestamp-based: "kh-<timestamp>").
 */
export function getBuiltinRules(isDark: boolean): ResolvedHighlightRule[] {
  const c = isDark ? DARK_RULE_COLORS : LIGHT_RULE_COLORS;
  return [
    // Higher priority rules (complex structures, exact formats)
    { id: "builtin-url", name: "URL", patterns: [...BUILTIN_PATTERNS.url], color: c.url, enabled: true },
    { id: "builtin-version", name: "Version", patterns: [...BUILTIN_PATTERNS.version], color: c.version, enabled: true },
    { id: "builtin-address", name: "Address", patterns: [...BUILTIN_PATTERNS.address], color: c.address, enabled: true },
    { id: "builtin-size", name: "Size", patterns: [...BUILTIN_PATTERNS.size], color: c.size, enabled: true },
    { id: "builtin-string", name: "String", patterns: [...BUILTIN_PATTERNS.string], color: c.string, enabled: true },
    { id: "builtin-option", name: "Option", patterns: [...BUILTIN_PATTERNS.option], color: c.option, enabled: true },
    { id: "builtin-uuid", name: "UUID", patterns: [...BUILTIN_PATTERNS.uuid], color: c.uuid, enabled: true },
    { id: "builtin-datetime", name: "DateTime", patterns: [...BUILTIN_PATTERNS.datetime], color: c.datetime, enabled: true },
    // Logical state and generic matching
    { id: "builtin-error", name: "Error", patterns: [...BUILTIN_PATTERNS.error], color: c.error, enabled: true },
    { id: "builtin-warn", name: "Warning", patterns: [...BUILTIN_PATTERNS.warn], color: c.warn, enabled: true },
    { id: "builtin-success", name: "Success", patterns: [...BUILTIN_PATTERNS.success], color: c.success, enabled: true },
    { id: "builtin-info", name: "Info", patterns: [...BUILTIN_PATTERNS.info], color: c.info, enabled: true },
    { id: "builtin-debug", name: "Debug", patterns: [...BUILTIN_PATTERNS.debug], color: c.debug, enabled: true },
    // Base primitives
    { id: "builtin-duration", name: "Duration", patterns: [...BUILTIN_PATTERNS.duration], color: c.duration, enabled: true },
    { id: "builtin-constant", name: "Constant", patterns: [...BUILTIN_PATTERNS.constant], color: c.constant, enabled: true },
    { id: "builtin-number", name: "Number", patterns: [...BUILTIN_PATTERNS.number], color: c.number, enabled: true },
    { id: "builtin-operator", name: "Operator", patterns: [...BUILTIN_PATTERNS.operator], color: c.operator, enabled: true },
  ];
}

// ── Quick-pick color palettes ─────────────────────────────────────────────────
// Curated from the actual ANSI palettes of the bundled dark / light themes.
// Each row has 6 swatches: error · warning · success · info · debug · accent.

/** 12 colors that stand out on dark terminal backgrounds. */
export const DARK_PALETTE: readonly string[] = [
  // row 1 – semantic tones
  "#ff7b72", "#e3b341", "#3fb950", "#79c0ff", "#d2a8ff", "#ff79c6",
  // row 2 – extended / accent tones
  "#ffa657", "#f1fa8c", "#56d364", "#8be9fd", "#bd93f9", "#ffb86c",
];

/** 12 colors that stand out on light terminal backgrounds. */
export const LIGHT_PALETTE: readonly string[] = [
  // row 1 – semantic tones
  "#cf222e", "#9a6700", "#116329", "#0969da", "#8250df", "#d33682",
  // row 2 – extended / accent tones
  "#bc4c00", "#a58900", "#1a7f37", "#2aa198", "#6f42c1", "#cb4b16",
];
