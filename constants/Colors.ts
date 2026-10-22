const tintColorLight = "#2f95dc";
const tintColorDark = "#fff";

export const NEO = {
  yellow: "#FFE600",
  black: "#000000",
  white: "#FFFFFF",
  pink: "#FF90E8",
  green: "#23F0C6",
  red: "#FF5050",
};

export const FONTS = {
  sketch: "SpaceMono-Regular",
  brutalTitle: {
    fontFamily: "SpaceMono-Regular" as const,
    fontWeight: "900" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  mono: { fontFamily: "SpaceMono-Regular" as const },
  title900: {
    fontFamily: "SpaceMono-Regular" as const,
    fontWeight: "900" as const,
  },
};

export default {
  light: {
    text: "#000",
    background: "#fff",
    tint: tintColorLight,
    tabIconDefault: "#ccc",
    tabIconSelected: NEO.yellow,
    neo: NEO,
    yellow: NEO.yellow,
    border: NEO.black,
    fonts: FONTS,
  },
  dark: {
    text: "#fff",
    background: "#000",
    tint: tintColorDark,
    tabIconDefault: "#ccc",
    tabIconSelected: NEO.yellow,
    neo: NEO,
    yellow: NEO.yellow,
    border: NEO.white,
    fonts: FONTS,
  },
};
