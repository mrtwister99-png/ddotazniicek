import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
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
import Colors from "@/constants/Colors";
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  errorMessage,
  loadTemplateDetail,
  loadTemplates,
  saveTemplateBlocks,
  updateTemplate,
  type Template,
  type TemplateBlock,
} from "@/lib/admin-api";
import { setSelectedTemplate, useSelectionStore } from "@/lib/selection-store";

type BlockDraft = {
  id?: string;
  kind: TemplateBlock["kind"];
  content: Record<string, any>;
  is_required: boolean;
};

const CATEGORY_LABEL: Record<Template["category"], string> = {
  questionnaire: "D · dotazník",
  advertisement: "R · reklama",
  special_questionnaire: "S · speciál",
};
const CATEGORY_COLOR: Record<Template["category"], string> = {
  questionnaire: "#0F766E",
  advertisement: "#7C3AED",
  special_questionnaire: "#D97706",
};
const STATUS_LABEL: Record<Template["status"], string> = {
  draft: "koncept",
  published: "publikováno",
  archived: "archiv",
};

function emptyBlocks(): BlockDraft[] {
  return [
    {
      kind: "text",
      content: { text: "Jak jste byli dnes spokojeni?" },
      is_required: false,
    },
    {
      kind: "scale",
      content: { min: 0, max: 10, label: "0 = vůbec, 10 = maximálně" },
      is_required: true,
    },
    {
      kind: "short_text",
      content: { placeholder: "Volitelný komentář..." },
      is_required: false,
    },
  ];
}

export default function SablonyScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme];
  const { selectedTemplate } = useSelectionStore();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [points, setPoints] = useState("5");
  const [category, setCategory] =
    useState<Template["category"]>("questionnaire");
  const [status, setStatus] = useState<Template["status"]>("draft");
  const [blocks, setBlocks] = useState<BlockDraft[]>(emptyBlocks());
  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [positionPickerVisible, setPositionPickerVisible] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<Template | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<number>(1);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await loadTemplates();
      setTemplates(data);
    } catch (e) {
      setError(errorMessage(e as any, "Nepodařilo se načíst šablony."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openCreate = () => {
    setEditingId(null);
    setTitle("");
    setDesc("");
    setPoints("5");
    setCategory("questionnaire");
    setStatus("published");
    setBlocks(emptyBlocks());
    setEditorError(null);
    setEditorVisible(true);
  };

  const openEdit = async (tpl: Template) => {
    try {
      setEditorError(null);
      setIsLoading(true);
      const { template, blocks: dbBlocks } = await loadTemplateDetail(tpl.id);
      setEditingId(template.id);
      setTitle(template.title);
      setDesc(template.description ?? "");
      setPoints(String(template.points));
      setCategory(template.category);
      setStatus(template.status);
      if (dbBlocks.length > 0)
        setBlocks(
          dbBlocks.map((b) => ({
            id: b.id,
            kind: b.kind,
            content: b.content,
            is_required: b.is_required,
          })),
        );
      else setBlocks(emptyBlocks());
      setEditorVisible(true);
    } catch (e) {
      Alert.alert(
        "Chyba",
        errorMessage(e as any, "Nepodařilo se načíst detail."),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    const t = title.trim();
    if (!t) {
      setEditorError("Zadej název.");
      return;
    }
    const pts = parseInt(points, 10);
    if (isNaN(pts) || pts < 0) {
      setEditorError("Body musí být >=0");
      return;
    }
    setIsSaving(true);
    setEditorError(null);
    try {
      let tplId = editingId;
      if (!tplId) {
        const created = await createTemplate({
          title: t,
          description: desc,
          points: pts,
          category,
          status,
        });
        tplId = created.id;
      } else {
        await updateTemplate(tplId, {
          title: t,
          description: desc,
          points: pts,
          category,
          status,
        });
      }
      await saveTemplateBlocks(
        tplId,
        blocks.map((b) => ({
          kind: b.kind,
          content: b.content,
          is_required: b.is_required,
        })),
      );
      setEditorVisible(false);
      await load();
    } catch (e) {
      setEditorError(errorMessage(e as any, "Uložení selhalo."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectAsVzor = (tpl: Template) => {
    setPendingTemplate(tpl);
    setSelectedPosition(selectedTemplate?.position ?? 1);
    setPositionPickerVisible(true);
  };
  const confirmSelectAsVzor = () => {
    if (!pendingTemplate) return;
    setSelectedTemplate({
      id: pendingTemplate.id,
      title: pendingTemplate.title,
      description: pendingTemplate.description,
      points: pendingTemplate.points,
      category: pendingTemplate.category,
      status: pendingTemplate.status,
      position: selectedPosition,
    });
    setPositionPickerVisible(false);
    setPendingTemplate(null);
  };

  const handleDeselect = () => {
    setSelectedTemplate(null);
  };

  const handleDuplicate = async (tpl: Template) => {
    try {
      setIsLoading(true);
      await duplicateTemplate(tpl.id);
      await load();
    } catch (e) {
      Alert.alert("Chyba", errorMessage(e as any, "Duplikace selhala."));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = (tpl: Template) => {
    Alert.alert("Smazat?", `"${tpl.title}"?`, [
      { text: "Zrušit", style: "cancel" },
      {
        text: "Smazat",
        style: "destructive",
        onPress: async () => {
          try {
            setIsLoading(true);
            await deleteTemplate(tpl.id);
            if (selectedTemplate?.id === tpl.id) setSelectedTemplate(null);
            await load();
          } catch (e) {
            Alert.alert("Chyba", errorMessage(e as any, "Smazání selhalo."));
          } finally {
            setIsLoading(false);
          }
        },
      },
    ]);
  };

  const updateBlock = (idx: number, patch: Partial<BlockDraft>) =>
    setBlocks((prev) =>
      prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    );
  const addBlock = (kind: BlockDraft["kind"]) => {
    const defs: Record<string, BlockDraft> = {
      text: {
        kind: "text",
        content: { text: "Nový text" },
        is_required: false,
      },
      scale: {
        kind: "scale",
        content: { min: 0, max: 10, label: "" },
        is_required: true,
      },
      short_text: {
        kind: "short_text",
        content: { placeholder: "Odpověď..." },
        is_required: false,
      },
      image: { kind: "image", content: { caption: "" }, is_required: false },
    };
    setBlocks((prev) => [...prev, defs[kind]]);
  };
  const removeBlock = (idx: number) =>
    setBlocks((prev) => prev.filter((_, i) => i !== idx));
  const moveBlock = (idx: number, dir: -1 | 1) =>
    setBlocks((prev) => {
      const next = [...prev];
      const ni = idx + dir;
      if (ni < 0 || ni >= next.length) return prev;
      [next[idx], next[ni]] = [next[ni], next[idx]];
      return next;
    });

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safeArea, { backgroundColor: theme.background }]}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>SPRÁVA · ŠABLONY</Text>
          <Text style={styles.title}>Vzor dotazníku</Text>
        </View>
        <Pressable onPress={openCreate} style={styles.addBtn}>
          <Ionicons name="add" size={28} color="#fff" />
        </Pressable>
      </View>

      {selectedTemplate ? (
        <View
          style={[
            styles.currentVzor,
            { backgroundColor: "#ECFDF5", borderColor: "#10B981" },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.currentKicker}>AKTUÁLNĚ VYBRANÝ VZOR</Text>
            <Text style={styles.currentTitle}>
              {selectedTemplate.title} · {selectedTemplate.points}b
            </Text>
            <Text style={styles.currentSub}>
              {selectedTemplate.category
                ? (CATEGORY_LABEL[selectedTemplate.category] ??
                  selectedTemplate.category)
                : ""}
              {selectedTemplate.position
                ? ` · pozice ${selectedTemplate.position}`
                : ""}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push("/admin")}
            style={[styles.goDashboard, { backgroundColor: "#059669" }]}
          >
            <Text style={styles.goText}>Jít na Dashboard →</Text>
          </Pressable>
          <Pressable onPress={handleDeselect} style={styles.deselect}>
            <Ionicons name="close-circle" size={22} color="#DC2626" />
          </Pressable>
        </View>
      ) : (
        <View
          style={[
            styles.currentVzor,
            { backgroundColor: "#FEF3C7", borderColor: "#F59E0B" },
          ]}
        >
          <Text style={styles.currentSub}>
            Žádný vzor není vybraný. Vyber jeden níže — pak se ti odemkne
            Odeslat na Dashboardu.
          </Text>
        </View>
      )}

      {isLoading && templates.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : null}
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={load}>
            <Text style={styles.retry}>Zkusit znovu</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.list}>
        {templates.map((tpl) => {
          const isSelected = selectedTemplate?.id === tpl.id;
          return (
            <View
              key={tpl.id}
              style={[
                styles.card,
                {
                  backgroundColor: colorScheme === "dark" ? "#1F2937" : "#fff",
                  borderColor: isSelected ? "#10B981" : theme.tabIconDefault,
                  borderWidth: isSelected ? 2 : 1,
                },
              ]}
            >
              {isSelected ? (
                <View style={styles.selectedRibbon}>
                  <Ionicons name="checkmark-circle" size={16} color="#fff" />
                  <Text style={styles.ribbonText}>VYBRÁNO JAKO VZOR</Text>
                </View>
              ) : null}
              <View style={styles.cardHeader}>
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: CATEGORY_COLOR[tpl.category] },
                  ]}
                >
                  <Text style={styles.badgeText}>
                    {CATEGORY_LABEL[tpl.category]}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    tpl.status === "published"
                      ? styles.published
                      : tpl.status === "archived"
                        ? styles.archived
                        : styles.draft,
                  ]}
                >
                  <Text style={styles.statusText}>
                    {STATUS_LABEL[tpl.status]}
                  </Text>
                </View>
                <Text style={styles.points}>{tpl.points}b</Text>
              </View>
              <Text style={styles.cardTitle}>{tpl.title}</Text>
              {tpl.description ? (
                <Text style={styles.cardDesc}>{tpl.description}</Text>
              ) : null}

              <View style={styles.cardActions}>
                {isSelected ? (
                  <Pressable
                    onPress={handleDeselect}
                    style={[
                      styles.actionBtn,
                      {
                        backgroundColor: "#fff",
                        borderWidth: 1,
                        borderColor: "#10B981",
                      },
                    ]}
                  >
                    <Ionicons name="close" size={16} color="#059669" />
                    <Text style={[styles.actionText, { color: "#059669" }]}>
                      Zrušit výběr
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => handleSelectAsVzor(tpl)}
                    style={[styles.actionBtn, { backgroundColor: "#111827" }]}
                  >
                    <Ionicons name="checkmark" size={16} color="#fff" />
                    <Text style={styles.actionText}>Použít jako vzor</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => openEdit(tpl)}
                  style={[styles.actionBtn, { backgroundColor: "#0F766E" }]}
                >
                  <Ionicons name="create-outline" size={16} color="#fff" />
                  <Text style={styles.actionText}>Upravit</Text>
                </Pressable>
              </View>
              <View style={styles.secondaryRow}>
                <Pressable
                  onPress={() => handleDuplicate(tpl)}
                  style={styles.smallBtn}
                >
                  <Text style={styles.smallText}>Duplikovat</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleDelete(tpl)}
                  style={[styles.smallBtn, { borderColor: "#FCA5A5" }]}
                >
                  <Text style={[styles.smallText, { color: "#DC2626" }]}>
                    Smazat
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })}
        {!isLoading && templates.length === 0 && !error ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Zatím žádné šablony</Text>
            <Pressable
              onPress={openCreate}
              style={[
                styles.actionBtn,
                { backgroundColor: "#0F766E", marginTop: 12 },
              ]}
            >
              <Text style={styles.actionText}>+ Vytvořit první</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal
        visible={editorVisible}
        animationType="slide"
        onRequestClose={() => setEditorVisible(false)}
      >
        <SafeAreaView
          style={[styles.safeArea, { backgroundColor: theme.background }]}
        >
          <View style={styles.editorHeader}>
            <Pressable
              onPress={() => setEditorVisible(false)}
              style={styles.iconBtn}
            >
              <Ionicons name="close" size={26} color={theme.text} />
            </Pressable>
            <Text style={styles.editorTitle}>
              {editingId ? "Upravit" : "Nová šablona"}
            </Text>
            <Pressable
              onPress={handleSave}
              disabled={isSaving}
              style={[styles.saveBtn, isSaving && { opacity: 0.6 }]}
            >
              {isSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveText}>Uložit</Text>
              )}
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.editorContent}>
            {editorError ? (
              <Text style={styles.errorText}>{editorError}</Text>
            ) : null}
            <Text style={styles.label}>Název *</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Např. Denní spokojenost"
              style={[
                styles.input,
                { borderColor: theme.tabIconDefault, color: theme.text },
              ]}
            />
            <Text style={styles.label}>Popis</Text>
            <TextInput
              value={desc}
              onChangeText={setDesc}
              multiline
              style={[
                styles.input,
                styles.multi,
                { borderColor: theme.tabIconDefault, color: theme.text },
              ]}
            />
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Body</Text>
                <TextInput
                  value={points}
                  onChangeText={setPoints}
                  keyboardType="number-pad"
                  style={[
                    styles.input,
                    { borderColor: theme.tabIconDefault, color: theme.text },
                  ]}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Status</Text>
                <View style={styles.chipRow}>
                  {(["draft", "published", "archived"] as const).map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => setStatus(s)}
                      style={[styles.chip, status === s && styles.chipActive]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          status === s && styles.chipActiveText,
                        ]}
                      >
                        {STATUS_LABEL[s]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
            <Text style={styles.label}>Kategorie</Text>
            <View style={styles.chipRow}>
              {(
                [
                  "questionnaire",
                  "advertisement",
                  "special_questionnaire",
                ] as const
              ).map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  style={[styles.chip, category === c && styles.chipActive]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      category === c && styles.chipActiveText,
                    ]}
                  >
                    {CATEGORY_LABEL[c]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.blocksHeader}>
              <Text style={styles.blocksTitle}>Bloky ({blocks.length})</Text>
              <View style={styles.addRow}>
                {(["text", "scale", "short_text", "image"] as const).map(
                  (k) => (
                    <Pressable
                      key={k}
                      onPress={() => addBlock(k)}
                      style={styles.miniAdd}
                    >
                      <Text style={styles.miniText}>+ {k}</Text>
                    </Pressable>
                  ),
                )}
              </View>
            </View>
            {blocks.map((b, idx) => (
              <View
                key={idx}
                style={[
                  styles.blockCard,
                  { borderColor: theme.tabIconDefault },
                ]}
              >
                <View style={styles.blockHead}>
                  <Text style={styles.blockKind}>
                    {b.kind} · {idx + 1}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable
                      onPress={() => moveBlock(idx, -1)}
                      style={styles.blockIcon}
                    >
                      <Ionicons name="arrow-up" size={18} color={theme.text} />
                    </Pressable>
                    <Pressable
                      onPress={() => moveBlock(idx, 1)}
                      style={styles.blockIcon}
                    >
                      <Ionicons
                        name="arrow-down"
                        size={18}
                        color={theme.text}
                      />
                    </Pressable>
                    <Pressable
                      onPress={() => removeBlock(idx)}
                      style={styles.blockIcon}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={18}
                        color="#DC2626"
                      />
                    </Pressable>
                  </View>
                </View>
                {b.kind === "text" ? (
                  <TextInput
                    value={b.content.text ?? ""}
                    onChangeText={(t) =>
                      updateBlock(idx, { content: { ...b.content, text: t } })
                    }
                    placeholder="Text otázky"
                    multiline
                    style={[
                      styles.input,
                      styles.multi,
                      { borderColor: theme.tabIconDefault, color: theme.text },
                    ]}
                  />
                ) : null}
                {b.kind === "scale" ? (
                  <>
                    <TextInput
                      value={b.content.label ?? ""}
                      onChangeText={(t) =>
                        updateBlock(idx, {
                          content: { ...b.content, label: t },
                        })
                      }
                      placeholder="Popis škály"
                      style={[
                        styles.input,
                        {
                          borderColor: theme.tabIconDefault,
                          color: theme.text,
                        },
                      ]}
                    />
                    <View style={styles.row2}>
                      <TextInput
                        value={String(b.content.min ?? 0)}
                        onChangeText={(t) =>
                          updateBlock(idx, {
                            content: { ...b.content, min: parseInt(t) || 0 },
                          })
                        }
                        keyboardType="number-pad"
                        style={[
                          styles.input,
                          {
                            flex: 1,
                            borderColor: theme.tabIconDefault,
                            color: theme.text,
                          },
                        ]}
                      />
                      <TextInput
                        value={String(b.content.max ?? 10)}
                        onChangeText={(t) =>
                          updateBlock(idx, {
                            content: { ...b.content, max: parseInt(t) || 10 },
                          })
                        }
                        keyboardType="number-pad"
                        style={[
                          styles.input,
                          {
                            flex: 1,
                            borderColor: theme.tabIconDefault,
                            color: theme.text,
                          },
                        ]}
                      />
                    </View>
                  </>
                ) : null}
                {b.kind === "short_text" ? (
                  <TextInput
                    value={b.content.placeholder ?? ""}
                    onChangeText={(t) =>
                      updateBlock(idx, {
                        content: { ...b.content, placeholder: t },
                      })
                    }
                    placeholder="Placeholder"
                    style={[
                      styles.input,
                      { borderColor: theme.tabIconDefault, color: theme.text },
                    ]}
                  />
                ) : null}
                {b.kind === "image" ? (
                  <TextInput
                    value={b.content.caption ?? ""}
                    onChangeText={(t) =>
                      updateBlock(idx, {
                        content: { ...b.content, caption: t },
                      })
                    }
                    placeholder="Popisek"
                    style={[
                      styles.input,
                      { borderColor: theme.tabIconDefault, color: theme.text },
                    ]}
                  />
                ) : null}
                <Pressable
                  onPress={() =>
                    updateBlock(idx, { is_required: !b.is_required })
                  }
                  style={styles.reqRow}
                >
                  <View
                    style={[
                      styles.check,
                      b.is_required && {
                        backgroundColor: "#16A34A",
                        borderColor: "#16A34A",
                      },
                    ]}
                  >
                    {b.is_required ? (
                      <Ionicons name="checkmark" size={14} color="#fff" />
                    ) : null}
                  </View>
                  <Text style={styles.reqText}>povinné</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <Modal
        visible={positionPickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setPositionPickerVisible(false)}
      >
        <View style={styles.positionBackdrop}>
          <View
            style={[styles.positionCard, { backgroundColor: theme.background }]}
          >
            <Text style={styles.positionTitle}>Vyber pozici 1-16 (4x4)</Text>
            <Text style={styles.positionSub}>
              {pendingTemplate?.title} · {pendingTemplate?.points}b
            </Text>
            <View style={styles.positionGrid}>
              {Array.from({ length: 16 }, (_, i) => {
                const pos = i + 1;
                const isActive = selectedPosition === pos;
                return (
                  <Pressable
                    key={pos}
                    onPress={() => setSelectedPosition(pos)}
                    style={[styles.posTile, isActive && styles.posTileActive]}
                  >
                    <Text
                      style={[styles.posText, isActive && styles.posTextActive]}
                    >
                      {pos}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.positionActions}>
              <Pressable
                onPress={() => setPositionPickerVisible(false)}
                style={styles.positionCancel}
              >
                <Text style={styles.positionCancelText}>Zrušit</Text>
              </Pressable>
              <Pressable
                onPress={confirmSelectAsVzor}
                style={styles.positionConfirm}
              >
                <Text style={styles.positionConfirmText}>
                  Potvrdit pozici {selectedPosition}
                </Text>
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
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 12,
  },
  kicker: { fontSize: 11, fontWeight: "700", opacity: 0.6, letterSpacing: 1.2 },
  title: { fontSize: 22, fontWeight: "800", marginTop: 2 },
  addBtn: {
    backgroundColor: "#0F766E",
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  currentVzor: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  currentKicker: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    color: "#065F46",
  },
  currentTitle: { fontSize: 15, fontWeight: "800", color: "#064E3B" },
  currentSub: { fontSize: 12, opacity: 0.8, marginTop: 2 },
  goDashboard: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  goText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  deselect: { padding: 4 },
  errorBox: {
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errorText: { color: "#B42318", fontSize: 14 },
  retry: { fontWeight: "700", marginTop: 6, textDecorationLine: "underline" },
  list: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 8,
    overflow: "hidden",
  },
  selectedRibbon: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "#10B981",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  ribbonText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
  },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  draft: { backgroundColor: "#E5E7EB" },
  published: { backgroundColor: "#D1FAE5" },
  archived: { backgroundColor: "#FEF3C7" },
  statusText: { fontSize: 11, fontWeight: "700" },
  points: { marginLeft: "auto", fontWeight: "800" },
  cardTitle: { fontSize: 17, fontWeight: "800" },
  cardDesc: { fontSize: 13, opacity: 0.7 },
  cardActions: { flexDirection: "row", gap: 8, marginTop: 6 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    flex: 1,
    justifyContent: "center",
  },
  actionText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  secondaryRow: { flexDirection: "row", gap: 8 },
  smallBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  smallText: { fontSize: 12, fontWeight: "600" },
  empty: { alignItems: "center", paddingTop: 40 },
  emptyTitle: { fontSize: 18, fontWeight: "800" },
  editorHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  iconBtn: { padding: 4 },
  editorTitle: { flex: 1, fontSize: 18, fontWeight: "800" },
  saveBtn: {
    backgroundColor: "#0F766E",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 80,
    alignItems: "center",
  },
  saveText: { color: "#fff", fontWeight: "800" },
  editorContent: { padding: 16, gap: 10 },
  label: { fontSize: 13, fontWeight: "700", marginTop: 8, opacity: 0.8 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    fontSize: 15,
    marginTop: 4,
  },
  multi: { minHeight: 72, paddingTop: 10, textAlignVertical: "top" },
  row2: { flexDirection: "row", gap: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#D1D5DB",
  },
  chipActive: { backgroundColor: "#0F766E", borderColor: "#0F766E" },
  chipText: { fontSize: 13, fontWeight: "600" },
  chipActiveText: { color: "#fff" },
  blocksHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
  },
  blocksTitle: { fontSize: 16, fontWeight: "800" },
  addRow: { flexDirection: "row", gap: 6 },
  miniAdd: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
  },
  miniText: { fontSize: 11, fontWeight: "700" },
  blockCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    marginTop: 8,
  },
  blockHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  blockKind: { fontSize: 12, fontWeight: "800", opacity: 0.6 },
  blockIcon: { padding: 4 },
  reqRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  check: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
  },
  reqText: { fontSize: 12, fontWeight: "600" },
  positionBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 20,
  },
  positionCard: { borderRadius: 20, padding: 20, gap: 12 },
  positionTitle: { fontSize: 18, fontWeight: "800" },
  positionSub: { fontSize: 13, opacity: 0.7 },
  positionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  posTile: {
    width: 64,
    height: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
  },
  posTileActive: { backgroundColor: "#0F766E", borderColor: "#0F766E" },
  posText: { fontSize: 18, fontWeight: "800" },
  posTextActive: { color: "#fff" },
  positionActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 12,
  },
  positionCancel: { paddingHorizontal: 14, paddingVertical: 10 },
  positionCancelText: { fontWeight: "700" },
  positionConfirm: {
    backgroundColor: "#0F766E",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  positionConfirmText: { color: "#fff", fontWeight: "800" },
});
