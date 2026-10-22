import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text, View } from "@/components/Themed";
import { useColorScheme } from "@/components/useColorScheme";
import Colors from "@/constants/Colors";
import { errorMessage } from "@/lib/admin-api";
import { loadUserHome, type UserHome } from "@/lib/user-api";

const COLUMNS = 4;
const GAP = 10;
const KIND_COLOR = { D: "#0F766E", R: "#7C3AED" };

export default function UserHomeScreen() {
  const router = useRouter();
  const theme = Colors[useColorScheme() ?? "light"];
  const { width } = useWindowDimensions();

  const [home, setHome] = useState<UserHome | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setHome(await loadUserHome());
    } catch (e) {
      setError(errorMessage(e, "Nepodařilo se načíst úkoly. Zkuste to znovu."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Načte data při každém otevření záložky.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Čtvercové dlaždice: 4 sloupce, minimálně 4 řádky (volná místa jsou jen obrysy).
  const gridWidth = Math.min(width, 440) - 32;
  const tile = Math.floor((gridWidth - GAP * (COLUMNS - 1)) / COLUMNS);
  const tasks = home?.tasks ?? [];
  const tasksByPos = new Map<number, (typeof tasks)[number]>();
  for (const t of tasks) {
    if (t.position >= 1 && t.position <= 16) tasksByPos.set(t.position, t);
    else if (t.position === 0) {
      // fallback pro staré delivery bez pozice - najdi první volné
      for (let p = 1; p <= 16; p++)
        if (!tasksByPos.has(p)) {
          tasksByPos.set(p, { ...t, position: p });
          break;
        }
    }
  }
  const slots = 16;

  const hasNew = tasks.some((task) => task.isNew);
  const lightColor = hasNew ? "#DC2626" : "#16A34A";
  const lightText = hasNew ? "Nový úkol" : "Žádný nový úkol";

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safeArea, { backgroundColor: theme.background }]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.greeting}>
          Ahoj{home?.name ? `, ${home.name}` : ""} 👋
        </Text>

        {error ? (
          <View>
            <Text style={styles.error}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={load}
              style={styles.retry}
            >
              <Text style={styles.retryText}>Zkusit znovu</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.grid}>
          {Array.from({ length: slots }, (_, index) => {
            const pos = index + 1;
            const task = tasksByPos.get(pos);
            const size = { width: tile, height: tile };
            if (!task) {
              return (
                <View
                  key={`empty-${pos}`}
                  style={[
                    styles.tile,
                    styles.emptyTile,
                    size,
                    { borderColor: theme.tabIconDefault },
                  ]}
                >
                  <Text style={styles.posHint}>{pos}</Text>
                </View>
              );
            }
            return (
              <Pressable
                key={task.id}
                onPress={() => router.push(`/user/dotaznik/${task.id}` as any)}
                accessible
                accessibilityLabel={`${task.kind === "D" ? "Dotazník" : "Reklama"} pozice ${pos}: ${task.title} za ${task.points} bodů`}
                style={[
                  styles.tile,
                  size,
                  { backgroundColor: KIND_COLOR[task.kind] },
                ]}
              >
                <Text style={styles.tileKind}>{task.kind}</Text>
                <Text numberOfLines={2} style={styles.tileTitle}>
                  {task.title}
                </Text>
                <View style={styles.pointsBadge}>
                  <Text style={styles.pointsBadgeText}>{task.points}b</Text>
                </View>
                <Text style={styles.tilePos}>{pos}</Text>
              </Pressable>
            );
          })}
        </View>

        {isLoading && !home ? (
          <ActivityIndicator style={styles.loader} />
        ) : null}

        <View style={styles.bottomRow}>
          <View style={styles.stats}>
            <Text style={styles.statsTitle}>stats</Text>
            {/* R (dokoukané reklamy) je lokální počítadlo na zařízení - zatím 0. */}
            <Text style={styles.statsLine}>
              B:{home?.points ?? 0} R:0 D:{home?.doneQuestionnaires ?? 0}
            </Text>
          </View>

          <View
            accessible
            accessibilityLabel={lightText}
            style={styles.lightBox}
          >
            <View
              style={[styles.lightHalo, { backgroundColor: `${lightColor}33` }]}
            >
              <View style={[styles.light, { backgroundColor: lightColor }]} />
            </View>
            <Text style={styles.lightText}>{lightText}</Text>
          </View>

          {/* Vyhrazeno pro budoucí delší reklamu. */}
          <View
            accessible
            accessibilityLabel="Delší reklama, zatím nedostupná"
            style={styles.longAd}
          >
            <Text style={styles.longAdText}>Delší reklama</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { alignSelf: "center", maxWidth: 440, padding: 16, width: "100%" },
  greeting: { fontSize: 24, fontWeight: "700", marginBottom: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  tile: {
    alignItems: "center",
    borderRadius: 10,
    justifyContent: "center",
    padding: 4,
  },
  emptyTile: {
    backgroundColor: "transparent",
    borderStyle: "dashed",
    borderWidth: 1,
    opacity: 0.6,
  },
  tileKind: { color: "#FFFFFF", fontSize: 22, fontWeight: "700" },
  tileTitle: {
    color: "#FFFFFF",
    fontSize: 10,
    maxWidth: "100%",
    textAlign: "center",
    marginTop: 2,
  },
  pointsBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.35)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  pointsBadgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  tilePos: {
    position: "absolute",
    top: 4,
    left: 6,
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    fontWeight: "700",
  },
  posHint: { color: "#9CA3AF", fontSize: 12, fontWeight: "600" },
  loader: { marginTop: 16 },
  bottomRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  stats: { flex: 1 },
  statsTitle: { fontSize: 22, fontWeight: "600" },
  statsLine: { fontSize: 16, marginTop: 4 },
  lightBox: { alignItems: "center", width: 84 },
  lightHalo: {
    alignItems: "center",
    borderRadius: 32,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  light: { borderRadius: 20, height: 40, width: 40 },
  lightText: { fontSize: 12, marginTop: 4, textAlign: "center" },
  longAd: {
    alignItems: "center",
    backgroundColor: "#FACC15",
    borderRadius: 10,
    height: 64,
    justifyContent: "center",
    width: 84,
  },
  longAdText: {
    color: "#1F2937",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  error: { color: "#B42318", fontSize: 15, marginBottom: 8 },
  retry: { alignSelf: "flex-start", marginBottom: 12, paddingVertical: 8 },
  retryText: {
    fontSize: 16,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
