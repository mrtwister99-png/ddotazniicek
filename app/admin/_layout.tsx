import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";

import { getAuthSession, isAdminUser } from "@/lib/auth-session";

// Spodní menu admina: Dashboard / Šablony / Výsledky.
export default function AdminLayout() {
  const auth = getAuthSession();

  // Bez přihlášení (nebo bez admin práv) rovnou zpět na login.
  if (!auth || !isAdminUser(auth.user)) {
    return <Redirect href="/" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#000",
        tabBarActiveBackgroundColor: "#FFE600",
        tabBarStyle: {
          borderTopWidth: 4,
          borderTopColor: "#000",
          backgroundColor: "#fff",
          height: 64,
          paddingBottom: 8,
        },
        tabBarLabelStyle: {
          fontFamily: "SpaceMono-Regular",
          fontWeight: "900",
          fontSize: 11,
          textTransform: "uppercase",
        },
        tabBarItemStyle: {
          borderWidth: 3,
          borderColor: "#000",
          margin: 4,
          borderRadius: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "DASHBOARD",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="sablony"
        options={{
          title: "ŠABLONY",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="vysledky"
        options={{
          title: "VÝSLEDKY",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="stats-chart-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
