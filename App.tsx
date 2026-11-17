import React from "react";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { Text } from "react-native";
import { colors } from "./src/theme";
import { initDb } from "./src/db";
import LibraryScreen from "./src/screens/LibraryScreen";
import CatalogScreen from "./src/screens/CatalogScreen";
import EpubScreen from "./src/screens/EpubScreen";
import ReaderScreen from "./src/screens/ReaderScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import BookScreen from "./src/screens/BookScreen";
import UpdateGate from "./src/components/UpdateGate";

initDb();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg },
};

export type RootStackParamList = {
  Tabs: undefined;
  Book: { bookId?: number; slug?: string };
  Reader: { bookId: number; chapterId: number };
};

export type TabParamList = {
  Library: undefined;
  Catalog: undefined;
  Epub: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function tabIcon(label: string, focused: boolean) {
  return <Text style={{ fontSize: 18, color: focused ? colors.accent : colors.dim }}>{label}</Text>;
}

function TabsScreen() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.accent,
        headerTitleStyle: { color: colors.text },
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.dim,
      }}
    >
      <Tab.Screen
        name="Library"
        component={LibraryScreen}
        options={{ title: "Библиотека", tabBarIcon: ({ focused }) => tabIcon("📚", focused) }}
      />
      <Tab.Screen
        name="Catalog"
        component={CatalogScreen}
        options={{ title: "Каталог", tabBarIcon: ({ focused }) => tabIcon("🔍", focused) }}
      />
      <Tab.Screen
        name="Epub"
        component={EpubScreen}
        options={{ title: "EPUB", tabBarIcon: ({ focused }) => tabIcon("📄", focused) }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: "Настройки", tabBarIcon: ({ focused }) => tabIcon("⚙️", focused) }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="light" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.accent,
          headerTitleStyle: { color: colors.text },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="Tabs" component={TabsScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Book" component={BookScreen} options={{ title: "" }} />
        <Stack.Screen
          name="Reader"
          component={ReaderScreen}
          options={{ headerTitle: "", headerBackTitle: "Назад" }}
        />
      </Stack.Navigator>
      <UpdateGate />
    </NavigationContainer>
  );
}
