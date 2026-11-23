import { initReactI18next } from "react-i18next";
import i18n from "./runtime";

if (!i18n.isInitialized) i18n.use(initReactI18next);

export { default, changeLocale, i18nReady } from "./runtime";
