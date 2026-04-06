import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#0D0D0D" },
          headerTintColor: "#F5F5F5",
          contentStyle: { backgroundColor: "#0D0D0D" },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="pair"
          options={{ title: "Pair Device", presentation: "modal" }}
        />
      </Stack>
    </>
  );
}
