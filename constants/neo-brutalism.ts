import { StyleSheet } from "react-native";

export const NEO_COLORS = {
  yellow: "#FFE600",
  black: "#000000",
  white: "#FFFFFF",
  pink: "#FF90E8",
  green: "#23F0C6",
  red: "#FF5050",
};

export const neoBrutalism = StyleSheet.create({
  card: {
    borderWidth: 4,
    borderRadius: 0,
    padding: 16,
    gap: 8,
  },
  cardShadow: {
    position: "absolute",
    top: 8,
    left: 8,
    right: -4,
    bottom: -4,
  },
  title: {
    fontSize: 20,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  badge: {
    borderWidth: 3,
    borderRadius: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    transform: [{ rotate: "-1deg" }],
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  button: {
    borderWidth: 3,
    borderRadius: 0,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontWeight: "900",
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tile: {
    borderWidth: 4,
    borderRadius: 0,
  },
});
