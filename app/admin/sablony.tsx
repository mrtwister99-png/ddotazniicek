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

import { BrutalBadge } from "@/components/BrutalBadge";
import { BrutalButton } from "@/components/BrutalButton";
import { PositionPicker } from "@/components/PositionPicker";
import { Text, View } from "@/components/Themed";
import { useColorScheme } from "@/components/useColorScheme";
import Colors from "@/constants/Colors";
import { GLOBAL_MAX, GLOBAL_MIN, SPECIAL_POS } from "@/constants/positions";
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  errorMessage,
  loadTemplateDetail,
  loadTemplates,
  publishGlobalTemplate,
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
  special_questionnaire: "S · speciál",
} as any;
const CATEGORY_COLOR: Record<Template["category"], string> = {
  questionnaire: "#0F766E",
  special_questionnaire: "#D97706",
} as any;
// STATUS ZRUŠEN - brutalism: vždy publikováno, žádný výběr

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
  const [isPublishingGlobal, setIsPublishingGlobal] = useState(false);

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
    // FLOW 2 NOVY: vzor = VZDY 16, bez modalu, jen vyberes uzivatele v Dashboardu
    setSelectedTemplate({
      id: tpl.id,
      title: tpl.title,
      description: tpl.description,
      points: tpl.points,
      category: tpl.category,
      status: tpl.status,
      position: 16,
    });
    Alert.alert(
      "Vzor vybrán na 16",
      `"${tpl.title}" bude poslán vybraným uživatelům na speciální pozici 16. Jdi na Dashboard.`,
    );
  };

  const handleLongPressPublishAll = (tpl: Template) => {
    // FLOW 1: vzdy 1-15 pro vsechny, isGlobal state uz neni potreba
    setPendingTemplate(tpl);
    setSelectedPosition(1);
    setPositionPickerVisible(true);
  };

  const confirmPublishToAll = async () => {
    if (!pendingTemplate) return;
    if (isPublishingGlobal) return;
    if (selectedPosition < 1 || selectedPosition > 15) {
      Alert.alert("Chyba", "Pro všechny lze jen 1-15. 16 je speciální.");
      return;
    }
    setIsPublishingGlobal(true);
    try {
      await publishGlobalTemplate(pendingTemplate.id, selectedPosition);
      Alert.alert(
        "Publikováno všem",
        `✅ "${pendingTemplate.title}" je globální na pozici ${selectedPosition}. Bez notifikace.`,
      );
      setPositionPickerVisible(false);
      setPendingTemplate(null);
      await load();
    } catch (e) {
      Alert.alert("Chyba", errorMessage(e as any, "Publikování selhalo."));
    } finally {
      setIsPublishingGlobal(false);
    }
  };

  const handlePositionConfirm = () => {
    void confirmPublishToAll();
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
        <View style={{ position: "relative" }}>
          <View
            style={{
              position: "absolute",
              top: 6,
              left: 6,
              width: 48,
              height: 48,
              backgroundColor: "#000",
            }}
          />
          <Pressable
            onPress={openCreate}
            style={[
              styles.addBtn,
              {
                backgroundColor: "#FFE600",
                borderWidth: 4,
                borderColor: "#000",
                borderRadius: 0,
                shadowColor: "#000",
                shadowOffset: { width: 6, height: 6 },
                shadowOpacity: 1,
                shadowRadius: 0,
              },
            ]}
          >
            <Ionicons name="add" size={28} color="#000" />
          </Pressable>
        </View>
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
      ) : null}

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
            <Pressable
              key={tpl.id}
              onLongPress={() => handleLongPressPublishAll(tpl)}
              delayLongPress={600}
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
                <BrutalBadge
                  label={CATEGORY_LABEL[tpl.category] ?? tpl.category}
                  bg={CATEGORY_COLOR[tpl.category] ?? "#000"}
                  color="#fff"
                  rotate="-1deg"
                />
                {tpl.is_global ? (
                  <BrutalBadge
                    label={`GLOBAL ${tpl.global_position}`}
                    bg="#FFE600"
                    color="#000"
                    rotate="1deg"
                  />
                ) : null}
                <Text
                  style={[
                    styles.points,
                    {
                      fontFamily: "SpaceMono-Regular",
                      fontWeight: "900",
                      borderWidth: 3,
                      borderColor: "#000",
                      backgroundColor: "#FFE600",
                      paddingHorizontal: 6,
                    },
                  ]}
                >
                  {tpl.points}b
                </Text>
              </View>
              <Text style={styles.cardTitle}>{tpl.title}</Text>
              {tpl.description ? (
                <Text style={styles.cardDesc}>{tpl.description}</Text>
              ) : null}

              <View style={styles.cardActions}>
                {isSelected ? (
                  <BrutalButton
                    title="Zrušit výběr"
                    variant="white"
                    onPress={handleDeselect}
                  />
                ) : (
                  <BrutalButton
                    title="Použít jako vzor"
                    variant="black"
                    onPress={() => handleSelectAsVzor(tpl)}
                  />
                )}
                <BrutalButton
                  title="Upravit"
                  variant="yellow"
                  onPress={() => openEdit(tpl)}
                />
              </View>
              <View style={styles.secondaryRow}>
                <BrutalButton
                  title="Duplikovat"
                  variant="white"
                  onPress={() => handleDuplicate(tpl)}
                />
                <BrutalButton
                  title="Smazat"
                  variant="pink"
                  onPress={() => handleDelete(tpl)}
                />
              </View>
              <View style={{ height: 8 }} />
            </Pressable>
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
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Body</Text>
              <TextInput
                value={points}
                onChangeText={setPoints}
                keyboardType="number-pad"
                style={[
                  styles.input,
                  {
                    borderColor: "#000",
                    color: theme.text,
                    borderWidth: 4,
                    borderRadius: 0,
                    backgroundColor: "#fff",
                  },
                ]}
              />
            </View>
            <Text style={styles.label}>Kategorie</Text>
            <View style={styles.chipRow}>
              {(["questionnaire", "special_questionnaire"] as const).map(
                (c) => (
                  <Pressable
                    key={c}
                    onPress={() => setCategory(c)}
                    style={[
                      styles.chip,
                      category === c && styles.chipActive,
                      {
                        borderWidth: 4,
                        borderColor: "#000",
                        borderRadius: 0,
                        shadowColor: "#000",
                        shadowOffset: { width: 4, height: 4 },
                        shadowOpacity: 1,
                        shadowRadius: 0,
                      },
                    ]}
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
                ),
              )}
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
      <PositionPicker
        visible={positionPickerVisible}
        title={`Publikovat VŠEM na pozici ${GLOBAL_MIN}-${GLOBAL_MAX}`}
        sub={`${pendingTemplate?.title ?? ""} · ${pendingTemplate?.points ?? ""}b · VŠEM · ${SPECIAL_POS} je speciální`}
        selectedPosition={selectedPosition}
        onSelect={setSelectedPosition}
        onConfirm={handlePositionConfirm}
        onCancel={() => {
          setPositionPickerVisible(false);
        }}
        isLoading={isPublishingGlobal}
        min={GLOBAL_MIN}
        max={GLOBAL_MAX}
        confirmText={`Publikovat všem na ${selectedPosition}`}
      />
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
    backgroundColor: "#FFE600",
    width: 48,
    height: 48,
    borderRadius: 0,
    borderWidth: 4,
    borderColor: "#000",
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
    borderRadius: 0,
    borderWidth: 4,
    borderColor: "#000",
    padding: 14,
    gap: 8,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 6, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 0,
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
    borderWidth: 4,
    borderRadius: 0,
    minHeight: 52,
    paddingHorizontal: 14,
    fontSize: 16,
    marginTop: 6,
    backgroundColor: "#fff",
    fontFamily: "SpaceMono-Regular",
    shadowColor: "#000",
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  multi: { minHeight: 88, paddingTop: 12, textAlignVertical: "top" },
  row2: { flexDirection: "row", gap: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 0,
    borderWidth: 4,
    borderColor: "#000",
    backgroundColor: "#fff",
  },
  chipActive: { backgroundColor: "#000", borderColor: "#000" },
  chipText: {
    fontSize: 13,
    fontWeight: "900",
    fontFamily: "SpaceMono-Regular",
    textTransform: "uppercase",
  },
  chipActiveText: { color: "#FFE600" },
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
});
