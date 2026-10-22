import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useColorScheme } from "@/components/useColorScheme";
import Colors, { NEO } from "@/constants/Colors";
import { errorMessage } from "@/lib/admin-api";
import {
  loadUserPointsHistory,
  type PointsHistoryRecord,
} from "@/lib/user-api";

export default function HistorieScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme];
  const [records, setRecords] = useState<PointsHistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await loadUserPointsHistory();
      setRecords(data);
    } catch (e) {
      setError(errorMessage(e as any, "Nepodařilo se načíst historii."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safeArea, { backgroundColor: theme.background }]}
    >
      <View style={styles.header}>
        <Text style={styles.kicker}>UŽIVATEL · HISTORIE</Text>
        <Text style={styles.title}>Získané body</Text>
        <Text style={styles.sub}>
          datum - D/R - jméno - body (nelze rozkliknout)
        </Text>
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 24 }} size="large" />
      ) : null}
      <ScrollView contentContainerStyle={styles.list}>
        {records.map((rec) => (
          <View
            key={rec.id}
            style={[
              styles.row,
              { backgroundColor: rec.kind === "R" ? "#FEF3C7" : "#fff" },
            ]}
          >
            <Text style={styles.date}>{rec.date}</Text>
            <View
              style={[
                styles.kindBadge,
                { backgroundColor: rec.kind === "R" ? "#000" : "#FFE600" },
              ]}
            >
              <Text
                style={[
                  styles.kindText,
                  { color: rec.kind === "R" ? "#FFE600" : "#000" },
                ]}
              >
                {rec.kind}
              </Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {rec.name}
            </Text>
            <View style={styles.pointsBadge}>
              <Text style={styles.pointsText}>+{rec.points}b</Text>
            </View>
          </View>
        ))}
        {!isLoading && records.length === 0 && !error ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Zatím žádné body</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 4 },
  kicker: { fontSize: 11, fontWeight: "700", opacity: 0.6, letterSpacing: 1.2 },
  title: {
    fontSize: 26,
    fontWeight: "900",
    fontFamily: "SpaceMono-Regular",
    textTransform: "uppercase",
  },
  sub: { fontSize: 12, opacity: 0.7, marginTop: 2, fontFamily: "monospace" },
  list: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 12,
    borderWidth: 4,
    borderColor: "#000",
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  date: {
    fontSize: 12,
    fontWeight: "800",
    minWidth: 86,
    fontFamily: "SpaceMono-Regular",
  },
  kindBadge: {
    width: 32,
    height: 32,
    borderWidth: 3,
    borderColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  kindText: {
    fontSize: 14,
    fontWeight: "900",
    fontFamily: "SpaceMono-Regular",
  },
  name: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "SpaceMono-Regular",
  },
  pointsBadge: {
    backgroundColor: NEO.black,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 2,
    borderColor: "#000",
  },
  pointsText: { color: NEO.yellow, fontWeight: "900", fontSize: 12 },
  empty: { alignItems: "center", paddingTop: 40 },
  emptyTitle: { fontSize: 18, fontWeight: "900" },
});
