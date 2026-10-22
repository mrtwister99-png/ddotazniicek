import { FONTS, NEO } from "@/constants/Colors";
import { StyleSheet, Text, View } from "react-native";

type Props = { label: string; bg?: string; color?: string; rotate?: string };

export function BrutalBadge({
  label,
  bg = NEO.yellow,
  color = NEO.black,
  rotate = "-2deg",
}: Props) {
  return (
    <View style={[styles.wrap]}>
      <View style={[styles.shadow, { backgroundColor: NEO.black }]} />
      <View
        style={[
          styles.badge,
          {
            backgroundColor: bg,
            borderColor: NEO.black,
            transform: [{ rotate }],
          },
        ]}
      >
        <Text style={[styles.text, { color, ...FONTS.brutalTitle }]}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  shadow: { position: "absolute", top: 3, left: 3, right: -2, bottom: -2 },
  badge: {
    borderWidth: 3,
    borderRadius: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  text: { fontSize: 11, fontWeight: "900" },
});
