import { useColorScheme } from "@/components/useColorScheme";
import Colors from "@/constants/Colors";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

type Props = {
  visible: boolean;
  title: string;
  sub: string;
  selectedPosition: number;
  onSelect: (pos: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  min?: number;
  max?: number;
  confirmText?: string;
  occupiedMap?: Record<number, string>;
};

export function PositionPicker({
  visible,
  title,
  sub,
  selectedPosition,
  onSelect,
  onConfirm,
  onCancel,
  isLoading,
  min = 1,
  max = 15,
  confirmText,
  occupiedMap = {},
}: Props) {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme];
  const isDark = colorScheme === "dark";
  const borderColor = isDark ? "#FFFFFF" : "#000000";
  const bg = theme.background;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onCancel}
    >
      <View style={[styles.backdrop, { backgroundColor: "rgba(0,0,0,0.75)" }]}>
        {/* shadow layer - neo brutalism */}
        <View style={styles.shadowWrap}>
          <View style={[styles.shadow, { backgroundColor: borderColor }]} />
          <View
            style={[
              styles.card,
              {
                backgroundColor: bg,
                borderColor,
                transform: [{ rotate: "-0.5deg" }],
              },
            ]}
          >
            {/* header sketch */}
            <View
              style={[
                styles.headerSketch,
                {
                  borderColor,
                  backgroundColor: isDark ? "#FFE600" : "#FFE600",
                },
              ]}
            >
              <Text style={[styles.title, { color: "#000" }]}>{title}</Text>
            </View>
            <Text
              style={[
                styles.sub,
                { color: theme.text, fontFamily: "monospace" },
              ]}
            >
              {sub}
            </Text>
            <View style={styles.grid}>
              {Array.from({ length: max - min + 1 }, (_, i) => {
                const pos = min + i;
                const active = selectedPosition === pos;
                const occupiedTitle = occupiedMap[pos];
                const isOccupied = !!occupiedTitle;
                return (
                  <Pressable
                    key={pos}
                    onPress={() => onSelect(pos)}
                    style={styles.tileWrap}
                  >
                    <View
                      style={[
                        styles.tileShadow,
                        { backgroundColor: borderColor },
                      ]}
                    />
                    <View
                      style={[
                        styles.tile,
                        {
                          backgroundColor: active
                            ? "#FFE600"
                            : isOccupied
                              ? "#FFB3B3"
                              : bg,
                          borderColor,
                          transform: [{ rotate: active ? "1deg" : "-0.8deg" }],
                          borderWidth: isOccupied ? 4 : 3,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.text,
                          {
                            color: active
                              ? "#000"
                              : isOccupied
                                ? "#7F1D1D"
                                : theme.text,
                            fontSize: isOccupied ? 18 : 20,
                          },
                        ]}
                      >
                        {pos}
                      </Text>
                      {isOccupied ? (
                        <Text
                          style={{
                            fontSize: 7,
                            fontWeight: "900",
                            color: "#7F1D1D",
                            textAlign: "center",
                            marginTop: 2,
                          }}
                          numberOfLines={1}
                        >
                          {occupiedTitle.slice(0, 10)}
                        </Text>
                      ) : null}
                      {active ? <View style={styles.activeDot} /> : null}
                      {isOccupied && !active ? (
                        <View
                          style={{
                            position: "absolute",
                            top: 2,
                            right: 2,
                            width: 6,
                            height: 6,
                            backgroundColor: "#DC2626",
                          }}
                        />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.actions}>
              <Pressable
                onPress={onCancel}
                style={[styles.cancel, { borderColor, backgroundColor: bg }]}
              >
                <Text style={[styles.cancelText, { color: theme.text }]}>
                  ZRUŠIT
                </Text>
              </Pressable>
              <View style={styles.confirmWrap}>
                <View
                  style={[
                    styles.confirmShadow,
                    { backgroundColor: borderColor },
                  ]}
                />
                <Pressable
                  onPress={onConfirm}
                  disabled={!!isLoading}
                  style={[
                    styles.confirm,
                    {
                      backgroundColor: "#000",
                      borderColor,
                      opacity: isLoading ? 0.6 : 1,
                    },
                  ]}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#FFE600" />
                  ) : (
                    <Text style={styles.confirmText}>
                      {confirmText ?? `PUBLIKOVAT → ${selectedPosition}`}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
            <Text style={[styles.sketchHint, { color: theme.text }]}>
              ✏️ neo brutalism • {min}-{max} • {isDark ? "DARK" : "LIGHT"}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: 20 },
  shadowWrap: { position: "relative" },
  shadow: {
    position: "absolute",
    top: 12,
    left: 12,
    right: -4,
    bottom: -4,
    borderRadius: 0,
  },
  card: { borderWidth: 4, borderRadius: 0, padding: 20, gap: 14 },
  headerSketch: {
    borderWidth: 3,
    borderRadius: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: "flex-start",
    transform: [{ rotate: "-1deg" }],
  },
  title: {
    fontSize: 20,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  sub: { fontSize: 12, opacity: 0.8, marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  tileWrap: { width: 64, height: 64, position: "relative" },
  tileShadow: {
    position: "absolute",
    top: 4,
    left: 4,
    width: 64,
    height: 64,
    borderRadius: 0,
  },
  tile: {
    width: 64,
    height: 64,
    borderWidth: 3,
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { fontSize: 20, fontWeight: "900" },
  activeDot: {
    position: "absolute",
    bottom: 4,
    right: 4,
    width: 8,
    height: 8,
    backgroundColor: "#000",
    borderRadius: 0,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 16,
    marginTop: 16,
    alignItems: "center",
  },
  cancel: {
    borderWidth: 3,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 0,
    transform: [{ rotate: "0.5deg" }],
  },
  cancelText: { fontWeight: "900", fontSize: 13 },
  confirmWrap: { position: "relative" },
  confirmShadow: {
    position: "absolute",
    top: 5,
    left: 5,
    right: -2,
    bottom: -2,
  },
  confirm: {
    borderWidth: 3,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 0,
    minWidth: 140,
    alignItems: "center",
  },
  confirmText: {
    color: "#FFE600",
    fontWeight: "900",
    fontSize: 13,
    letterSpacing: 0.5,
  },
  sketchHint: {
    fontSize: 10,
    fontFamily: "monospace",
    marginTop: 8,
    opacity: 0.5,
  },
});
