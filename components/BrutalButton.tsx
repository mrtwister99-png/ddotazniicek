import { NEO } from "@/constants/Colors";
import * as Haptics from "expo-haptics";
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
    ViewStyle,
} from "react-native";

type Variant = "yellow" | "black" | "white" | "pink" | "green";

type Props = {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  rotate?: string;
};

const VARIANT_BG: Record<Variant, { bg: string; text: string }> = {
  yellow: { bg: NEO.yellow, text: NEO.black },
  black: { bg: NEO.black, text: NEO.yellow },
  white: { bg: NEO.white, text: NEO.black },
  pink: { bg: NEO.pink, text: NEO.black },
  green: { bg: NEO.green, text: NEO.black },
};

export function BrutalButton({
  title,
  onPress,
  variant = "yellow",
  disabled,
  loading,
  style,
  rotate = "0.5deg",
}: Props) {
  const v = VARIANT_BG[variant];
  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.shadow, { backgroundColor: NEO.black }]} />
      <Pressable
        disabled={disabled || loading}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onPress?.();
        }}
        style={[
          styles.btn,
          {
            backgroundColor: v.bg,
            borderColor: NEO.black,
            opacity: disabled ? 0.5 : 1,
            transform: [{ rotate }],
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={v.text} />
        ) : (
          <Text style={[styles.text, { color: v.text }]}>{title}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", alignSelf: "flex-start" },
  shadow: { position: "absolute", top: 5, left: 5, right: -3, bottom: -3 },
  btn: {
    borderWidth: 3,
    borderRadius: 0,
    paddingHorizontal: 18,
    paddingVertical: 12,
    minWidth: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontWeight: "900",
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
