import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import {
  createFolder,
  errorMessage,
  loadDirectory,
  type Directory,
  type Person,
} from '@/lib/admin-api';
import { clearAuthSession } from '@/lib/auth-session';

type Section = { id: string | null; name: string; members: Person[] };

const GREEN = '#22C55E';

// Zelené kolečko (checkbox) z nákresu.
function Check({ checked, label, onPress }: { checked: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      hitSlop={6}
      onPress={onPress}
      style={styles.checkHit}>
      <View style={[styles.check, checked && { backgroundColor: GREEN }]}>
        {checked ? <Ionicons name="checkmark" size={20} color="#FFFFFF" /> : null}
      </View>
    </Pressable>
  );
}

export default function AdminDashboard() {
  const router = useRouter();
  const theme = Colors[useColorScheme() ?? 'light'];

  const [directory, setDirectory] = useState<Directory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await loadDirectory();
      setDirectory(data);
      // Zahodíme výběr uživatelů, kteří už neexistují.
      setSelected((prev) => new Set([...prev].filter((id) => data.people.some((p) => p.id === id))));
    } catch (error) {
      setLoadError(errorMessage(error, 'Nepodařilo se načíst uživatele. Zkuste to znovu.'));
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

  // Obecná (uživatelé bez složky) je vždy první, pak složky; pod každou její členové.
  const sections = useMemo<Section[]>(() => {
    if (!directory) return [];
    const folderOf = new Map(directory.memberships.map((m) => [m.user_id, m.group_id]));
    const membersOf = (folderId: string | null) =>
      directory.people.filter((p) => (folderOf.get(p.id) ?? null) === folderId);
    return [
      { id: null, name: 'Obecná', members: membersOf(null) },
      ...directory.folders.map((f) => ({ id: f.id, name: f.name, members: membersOf(f.id) })),
    ];
  }, [directory]);

  const toggleUser = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Klik na složku vybere (nebo odebere) všechny její členy.
  const toggleSection = (section: Section) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = section.members.length > 0 && section.members.every((m) => next.has(m.id));
      for (const member of section.members) {
        if (allSelected) next.delete(member.id);
        else next.add(member.id);
      }
      return next;
    });

  const submitFolder = async () => {
    const name = folderName.trim();
    if (!name || isSaving) return;
    setIsSaving(true);
    setFolderError(null);
    try {
      await createFolder(name);
      setIsModalVisible(false);
      setFolderName('');
      await load();
    } catch (error) {
      setFolderError(errorMessage(error, 'Složku se nepodařilo vytvořit.'));
    } finally {
      setIsSaving(false);
    }
  };

  const logout = () => {
    clearAuthSession();
    router.replace('/');
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <View style={styles.headerTexts}>
          <Text style={styles.kicker}>SPRÁVA · UŽIVATELÉ</Text>
          <Text style={styles.title}>Komu pošleme formulář?</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Odhlásit se"
          onPress={logout}
          style={styles.iconButton}>
          <Ionicons name="log-out-outline" size={24} color={theme.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Nová složka"
          onPress={() => {
            setFolderError(null);
            setIsModalVisible(true);
          }}
          style={styles.addButton}>
          <Ionicons name="add" size={30} color="#FFFFFF" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {isLoading && !directory ? <ActivityIndicator size="large" /> : null}

        {loadError ? (
          <View>
            <Text style={styles.error}>{loadError}</Text>
            <Pressable accessibilityRole="button" onPress={load} style={styles.retry}>
              <Text style={styles.retryText}>Zkusit znovu</Text>
            </Pressable>
          </View>
        ) : null}

        {sections.map((section) => (
          <View key={section.id ?? 'general'}>
            <View style={styles.rowWrap}>
              <View style={[styles.row, styles.folderRow]}>
                <Ionicons name="folder" size={22} color="#1F2937" />
                <Text style={[styles.rowText, { color: '#1F2937' }]}>{section.name}</Text>
                <Text style={[styles.count, { color: '#1F2937' }]}>{section.members.length}</Text>
              </View>
              {section.members.length > 0 ? (
                <Check
                  label={`Vybrat všechny ve složce ${section.name}`}
                  checked={section.members.every((m) => selected.has(m.id))}
                  onPress={() => toggleSection(section)}
                />
              ) : (
                <View style={styles.checkHit} />
              )}
            </View>

            {section.members.map((person) => {
              const name = person.display_name ?? person.username ?? 'Bez jména';
              return (
                <View key={person.id} style={styles.rowWrap}>
                  <View style={[styles.row, styles.userRow]}>
                    <Ionicons name="person" size={20} color="#FFFFFF" />
                    <Text style={[styles.rowText, { color: '#FFFFFF' }]}>{name}</Text>
                  </View>
                  <Check
                    label={`Vybrat uživatele ${name}`}
                    checked={selected.has(person.id)}
                    onPress={() => toggleUser(person.id)}
                  />
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.bottomBar, { borderColor: theme.tabIconDefault }]}>
        <Text style={styles.summary}>
          Vybráno: {selected.size} · vzor zatím není vybrán
        </Text>
        <View style={styles.actions}>
          {/* Vzor: zatím vede do Šablon, kde se vzor bude vybírat. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/admin/sablony')}
            style={[styles.action, { flex: 2 }]}>
            <Text style={styles.actionText}>Vzor dotazníku</Text>
          </Pressable>
          {/* Odeslat: vypnuto, dokud nejsou šablony a odesílání zapojené. */}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            disabled
            style={[styles.action, styles.actionDisabled, { flex: 1 }]}>
            <Text style={styles.actionText}>Odeslat</Text>
          </Pressable>
        </View>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={isModalVisible}
        onRequestClose={() => setIsModalVisible(false)}>
        <View style={styles.overlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.background }]}>
            <Text style={styles.modalTitle}>Nová složka</Text>
            <TextInput
              accessibilityLabel="Název složky"
              autoFocus
              maxLength={80}
              onChangeText={setFolderName}
              onSubmitEditing={submitFolder}
              placeholder="Název složky"
              placeholderTextColor="#888"
              returnKeyType="done"
              style={[styles.input, { borderColor: theme.tabIconDefault, color: theme.text }]}
              value={folderName}
            />
            {folderError ? <Text style={styles.error}>{folderError}</Text> : null}
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setIsModalVisible(false)}
                style={[styles.action, styles.actionLight, { flex: 1 }]}>
                <Text style={[styles.actionText, { color: '#1F2937' }]}>Zrušit</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isSaving || folderName.trim().length === 0}
                onPress={submitFolder}
                style={[
                  styles.action,
                  { flex: 1 },
                  (isSaving || folderName.trim().length === 0) && styles.actionDisabled,
                ]}>
                <Text style={styles.actionText}>{isSaving ? 'Vytvářím…' : 'Vytvořit'}</Text>
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
  header: { alignItems: 'center', flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12 },
  headerTexts: { flex: 1 },
  kicker: { fontSize: 12, letterSpacing: 1, opacity: 0.6 },
  title: { fontSize: 22, fontWeight: '700', marginTop: 4 },
  iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  addButton: {
    alignItems: 'center',
    backgroundColor: '#EF4444',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    marginLeft: 4,
    width: 48,
  },
  list: { padding: 16 },
  rowWrap: { alignItems: 'center', flexDirection: 'row', marginBottom: 10 },
  row: {
    alignItems: 'center',
    borderRadius: 10,
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  folderRow: { backgroundColor: '#F59E0B' },
  userRow: { backgroundColor: '#2563EB', marginLeft: 28 },
  rowText: { flex: 1, fontSize: 16, fontWeight: '600' },
  count: { fontSize: 14, fontWeight: '600', opacity: 0.7 },
  checkHit: { alignItems: 'center', height: 44, justifyContent: 'center', marginLeft: 8, width: 44 },
  check: {
    alignItems: 'center',
    borderColor: GREEN,
    borderRadius: 16,
    borderWidth: 2,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  bottomBar: { borderTopWidth: 1, padding: 12 },
  summary: { fontSize: 14, marginBottom: 8, opacity: 0.7 },
  actions: { flexDirection: 'row', gap: 10 },
  action: {
    alignItems: 'center',
    backgroundColor: '#1F2937',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 48,
  },
  actionLight: { backgroundColor: '#E5E7EB' },
  actionDisabled: { opacity: 0.45 },
  actionText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  error: { color: '#B42318', fontSize: 15, marginBottom: 12 },
  retry: { alignSelf: 'flex-start', paddingVertical: 8 },
  retryText: { fontSize: 16, fontWeight: '600', textDecorationLine: 'underline' },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: { borderRadius: 14, gap: 12, maxWidth: 400, padding: 20, width: '100%' },
  modalTitle: { fontSize: 20, fontWeight: '700' },
  input: { borderRadius: 10, borderWidth: 1, fontSize: 16, minHeight: 52, paddingHorizontal: 14 },
});
