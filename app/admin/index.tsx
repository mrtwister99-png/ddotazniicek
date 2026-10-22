import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text, View } from "@/components/Themed";
import { useColorScheme } from "@/components/useColorScheme";
import Colors, { NEO } from "@/constants/Colors";
import {
  createDeliveries,
  createFolder,
  errorMessage,
  loadDirectory,
  type Directory,
  type Person,
} from "@/lib/admin-api";
import { clearAuthSession } from "@/lib/auth-session";
import {
  clearAll,
  getSelectedUserIds,
  setSelectedUserIds,
  useSelectionStore,
} from "@/lib/selection-store";
import * as Haptics from "expo-haptics";

type Section = { id: string | null; name: string; members: Person[] };

function Check({
  checked,
  label,
  onPress,
}: {
  checked: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      hitSlop={8}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      style={styles.checkHit}
    >
      <View style={styles.checkWrap}>
        <View style={[styles.checkShadow, { backgroundColor: NEO.black }]} />
        <View
          style={[
            styles.check,
            {
              backgroundColor: checked ? NEO.yellow : NEO.white,
              borderColor: NEO.black,
            },
          ]}
        >
          {checked ? (
            <Ionicons name="checkmark" size={22} color={NEO.black} />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function AdminDashboard() {
  const router = useRouter();
  const theme = Colors[useColorScheme() ?? "light"];
  const { selectedUserIds, selectedTemplate } = useSelectionStore();

  const [directory, setDirectory] = useState<Directory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await loadDirectory();
      setDirectory(data);
      const current = getSelectedUserIds();
      const filtered = new Set(
        [...current].filter((id) => data.people.some((p) => p.id === id)),
      );
      if (filtered.size !== current.size) setSelectedUserIds(filtered);
    } catch (error) {
      setLoadError(errorMessage(error, "Nepodařilo se načíst uživatele."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const sections = useMemo<Section[]>(() => {
    if (!directory) return [];
    const folderOf = new Map(
      directory.memberships.map((m) => [m.user_id, m.group_id]),
    );
    const membersOf = (folderId: string | null) =>
      directory.people.filter((p) => (folderOf.get(p.id) ?? null) === folderId);
    return [
      { id: null, name: "Obecná", members: membersOf(null) },
      ...directory.folders.map((f) => ({
        id: f.id,
        name: f.name,
        members: membersOf(f.id),
      })),
    ];
  }, [directory]);

  const toggleUser = (id: string) => {
    const next = new Set(selectedUserIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedUserIds(next);
    setSendResult(null);
  };
  const toggleSection = (section: Section) => {
    const next = new Set(selectedUserIds);
    const allSelected =
      section.members.length > 0 &&
      section.members.every((m) => next.has(m.id));
    for (const member of section.members) {
      if (allSelected) next.delete(member.id);
      else next.add(member.id);
    }
    setSelectedUserIds(next);
    setSendResult(null);
  };

  const submitFolder = async () => {
    const name = folderName.trim();
    if (!name || isSaving) return;
    setIsSaving(true);
    setFolderError(null);
    try {
      await createFolder(name);
      setIsModalVisible(false);
      setFolderName("");
      await load();
    } catch (error) {
      setFolderError(errorMessage(error, "Složku se nepodařilo vytvořit."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSend = async () => {
    if (selectedUserIds.size === 0) {
      Alert.alert(
        "Vyber uživatele",
        "Označ aspoň jednoho uživatele zeleným kolečkem.",
      );
      return;
    }
    if (!selectedTemplate) {
      Alert.alert(
        "Vyber vzor",
        'Jdi do záložky Šablony a klikni "Použít jako vzor" u jedné šablony.',
        [
          {
            text: "Jít do Šablon",
            onPress: () => router.push("/admin/sablony"),
          },
          { text: "Zrušit" },
        ],
      );
      return;
    }
    Alert.alert(
      "Odeslat?",
      `Pošleš "${selectedTemplate.title}" pro ${selectedUserIds.size} uživatelů.`,
      [
        { text: "Zrušit", style: "cancel" },
        {
          text: "Odeslat",
          onPress: async () => {
            setIsSending(true);
            setSendResult(null);
            try {
              const res = await createDeliveries(
                selectedTemplate.id,
                Array.from(selectedUserIds),
                16, // VZDY specialni pozice 16 pro vybrane
                true, // ephemeral = jen modal
              );
              setSendResult(
                `✅ Odesláno ${res.created} uživatelům na SPECIÁLNÍ pozici 16 - přijde jim notifikace + modal`,
              );
              setSelectedUserIds(new Set());
            } catch (e) {
              setSendResult(`❌ ${errorMessage(e, "Odeslání selhalo.")}`);
            } finally {
              setIsSending(false);
            }
          },
        },
      ],
    );
  };

  const logout = () => {
    clearAuthSession();
    clearAll();
    router.replace("/");
  };

  const canSend = selectedUserIds.size > 0 && !!selectedTemplate;
  const vzorLabel = selectedTemplate
    ? `${selectedTemplate.title} · ${selectedTemplate.points}b`
    : "žádný vzor";
  const hint = !selectedTemplate
    ? "↑ Vyber vzor v Šablonách"
    : selectedUserIds.size === 0
      ? "↑ Vyber uživatele"
      : `Připraveno k odeslání: ${selectedUserIds.size} uživatelů`;

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safeArea, { backgroundColor: theme.background }]}
    >
      <View style={styles.header}>
        <View style={styles.headerTexts}>
          <Text style={styles.kicker}>SPRÁVA · UŽIVATELÉ</Text>
          <Text style={styles.title}>Komu pošleme formulář?</Text>
        </View>
        <Pressable onPress={logout} style={styles.iconButton}>
          <Ionicons name="log-out-outline" size={24} color={theme.text} />
        </Pressable>
        <View style={{ position: "relative" }}>
          <View
            style={{
              position: "absolute",
              top: 4,
              left: 4,
              width: 48,
              height: 48,
              backgroundColor: "#000",
            }}
          />
          <Pressable
            onPress={() => {
              setFolderError(null);
              setIsModalVisible(true);
            }}
            style={styles.addButton}
          >
            <Ionicons name="add" size={30} color="#000" />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {isLoading && !directory ? <ActivityIndicator size="large" /> : null}
        {loadError ? (
          <View>
            <Text style={styles.error}>{loadError}</Text>
            <Pressable onPress={load} style={styles.retry}>
              <Text style={styles.retryText}>Zkusit znovu</Text>
            </Pressable>
          </View>
        ) : null}
        {sections.map((section) => (
          <View key={section.id ?? "general"}>
            <View style={styles.rowWrap}>
              <View style={[styles.row, styles.folderRow]}>
                <Ionicons name="folder" size={22} color="#FFE600" />
                <Text style={[styles.rowText, { color: "#F9FAFB" }]}>
                  {section.name}
                </Text>
                <Text style={[styles.count, { color: "#F9FAFB" }]}>
                  {section.members.length}
                </Text>
              </View>
              {section.members.length > 0 ? (
                <Check
                  label={`Vybrat ${section.name}`}
                  checked={section.members.every((m) =>
                    selectedUserIds.has(m.id),
                  )}
                  onPress={() => toggleSection(section)}
                />
              ) : (
                <View style={styles.checkHit} />
              )}
            </View>
            {section.members.map((person) => {
              const name =
                person.display_name ?? person.username ?? "Bez jména";
              return (
                <View key={person.id} style={styles.rowWrap}>
                  <View
                    style={[
                      styles.row,
                      styles.userRow,
                      {
                        backgroundColor: "#fff",
                        borderWidth: 4,
                        borderColor: "#000",
                        shadowColor: "#000",
                        shadowOffset: { width: 6, height: 6 },
                        shadowOpacity: 1,
                        shadowRadius: 0,
                      },
                    ]}
                  >
                    <Ionicons name="person" size={20} color="#000" />
                    <Text style={[styles.rowText, { color: "#000" }]}>
                      {name}
                    </Text>
                  </View>
                  <Check
                    label={`Vybrat ${name}`}
                    checked={selectedUserIds.has(person.id)}
                    onPress={() => toggleUser(person.id)}
                  />
                </View>
              );
            })}
          </View>
        ))}
        {sendResult ? (
          <View style={styles.resultBox}>
            <Text style={styles.resultText}>{sendResult}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.bottomBar,
          {
            borderColor: theme.tabIconDefault,
            backgroundColor: theme.background,
          },
        ]}
      >
        <View style={styles.summaryRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.summary} numberOfLines={1}>
              Vybráno: {selectedUserIds.size} uživatelů · Vzor: {vzorLabel}
            </Text>
            <Text
              style={[styles.hint, { color: canSend ? "#059669" : "#D97706" }]}
            >
              {hint}
            </Text>
          </View>
          {selectedTemplate ? (
            <View style={styles.vzorBadge}>
              <Ionicons name="checkmark-circle" size={14} color="#059669" />
              <Text style={styles.vzorBadgeText}>1 vzor</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.actions}>
          <Pressable
            onPress={() => router.push("/admin/sablony")}
            style={[
              styles.action,
              {
                flex: 2,
                backgroundColor: selectedTemplate ? "#065F46" : "#374151",
              },
            ]}
          >
            <Ionicons
              name="document-text-outline"
              size={18}
              color="#fff"
              style={{ marginRight: 6 }}
            />
            <Text style={styles.actionText}>
              {selectedTemplate
                ? selectedTemplate.title.slice(0, 18)
                : "Vzor dotazníku"}
            </Text>
          </Pressable>
          <Pressable
            disabled={isSending || !canSend}
            onPress={handleSend}
            style={[
              styles.action,
              styles.sendAction,
              !canSend && styles.actionDisabled,
            ]}
          >
            {isSending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons
                  name="send"
                  size={16}
                  color="#fff"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.actionText}>Odeslat</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>

      <Modal
        visible={isModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setIsModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[styles.modalCard, { backgroundColor: theme.background }]}
          >
            <Text style={styles.modalTitle}>Nová složka</Text>
            <TextInput
              autoFocus
              onChangeText={setFolderName}
              placeholder="Např. Kamarádi"
              style={[
                styles.input,
                { borderColor: theme.tabIconDefault, color: theme.text },
              ]}
              value={folderName}
            />
            {folderError ? (
              <Text style={styles.error}>{folderError}</Text>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setIsModalVisible(false)}
                style={styles.modalSecondary}
              >
                <Text style={styles.modalSecondaryText}>Zrušit</Text>
              </Pressable>
              <Pressable
                disabled={!folderName.trim() || isSaving}
                onPress={submitFolder}
                style={[
                  styles.modalPrimary,
                  (!folderName.trim() || isSaving) && { opacity: 0.6 },
                ]}
              >
                {isSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalPrimaryText}>Vytvořit</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTexts: { flex: 1 },
  kicker: { fontSize: 11, letterSpacing: 1.2, fontWeight: "700", opacity: 0.6 },
  title: {
    fontSize: 20,
    fontWeight: "900",
    fontFamily: "SpaceMono-Regular",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 2,
  },
  iconButton: { padding: 8 },
  addButton: {
    alignItems: "center",
    backgroundColor: "#FFE600",
    borderRadius: 0,
    borderWidth: 4,
    borderColor: "#000",
    height: 48,
    justifyContent: "center",
    width: 48,
    shadowColor: "#000",
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  rowWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  row: {
    alignItems: "center",
    borderRadius: 0,
    borderWidth: 4,
    borderColor: "#000",
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOffset: { width: 6, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  folderRow: {
    backgroundColor: "#111827",
    borderWidth: 4,
    borderColor: "#000",
  },
  userRow: { backgroundColor: "#FFFFFF", borderWidth: 4, borderColor: "#000" },
  rowText: {
    flex: 1,
    fontSize: 16,
    fontWeight: "900",
    fontFamily: "SpaceMono-Regular",
    textTransform: "uppercase",
  },
  count: { fontSize: 14, fontWeight: "900", fontFamily: "SpaceMono-Regular" },
  checkHit: {
    width: 50,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  checkWrap: { position: "relative", width: 32, height: 32 },
  checkShadow: { position: "absolute", top: 4, left: 4, width: 32, height: 32 },
  check: {
    width: 32,
    height: 32,
    borderRadius: 0,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomBar: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  summary: { fontSize: 13, fontWeight: "600", opacity: 0.8 },
  hint: { fontSize: 11, fontWeight: "700", marginTop: 2 },
  vzorBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#6EE7B7",
  },
  vzorBadgeText: { fontSize: 11, fontWeight: "800", color: "#065F46" },
  actions: { flexDirection: "row", gap: 10 },
  action: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 14,
    backgroundColor: "#111827",
  },
  sendAction: { flex: 1, backgroundColor: "#16A34A" },
  actionDisabled: { backgroundColor: "#9CA3AF" },
  actionText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  error: { color: "#B42318", fontSize: 14, marginTop: 8 },
  retry: { marginTop: 8, paddingVertical: 6 },
  retryText: { fontWeight: "700", textDecorationLine: "underline" },
  resultBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
  },
  resultText: { fontSize: 14, fontWeight: "600", color: "#14532D" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: { borderRadius: 16, padding: 20, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: "800" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 8,
  },
  modalSecondary: { paddingHorizontal: 16, paddingVertical: 10 },
  modalSecondaryText: { fontWeight: "700" },
  modalPrimary: {
    backgroundColor: "#0F766E",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minWidth: 90,
    alignItems: "center",
  },
  modalPrimaryText: { color: "#fff", fontWeight: "700" },
});
