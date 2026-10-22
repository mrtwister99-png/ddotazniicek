import { getAuthSession, isAdminUser } from "@/lib/auth-session";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function AdminLayout() {
  const auth = getAuthSession();
  const insets = useSafeAreaInsets();
  if (!auth || !isAdminUser(auth.user)) {
    return <Redirect href="/" />;
  }
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: "#000",
        tabBarActiveBackgroundColor: "#FFE600",
        tabBarStyle: {
          borderTopWidth: 4,
          borderTopColor: "#000",
          backgroundColor: "#BABABA",
          height: 72 + insets.bottom,
          paddingBottom: insets.bottom + 8,
          paddingTop: 6,
        },
        tabBarItemStyle: {
          borderWidth: 4,
          borderColor: "#000",
          margin: 6,
          borderRadius: 0,
          backgroundColor: "#fff",
          shadowColor: "#000",
          shadowOffset: { width: 3, height: 3 },
          shadowOpacity: 1,
          shadowRadius: 0,
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
