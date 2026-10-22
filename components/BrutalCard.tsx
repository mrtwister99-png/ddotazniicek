import { useColorScheme } from "@/components/useColorScheme";
import Colors, { NEO } from "@/constants/Colors";
import { StyleSheet, View, ViewProps } from "react-native";

type Props = ViewProps & {
  bg?: string;
  borderColor?: string;
  shadowColor?: string;
  rotate?: string;
  noShadow?: boolean;
};

export function BrutalCard({
  children,
  style,
  bg,
  borderColor,
  shadowColor,
  rotate = "-0.5deg",
  noShadow,
  ...rest
}: Props) {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme];
  const bColor =
    borderColor ?? (colorScheme === "dark" ? NEO.white : NEO.black);
  const background = bg ?? theme.background;
  const sColor = shadowColor ?? bColor;

  return (
    <View style={styles.wrap}>
      {!noShadow ? (
        <View style={[styles.shadow, { backgroundColor: sColor }]} />
      ) : null}
      <View
        style={[
          styles.card,
          {
            backgroundColor: background,
            borderColor: bColor,
            transform: [{ rotate }],
          },
          style,
        ]}
        {...rest}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  shadow: {
    position: "absolute",
    top: 8,
    left: 8,
    right: -4,
    bottom: -4,
    borderRadius: 0,
  },
  card: {
    borderWidth: 4,
    borderRadius: 0,
    padding: 14,
    gap: 8,
    overflow: "hidden",
  },
});
