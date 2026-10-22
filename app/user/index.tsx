import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrutalCard } from "@/components/BrutalCard";
import { Text, View } from "@/components/Themed";
import { useColorScheme } from "@/components/useColorScheme";
import Colors, { FONTS, NEO } from "@/constants/Colors";
import { errorMessage } from "@/lib/admin-api";
import {
  loadDeliveryDetail,
  loadUserHome,
  submitResponse,
  type DeliveryBlock,
  type DeliveryDetail,
  type Task,
  type UserHome,
} from "@/lib/user-api";

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

  const [ephemeralTask, setEphemeralTask] = useState<Task | null>(null);
  const [isEphemeralVisible, setIsEphemeralVisible] = useState(false);
  const [ephemeralDetail, setEphemeralDetail] = useState<DeliveryDetail | null>(
    null,
  );
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const gridWidth = Math.min(width, 440) - 32;
  const tile = Math.floor((gridWidth - GAP * (COLUMNS - 1)) / COLUMNS);
  const tasks = home?.tasks ?? [];
  const specialTasks = tasks.filter(
    (t: any) => (t as any).is_ephemeral || t.position === 16,
  );
  const gridTasks = tasks.filter(
    (t: any) => !(t as any).is_ephemeral && t.position !== 16,
  );
  const tasksByPos = new Map<number, (typeof gridTasks)[number]>();
  for (const t of gridTasks) {
    if (t.position >= 1 && t.position <= 15) tasksByPos.set(t.position, t);
    else if (t.position === 0) {
      for (let p = 1; p <= 15; p++)
        if (!tasksByPos.has(p)) {
          tasksByPos.set(p, { ...t, position: p });
          break;
        }
    }
  }
  const slots = 15; // 1-15 normal, 16 je specialni

  const hasNew = tasks.some((task) => task.isNew);
  const lightColor = hasNew ? "#DC2626" : "#16A34A";
  const lightText = hasNew ? "Nový úkol" : "Žádný nový úkol";

  useEffect(() => {
    if (!home) return;
    const firstNewSpecial = specialTasks.find((t) => t.isNew) ?? null;
    const firstNewAny = tasks.find((t) => t.isNew) ?? null;
    const candidate = firstNewSpecial ?? firstNewAny;
    if (candidate && !isEphemeralVisible) {
      setEphemeralTask(candidate);
      setIsEphemeralVisible(true);
    }
  }, [home]);

  useEffect(() => {
    if (!ephemeralTask || !isEphemeralVisible) return;
    let cancelled = false;
    (async () => {
      setIsDetailLoading(true);
      try {
        let deliveryId = ephemeralTask.id;
        if (deliveryId.startsWith("global-")) {
          // global sablona - vytvor delivery on-demand
          const { ensureDeliveryForGlobal } = await import("@/lib/user-api");
          deliveryId = await ensureDeliveryForGlobal(ephemeralTask.templateId);
        }
        const detail = await loadDeliveryDetail(deliveryId);
        if (!cancelled) {
          setEphemeralDetail(detail);
          setAnswers({});
        }
      } catch (e) {
        if (!cancelled) {
          Alert.alert(
            "Chyba",
            errorMessage(e, "Nepodařilo se načíst dotazník."),
          );
          setIsEphemeralVisible(false);
        }
      } finally {
        if (!cancelled) setIsDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ephemeralTask, isEphemeralVisible]);

  const handleEphemeralSubmit = async () => {
    if (!ephemeralTask) return;
    if (ephemeralDetail) {
      for (const b of ephemeralDetail.blocks) {
        if (b.is_required) {
          const v = answers[b.id];
          if (v === undefined || v === "" || v === null) {
            Alert.alert(
              "Vyplň povinné",
              `Blok na pozici ${b.position + 1} je povinný.`,
            );
            return;
          }
        }
      }
    }
    setIsSubmitting(true);
    try {
      // pro global-xxx pouzij real deliveryId z detailu
      const realId = ephemeralDetail?.deliveryId ?? ephemeralTask.id;
      await submitResponse(realId, answers);
      setIsEphemeralVisible(false);
      setEphemeralTask(null);
      setEphemeralDetail(null);
      await load();
    } catch (e) {
      Alert.alert("Chyba", errorMessage(e, "Odeslání selhalo."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safeArea, { backgroundColor: theme.background }]}
    >
      <ScrollView contentContainerStyle={styles.content}>
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
                    {
                      borderColor: "#000",
                      borderWidth: 3,
                      borderRadius: 0,
                      borderStyle: "dashed",
                    },
                  ]}
                >
                  <Text style={styles.posHint}>{pos}</Text>
                </View>
              );
            }
            return (
              <BrutalCard
                key={task.id}
                bg={KIND_COLOR[task.kind]}
                borderColor={NEO.black}
                rotate={pos % 2 === 0 ? "1deg" : "-1.2deg"}
                style={[size, { padding: 0 }]}
              >
                <Pressable
                  onPress={() =>
                    router.push(`/user/dotaznik/${task.id}` as any)
                  }
                  accessible
                  accessibilityLabel={`${task.kind === "D" ? "Dotazník" : "Reklama"} pozice ${pos}: ${task.title} za ${task.points} bodů`}
                  style={[
                    styles.tile,
                    size,
                    { backgroundColor: KIND_COLOR[task.kind], borderWidth: 0 },
                  ]}
                >
                  <Text style={[styles.tileKind, FONTS.brutalTitle]}>
                    {task.kind}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={[styles.tileTitle, FONTS.brutalTitle]}
                  >
                    {task.title}
                  </Text>
                  <View
                    style={[
                      styles.pointsBadge,
                      {
                        borderWidth: 3,
                        borderColor: "#000",
                        borderRadius: 0,
                        backgroundColor: NEO.yellow,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.pointsBadgeText,
                        {
                          color: "#000",
                          fontFamily: "SpaceMono-Regular",
                          fontWeight: "900",
                        },
                      ]}
                    >
                      {task.points}b
                    </Text>
                  </View>
                  <Text style={[styles.tilePos, FONTS.mono]}>{pos}</Text>
                </Pressable>
              </BrutalCard>
            );
          })}
        </View>

        {isLoading && !home ? (
          <ActivityIndicator style={styles.loader} />
        ) : null}

        {/* BRUTALISM - AHOJ + STATS DOLE JAKO ČTVEREČEK */}
        <View style={styles.brutalSquareWrap}>
          <View style={styles.brutalSquareShadow} />
          <View style={styles.brutalSquare}>
            <Text style={styles.greeting}>
              Ahoj{home?.name ? `, ${home.name}` : ""} 👋
            </Text>
            <View style={styles.stats}>
              <Text style={styles.statsTitle}>STATS</Text>
              <Text style={styles.statsLine}>
                B:{home?.points ?? 0} D:{home?.doneQuestionnaires ?? 0}
              </Text>
            </View>
            <View
              accessible
              accessibilityLabel={lightText}
              style={styles.lightBox}
            >
              <View
                style={[
                  styles.lightHalo,
                  { backgroundColor: `${lightColor}33` },
                ]}
              >
                <View style={[styles.light, { backgroundColor: lightColor }]} />
              </View>
              <Text style={styles.lightText}>{lightText}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={isEphemeralVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setIsEphemeralVisible(false)}
      >
        <SafeAreaView
          style={[styles.safeArea, { backgroundColor: theme.background }]}
        >
          <ScrollView contentContainerStyle={styles.modalContent}>
            {isDetailLoading || !ephemeralDetail ? (
              <ActivityIndicator style={{ marginTop: 32 }} />
            ) : (
              <>
                <Text style={styles.modalTitle}>
                  {ephemeralDetail.template.title}
                </Text>
                {ephemeralDetail.template.description ? (
                  <Text style={styles.modalDesc}>
                    {ephemeralDetail.template.description}
                  </Text>
                ) : null}
                <Text style={styles.modalPoints}>
                  {ephemeralDetail.template.points}b · speciálně pro tebe
                </Text>

                {ephemeralDetail.blocks.map((block: DeliveryBlock) => (
                  <View key={block.id} style={styles.blockCard}>
                    {block.kind === "text" ? (
                      <Text style={styles.blockText}>
                        {block.content.text ?? ""}
                      </Text>
                    ) : null}
                    {block.kind === "scale" ? (
                      <>
                        <Text style={styles.blockLabel}>
                          {block.content.label ??
                            `Škála ${block.content.min ?? 0}-${block.content.max ?? 10}`}
                        </Text>
                        <View style={styles.scaleRow}>
                          {Array.from(
                            {
                              length:
                                (block.content.max ?? 10) -
                                (block.content.min ?? 0) +
                                1,
                            },
                            (_, i) => {
                              const val = (block.content.min ?? 0) + i;
                              const active = answers[block.id] === val;
                              return (
                                <Pressable
                                  key={val}
                                  onPress={() =>
                                    setAnswers((prev: Record<string, any>) => ({
                                      ...prev,
                                      [block.id]: val,
                                    }))
                                  }
                                  style={[
                                    styles.scaleBtn,
                                    active && styles.scaleBtnActive,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.scaleText,
                                      active && styles.scaleTextActive,
                                    ]}
                                  >
                                    {val}
                                  </Text>
                                </Pressable>
                              );
                            },
                          )}
                        </View>
                      </>
                    ) : null}
                    {block.kind === "short_text" ? (
                      <TextInput
                        placeholder={block.content.placeholder ?? "Odpověď..."}
                        value={answers[block.id] ?? ""}
                        onChangeText={(t: string) =>
                          setAnswers((prev: Record<string, any>) => ({
                            ...prev,
                            [block.id]: t,
                          }))
                        }
                        style={styles.answerInput}
                        multiline
                      />
                    ) : null}
                    {block.is_required ? (
                      <Text style={styles.requiredHint}>* povinné</Text>
                    ) : null}
                  </View>
                ))}

                <Pressable
                  onPress={handleEphemeralSubmit}
                  disabled={isSubmitting}
                  style={[styles.submitBtn, isSubmitting && { opacity: 0.6 }]}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.submitText}>Odeslat</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => setIsEphemeralVisible(false)}
                  style={styles.closeBtn}
                >
                  <Text style={styles.closeText}>
                    Zavřít (zobrazí se znovu)
                  </Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { alignSelf: "center", maxWidth: 440, padding: 16, width: "100%" },
  greeting: {
    fontSize: 22,
    fontWeight: "900",
    fontFamily: "SpaceMono-Regular",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  brutalSquareWrap: { position: "relative", marginTop: 24, width: "100%" },
  brutalSquareShadow: {
    position: "absolute",
    top: 8,
    left: 8,
    right: -6,
    bottom: -6,
    backgroundColor: "#000",
  },
  brutalSquare: {
    borderWidth: 4,
    borderColor: "#000",
    backgroundColor: "#fff",
    padding: 16,
    gap: 12,
    minHeight: 140,
  },
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
  modalContent: { padding: 20, gap: 12 },
  modalTitle: { fontSize: 22, fontWeight: "800" },
  modalDesc: { fontSize: 15, opacity: 0.8, marginTop: 4 },
  modalPoints: { fontSize: 13, fontWeight: "700", color: "#D97706" },
  blockCard: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    gap: 8,
  },
  blockText: { fontSize: 16, fontWeight: "600" },
  blockLabel: { fontSize: 14, fontWeight: "600", opacity: 0.8 },
  scaleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  scaleBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
  },
  scaleBtnActive: { backgroundColor: "#0F766E", borderColor: "#0F766E" },
  scaleText: { fontWeight: "700" },
  scaleTextActive: { color: "#fff" },
  answerInput: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  requiredHint: { fontSize: 11, color: "#DC2626", fontWeight: "600" },
  submitBtn: {
    backgroundColor: "#16A34A",
    borderRadius: 12,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  closeBtn: { alignItems: "center", paddingVertical: 16 },
  closeText: { fontWeight: "600", opacity: 0.6 },
});
