import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { clearAuthSession, getAuthSession } from '@/lib/auth-session';

export default function ProfileScreen() {
  const router = useRouter();
  const theme = Colors[useColorScheme() ?? 'light'];
  const meta = (getAuthSession()?.user as { user_metadata?: { username?: unknown } } | undefined)
    ?.user_metadata;
  const nickname = typeof meta?.username === 'string' ? meta.username : null;

  const logout = () => {
    clearAuthSession();
    router.replace('/');
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        <Text style={styles.title}>Profil</Text>
        {nickname ? <Text style={styles.subtitle}>Přezdívka: {nickname}</Text> : null}
        <Pressable accessibilityRole="button" onPress={logout} style={styles.logout}>
          <Text style={styles.logoutText}>Odhlásit se</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: 24 },
  title: { fontSize: 30, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 16, marginBottom: 24 },
  logout: {
    alignItems: 'center',
    backgroundColor: '#0F766E',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 52,
  },
  logoutText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
