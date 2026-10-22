import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text, View } from "@/components/Themed";
import { useColorScheme } from "@/components/useColorScheme";
import Colors, { NEO } from "@/constants/Colors";
import { errorMessage } from "@/lib/admin-api";
import { asArray, rest } from "@/lib/supabase-rest";

type ResultRow = {
  id: string;
  submitted_at: string;
  original_answers: any;
  delivery_id: string;
  user_id: string;
  profiles: { username: string | null } | null;
  form_deliveries: {
    template_id: string;
    position: number | null;
    templates: { title: string } | { title: string }[] | null;
  } | null;
};

export default function VysledkyScreen() {
  const theme = Colors[useColorScheme() ?? "light"];
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [onlySpecial, setOnlySpecial] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      let data: unknown;
      try {
        data = await rest(
          "responses?select=id,submitted_at,original_answers,delivery_id,user_id,profiles(username),form_deliveries(template_id,position,templates(title))&order=submitted_at.desc&limit=100",
        );
      } catch {
        data = await rest(
          "responses?select=id,submitted_at,original_answers,delivery_id,user_id&order=submitted_at.desc&limit=100",
        );
      }
      const rows = asArray<ResultRow>(data);
      setRows(rows);
    } catch (e) {
      setErr(
        errorMessage(
          e,
          "Nepodařilo se načíst výsledky. Zkontroluj v Supabase tabulku responses zda tam jsou data.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safeArea, { backgroundColor: theme.background }]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Výsledky ({rows.length})</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={() => setOnlySpecial(false)}
            style={{
              backgroundColor: !onlySpecial ? NEO.black : "#fff",
              borderWidth: 2,
              borderColor: NEO.black,
              padding: 8,
            }}
          >
            <Text
              style={{
                color: !onlySpecial ? "#fff" : "#000",
                fontWeight: "900",
              }}
            >
              VŠE
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setOnlySpecial(true)}
            style={{
              backgroundColor: onlySpecial ? NEO.red : "#fff",
              borderWidth: 2,
              borderColor: NEO.black,
              padding: 8,
            }}
          >
            <Text
              style={{
                color: onlySpecial ? "#fff" : "#000",
                fontWeight: "900",
              }}
            >
              JEN 16 SPECIÁL
            </Text>
          </Pressable>
        </View>
        {loading ? <ActivityIndicator /> : null}
        {err ? <Text style={{ color: "#B42318" }}>{err}</Text> : null}
        {(onlySpecial
          ? rows.filter((r) => r.form_deliveries?.position === 16)
          : rows
        ).map((r) => {
          const tpl = Array.isArray(r.form_deliveries?.templates)
            ? r.form_deliveries?.templates[0]
            : r.form_deliveries?.templates;
          const isSpecial = r.form_deliveries?.position === 16;
          return (
            <View
              key={r.id}
              style={[
                styles.card,
                {
                  backgroundColor: isSpecial ? "#FFE6E6" : "#fff",
                  borderColor: isSpecial ? "#DC2626" : NEO.black,
                  borderWidth: isSpecial ? 4 : 3,
                  shadowColor: isSpecial ? "#DC2626" : "#000",
                  shadowOffset: isSpecial ? { width: 4, height: 4 } : undefined,
                  shadowOpacity: isSpecial ? 1 : undefined,
                },
              ]}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <Text style={{ fontWeight: "900" }}>
                  {isSpecial ? "[16] " : ""}
                  {tpl?.title ?? r.delivery_id.slice(0, 8)}
                </Text>
                <Text
                  style={{
                    backgroundColor: isSpecial ? NEO.red : NEO.yellow,
                    paddingHorizontal: 6,
                    fontWeight: "900",
                  }}
                >
                  {isSpecial
                    ? "SPECIÁL"
                    : `POS ${r.form_deliveries?.position ?? "?"}`}
                </Text>
              </View>
              <Text style={{ marginTop: 4, opacity: 0.7 }}>
                {r.profiles?.username ?? r.user_id.slice(0, 8)} ·{" "}
                {new Date(r.submitted_at).toLocaleString("cs-CZ")}
              </Text>
              <Text style={{ marginTop: 8, fontFamily: "SpaceMono-Regular" }}>
                {JSON.stringify(r.original_answers).slice(0, 300)}
              </Text>
            </View>
          );
        })}
        <Pressable
          onPress={load}
          style={{
            marginTop: 20,
            backgroundColor: NEO.black,
            padding: 12,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900" }}>Obnovit</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title: {
    fontSize: 28,
    fontWeight: "900",
    marginBottom: 12,
    fontFamily: "SpaceMono-Regular",
  },
  card: { padding: 12, borderRadius: 0 },
});
