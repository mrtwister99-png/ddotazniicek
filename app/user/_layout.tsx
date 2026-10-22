import { getAuthSession } from "@/lib/auth-session";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";

export default function UserLayout() {
  // Bez přihlášení rovnou zpět na login.
  if (!getAuthSession()) {
    return <Redirect href="/" />;
  }

  return (
    <Tabs
      screenOptions={{ headerShown: false, tabBarActiveTintColor: "#0F766E" }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Domů",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="historie"
        options={{
          title: "Historie",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="zebricek"
        options={{
          title: "Žebříček",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trophy-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profil"
        options={{
          title: "Profil",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
