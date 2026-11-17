import { getSetting, setSetting } from "./db";
import { colors } from "./theme";

export interface ReaderSettings {
  font: number;   // размер шрифта, px
  line: number;   // межстрочный интервал, px
  width: number;  // ширина колонки, px
  theme: keyof typeof READER_THEMES;
}

export const READER_THEMES = {
  dark: { bg: colors.bg, text: colors.text, surface: colors.surface, dim: colors.dim },
  sepia: { bg: "#f4ecd8", text: "#5b4636", surface: "#ede0c8", dim: "#8a7256" },
  light: { bg: "#ffffff", text: "#22222a", surface: "#f0f0f4", dim: "#77778a" },
} as const;

const DEFAULTS: ReaderSettings = { font: 17, line: 28, width: 720, theme: "dark" };

export function getReaderSettings(): ReaderSettings {
  return {
    font: Number(getSetting("rs_font") ?? DEFAULTS.font),
    line: Number(getSetting("rs_line") ?? DEFAULTS.line),
    width: Number(getSetting("rs_width") ?? DEFAULTS.width),
    theme: (getSetting("rs_theme") as ReaderSettings["theme"]) ?? DEFAULTS.theme,
  };
}

export function setReaderSetting<K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) {
  setSetting(`rs_${key}`, String(value));
}
