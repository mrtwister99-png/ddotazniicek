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
}: Props) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.sub}>{sub}</Text>
          <View style={styles.grid}>
            {Array.from({ length: max - min + 1 }, (_, i) => {
              const pos = min + i;
              const active = selectedPosition === pos;
              return (
                <Pressable
                  key={pos}
                  onPress={() => onSelect(pos)}
                  style={[styles.tile, active && styles.tileActive]}
                >
                  <Text style={[styles.text, active && styles.textActive]}>
                    {pos}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={styles.cancel}>
              <Text style={styles.cancelText}>Zrušit</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={!!isLoading}
              style={[styles.confirm, isLoading && { opacity: 0.6 }]}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.confirmText}>
                  {confirmText ?? `Publikovat na ${selectedPosition}`}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 20,
  },
  card: { borderRadius: 20, padding: 20, gap: 12, backgroundColor: "#fff" },
  title: { fontSize: 18, fontWeight: "800" },
  sub: { fontSize: 13, opacity: 0.7 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  tile: {
    width: 64,
    height: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
  },
  tileActive: { backgroundColor: "#0F766E", borderColor: "#0F766E" },
  text: { fontSize: 18, fontWeight: "800" },
  textActive: { color: "#fff" },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 12,
  },
  cancel: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelText: { fontWeight: "700" },
  confirm: {
    backgroundColor: "#0F766E",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  confirmText: { color: "#fff", fontWeight: "800" },
});
