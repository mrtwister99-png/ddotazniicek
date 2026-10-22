import { getAuthSession } from "@/lib/auth-session";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function UserLayout() {
  const insets = useSafeAreaInsets();
  if (!getAuthSession()) {
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
          margin: 5,
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
          title: "DOMŮ",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="historie"
        options={{
          title: "HISTORIE",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="zebricek"
        options={{
          title: "ŽEBŘÍČEK",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trophy-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profil"
        options={{
          title: "PROFIL",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
