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
        tabBarActiveTintColor: "#000",
        tabBarActiveBackgroundColor: "#FFE600",
        tabBarStyle: {
          borderTopWidth: 4,
          borderTopColor: "#000",
          backgroundColor: "#BABABA",
          height: 66 + insets.bottom,
          paddingBottom: insets.bottom + 8,
          paddingTop: 4,
        },
        tabBarLabelStyle: {
          fontFamily: "SpaceMono-Regular",
          fontWeight: "900",
          fontSize: 10,
          textTransform: "uppercase",
        },
        tabBarItemStyle: {
          borderWidth: 3,
          borderColor: "#000",
          margin: 3,
          borderRadius: 0,
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
