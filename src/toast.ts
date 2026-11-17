import { ToastAndroid } from "react-native";

export const toast = (message: string) => {
  ToastAndroid.show(message, ToastAndroid.SHORT);
};
