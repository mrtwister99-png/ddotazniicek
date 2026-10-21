import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';

import { getAuthSession, isAdminUser } from '@/lib/auth-session';

// Spodní menu admina: Dashboard / Šablony / Výsledky.
export default function AdminLayout() {
  const auth = getAuthSession();

  // Bez přihlášení (nebo bez admin práv) rovnou zpět na login.
  if (!auth || !isAdminUser(auth.user)) {
    return <Redirect href="/" />;
  }

  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: '#0F766E' }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="sablony"
        options={{
          title: 'Šablony',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="vysledky"
        options={{
          title: 'Výsledky',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="stats-chart-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
