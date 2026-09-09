import type { GlobalThemeOverrides } from "naive-ui";
import { darkTheme } from "naive-ui";

/**
 * Naive UI 暗色主题基座（海军蓝 + 青绿主色）。
 */
export const ezshellNaiveTheme = darkTheme;

/**
 * 覆盖 Naive 默认色，对齐 `@ezshell/ui-tokens`。
 */
export const ezshellThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#2dd4bf",
    primaryColorHover: "#5eead4",
    primaryColorPressed: "#14b8a6",
    primaryColorSuppl: "#2dd4bf",
    infoColor: "#2dd4bf",
    successColor: "#34d399",
    warningColor: "#fbbf24",
    errorColor: "#f87171",
    bodyColor: "#252a42",
    cardColor: "#2f3550",
    modalColor: "#2f3550",
    popoverColor: "#2f3550",
    tableColor: "#2f3550",
    inputColor: "#1c2035",
    actionColor: "#3a4060",
    hoverColor: "rgba(45, 212, 191, 0.12)",
    pressedColor: "rgba(45, 212, 191, 0.2)",
    borderColor: "rgba(168, 176, 200, 0.22)",
    dividerColor: "rgba(168, 176, 200, 0.16)",
    textColorBase: "#eef0f7",
    textColor1: "#eef0f7",
    textColor2: "#c5cadb",
    textColor3: "#a8b0c8",
    placeholderColor: "#7f879e",
    iconColor: "#a8b0c8",
    fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    borderRadius: "10px",
  },
  Button: {
    textColorPrimary: "#042f2e",
    textColorHoverPrimary: "#042f2e",
    textColorPressedPrimary: "#042f2e",
    textColorFocusPrimary: "#042f2e",
  },
  Card: {
    color: "#2f3550",
    borderColor: "rgba(168, 176, 200, 0.18)",
    titleTextColor: "#eef0f7",
  },
  Input: {
    color: "#1c2035",
    colorFocus: "#1c2035",
    border: "1px solid rgba(168, 176, 200, 0.28)",
    borderHover: "1px solid rgba(45, 212, 191, 0.55)",
    borderFocus: "1px solid #2dd4bf",
  },
  InternalSelection: {
    color: "#1c2035",
    border: "1px solid rgba(168, 176, 200, 0.28)",
    borderHover: "1px solid rgba(45, 212, 191, 0.55)",
    borderFocus: "1px solid #2dd4bf",
    borderActive: "1px solid #2dd4bf",
  },
  Dialog: {
    color: "#2f3550",
    titleTextColor: "#eef0f7",
    textColor: "#c5cadb",
  },
  Modal: {
    color: "#2f3550",
  },
  Checkbox: {
    colorChecked: "#2dd4bf",
    checkMarkColor: "#042f2e",
  },
  Scrollbar: {
    color: "rgba(168, 176, 200, 0.32)",
    colorHover: "rgba(45, 212, 191, 0.55)",
  },
};
