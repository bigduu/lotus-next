import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, "..");

const runtimeResolver = "src/runtime/browserRuntime.ts";
const runtimeContract = "src/runtime/runtimeConfig.ts";
const preloadErrorPolicy = "src/runtime/preloadErrorPolicy.ts";
const compositionRoot = "src/main.tsx";
const httpOwner = "src/services/api/transport.ts";
const apiCompositionOwner = "src/services/api/index.ts";
const apiClientOwner = "src/services/api/client.ts";
const viteConfiguration = "vite.config.ts";
const browserHttpTransportFactory = "createBrowserHttpTransport";
const httpTransportType = "HttpTransport";
const websocketOwner = "src/services/chat/v2Stream.ts";
const websocketReadDebtOwner = "src/services/chat/accountFeed.ts";
const apiClientValueOwners = new Set([apiClientOwner, apiCompositionOwner]);
const browserHttpTransportFactoryOwners = new Set([httpOwner, apiCompositionOwner]);
const ownerClassAllowedConstructors = new Map([
  [apiClientOwner, new Set(["ApiError", "Headers"])],
  [httpOwner, new Set(["NetworkRequestError", "TypeError"])],
]);
const runtimeLocalImportAllowlist = new Map([
  [runtimeResolver, new Set(["./runtimeConfig", "./runtimeConfig.ts"])],
  [runtimeContract, new Set()],
  [preloadErrorPolicy, new Set()],
]);
const runtimeCompositionApiOwners = new Map([
  ["installRuntimeConfig", new Set([compositionRoot, runtimeContract])],
  ["createRuntimeConfig", new Set([runtimeResolver, runtimeContract])],
  ["createRuntimeEndpointSet", new Set([runtimeResolver, runtimeContract])],
  ["resolveBrowserRuntimeConfig", new Set([runtimeResolver])],
  ["resolveDefaultBrowserRuntimeConfig", new Set([runtimeResolver, compositionRoot])],
  ["__resetRuntimeConfigForTests", new Set([runtimeContract])],
]);

const tauriDebtOwners = new Set([
  runtimeResolver,
  "src/services/notification/desktopNotification.ts",
  "src/shared/services/FileOperationsService.ts",
  "src/shared/utils/openExternalLink.ts",
  "src/shared/utils/osInfoUtils.ts",
]);

const endpointConsumers = new Set([apiCompositionOwner, websocketOwner]);
const runtimeEndpointInterface = "RuntimeEndpointSet";
const canonicalRuntimeEndpointFields = new Set(["nativeApi", "origin", "v2Stream"]);
const deprecatedNativeApiNames = new Set(["standardApi", "agentApi", "agentApiClient"]);
const retiredProviderPaths = new Set([
  "/bamboo/settings/provider",
  "/bamboo/settings/provider/models",
]);
const notificationChannelComponentRoot = "src/components/chat/settings/notifications/";
const notificationChannelPageOwner = "src/components/chat/settings/SettingsNotifications.tsx";
const notificationChannelServiceOwner = "src/services/notification/notificationChannelsApi.ts";
const notificationPreferencesServiceOwner =
  "src/services/notification/notificationPreferencesApi.ts";
const notificationChannelAllowedRequests = new Set([
  "get:bamboo/config/notifications",
  "put:bamboo/config/notifications",
  "post:notifications/test",
]);
const notificationPreferencesAllowedRequests = new Set([
  "get:notifications/preferences",
  "put:notifications/preferences",
]);
const notificationAuthorityServiceApiBindings = new Map([
  [
    notificationChannelServiceOwner,
    new Set(["apiClient", "getErrorMessage", "isApiError", "isRequestError"]),
  ],
  [notificationPreferencesServiceOwner, new Set(["apiClient"])],
]);
const notificationChannelComponentAllowedDependencies = new Set([
  "src/components/ui/button",
  "src/components/ui/input",
  "src/components/ui/select",
  "src/components/ui/switch",
  "src/lib/secrets",
  "src/services/notification/notificationChannelsApi",
]);
const notificationChannelPageAllowedDependencies = new Set([
  "src/components/ui/button",
  "src/components/ui/switch",
  "src/lib/notify",
  "src/lib/utils",
  "src/services/notification/notificationPreferencesApi",
]);
const notificationChannelTrustedLeafAllowedDependencies = new Map([
  ["src/lib/secrets.ts", new Set()],
  ["src/lib/notify.ts", new Set()],
  ["src/lib/utils.ts", new Set()],
  ["src/components/ui/button.tsx", new Set(["src/lib/utils"])],
  ["src/components/ui/input.tsx", new Set(["src/lib/utils"])],
  ["src/components/ui/select.tsx", new Set(["src/lib/utils"])],
  ["src/components/ui/switch.tsx", new Set(["src/lib/utils"])],
]);
const notificationProtectedPhysicalDependencies = new Map([
  ["src/components/chat/settings/SettingsNotifications", notificationChannelPageOwner],
  ["src/services/notification/notificationChannelsApi", notificationChannelServiceOwner],
  ["src/services/notification/notificationPreferencesApi", notificationPreferencesServiceOwner],
  ["src/services/api", "src/services/api/index.ts"],
  ["src/lib/secrets", "src/lib/secrets.ts"],
  ["src/lib/notify", "src/lib/notify.ts"],
  ["src/lib/utils", "src/lib/utils.ts"],
  ["src/components/ui/button", "src/components/ui/button.tsx"],
  ["src/components/ui/input", "src/components/ui/input.tsx"],
  ["src/components/ui/select", "src/components/ui/select.tsx"],
  ["src/components/ui/switch", "src/components/ui/switch.tsx"],
]);
const notificationProtectedPhysicalFiles = new Set(
  notificationProtectedPhysicalDependencies.values(),
);
const notificationProtectedDependencySpecifiers = new Map([
  [
    "src/services/notification/notificationChannelsApi",
    "@services/notification/notificationChannelsApi.ts",
  ],
  [
    "src/services/notification/notificationPreferencesApi",
    "@services/notification/notificationPreferencesApi.ts",
  ],
  ["src/services/api", "../api/index.ts"],
  ["src/lib/secrets", "@/lib/secrets.ts"],
  ["src/lib/notify", "@/lib/notify.ts"],
  ["src/lib/utils", "@/lib/utils.ts"],
  ["src/components/ui/button", "@/components/ui/button.tsx"],
  ["src/components/ui/input", "@/components/ui/input.tsx"],
  ["src/components/ui/select", "@/components/ui/select.tsx"],
  ["src/components/ui/switch", "@/components/ui/switch.tsx"],
]);
const notificationWholeConfigCallNames = new Set([
  "delete",
  "fetchRaw",
  "get",
  "patch",
  "post",
  "put",
]);
const notificationWholeConfigFacadeCallNames = new Set([
  "getBambooConfig",
  "loadConfig",
  "patchConfig",
  "resetBambooConfig",
  "saveConfig",
  "setBambooConfig",
  "validateBambooConfigPatch",
]);
const backendOverrideStorageNames = new Set([
  "BACKEND_OVERRIDE_STORAGE_KEY",
  "LEGACY_BACKEND_OVERRIDE_STORAGE_KEY",
]);
const backendOverrideStorageKeys = new Set([
  "lotus_next_backend_endpoint_v1",
  "copilot_backend_base_url",
]);
const nonRuntimeEndpointBindingOwners = new Set([
  "src/components/chat/settings/metrics/ForwardEndpointsList.tsx",
]);
const rawEndpointOwners = new Set([
  runtimeResolver,
  runtimeContract,
  "src/shared/i18n/resources/en-US.ts",
  "src/shared/i18n/resources/zh-CN.ts",
]);
const providerEndpointDebt = new Map([
  ["src/components/chat/settings/providers/InstanceEditor.tsx", new Set(["https://api.openai.com/v1"])],
  [
    "src/lib/providerPresets.ts",
    new Set([
      "https://api.deepseek.com/v1",
      "https://api.minimax.io/v1",
      "https://api.minimaxi.com/v1",
      "https://api.moonshot.cn/v1",
    ]),
  ],
  ["src/shared/i18n/index.ts", new Set(["https://api.openai.com/v1"])],
  [
    "src/shared/i18n/resources/en-US.ts",
    new Set(["https://api.openai.com/v1", "https://api.anthropic.com/v1"]),
  ],
  [
    "src/shared/i18n/resources/zh-CN.ts",
    new Set(["https://api.openai.com/v1", "https://api.anthropic.com/v1"]),
  ],
]);

const codeExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const secretShapedViteName =
  /^VITE_[A-Z0-9_]*(?:API_KEY|CREDENTIAL|PASSWORD|PRIVATE_KEY|SECRET|TOKEN)[A-Z0-9_]*$/i;
const endpointViteName =
  /^VITE_[A-Z0-9_]*(?:API|BACKEND|BASE_URL|ENDPOINT|HTTP|ORIGIN|WEBSOCKET|WS)[A-Z0-9_]*$/i;
const allowedPublicViteNames = new Set([
  "VITE_APP_REVISION",
  "VITE_APP_VERSION",
  "VITE_BACKEND_BASE_URL",
]);
const tauriGlobalNames = new Set([
  "__TAURI_INTERNALS__",
  "__BAMBOO_BACKEND_PORT__",
  "__TAURI__",
]);
const alternateHttpPackages = new Set([
  "@microsoft/fetch-event-source",
  "axios",
  "cross-fetch",
  "event-source-polyfill",
  "eventsource",
  "fetch-event-source",
  "got",
  "ky",
  "node-fetch",
  "ofetch",
  "superagent",
  "undici",
  "wretch",
]);
const alternateTransportNames = new Set(["EventSource", "XMLHttpRequest"]);
const localAliases = ["@", "@app", "@components", "@hooks", "@pages", "@services", "@shared"];

const expectedInventory = {
  "raw-endpoint": {
    "src/runtime/browserRuntime.ts": 1,
    "src/runtime/runtimeConfig.ts": 2,
    "src/shared/i18n/resources/en-US.ts": 1,
    "src/shared/i18n/resources/zh-CN.ts": 1,
  },
  "import-meta-env": {
    "src/runtime/browserRuntime.ts": 5,
    "src/shared/store/appStore/index.ts": 1,
    "src/shared/store/appStore/slices/executionStateSlice/reducer.ts": 1,
    "src/shared/utils/debugFlags.ts": 2,
  },
  "endpoint-override-storage": {
    "src/runtime/browserRuntime.ts": 30,
  },
  "tauri-runtime": {
    "src/runtime/browserRuntime.ts": 4,
    "src/services/notification/desktopNotification.ts": 2,
    "src/shared/services/FileOperationsService.ts": 2,
    "src/shared/utils/openExternalLink.ts": 1,
    "src/shared/utils/osInfoUtils.ts": 1,
  },
  "fetch-reference": {
    "src/services/api/transport.ts": 1,
  },
  "http-transport-constructor": {
    "src/services/api/transport.ts": 1,
  },
  "browser-http-transport-composition": {
    "src/services/api/index.ts": 1,
  },
  "websocket-constructor": {
    "src/services/chat/v2Stream.ts": 2,
  },
  "websocket-read-debt": {
    "src/services/chat/accountFeed.ts": 1,
  },
  "api-client-constructor": {
    "src/services/api/index.ts": 1,
  },
  "runtime-endpoint-read": {
    "src/services/api/index.ts": 1,
    "src/services/chat/v2Stream.ts": 1,
  },
  "non-runtime-endpoint-binding": {
    "src/components/chat/settings/metrics/ForwardEndpointsList.tsx": 1,
  },
  "runtime-composition-api": {
    "src/main.tsx": 4,
    "src/runtime/browserRuntime.ts": 7,
    "src/runtime/runtimeConfig.ts": 5,
  },
  "provider-endpoint-debt": {
    "src/components/chat/settings/providers/InstanceEditor.tsx": 1,
    "src/lib/providerPresets.ts": 4,
    "src/shared/i18n/index.ts": 1,
    "src/shared/i18n/resources/en-US.ts": 2,
    "src/shared/i18n/resources/zh-CN.ts": 2,
  },
};

const scriptKindFor = (file) => {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
};

const parseSource = (file, source) =>
  ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindFor(file));

const staticName = (node) => {
  if (!node) return null;
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return staticName(node.expression);
  }
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  if (ts.isComputedPropertyName(node)) return staticName(node.expression);
  return null;
};

const accessedPropertyName = (node) => {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) return staticName(node.argumentExpression);
  return null;
};

const isImportMeta = (node) =>
  ts.isMetaProperty(node) &&
  node.keywordToken === ts.SyntaxKind.ImportKeyword &&
  node.name.text === "meta";

const isImportMetaEnv = (node) =>
  (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
  accessedPropertyName(node) === "env" &&
  isImportMeta(node.expression);

const isImportMetaGlobCall = (node) =>
  ts.isCallExpression(node) &&
  (ts.isPropertyAccessExpression(node.expression) ||
    ts.isElementAccessExpression(node.expression)) &&
  ["glob", "globEager"].includes(accessedPropertyName(node.expression)) &&
  isImportMeta(node.expression.expression);

const moduleNameFromCall = (node) => {
  if (!ts.isCallExpression(node) || node.arguments.length < 1) return null;
  const [argument] = node.arguments;
  if (!ts.isStringLiteralLike(argument)) return null;
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return argument.text;
  if (
    node.arguments.length === 1 &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "require"
  ) {
    return argument.text;
  }
  return null;
};

const isAlternateHttpModule = (moduleName) => {
  if (!moduleName) return false;
  const rootName = moduleName.startsWith("@")
    ? moduleName.split("/").slice(0, 2).join("/")
    : moduleName.split("/")[0];
  return alternateHttpPackages.has(rootName);
};

const isLocalModule = (moduleName) =>
  moduleName.startsWith(".") ||
  moduleName === "/src" ||
  moduleName.startsWith("/src/") ||
  localAliases.some((alias) => moduleName === alias || moduleName.startsWith(`${alias}/`));

const normalizedModuleName = (moduleName) => moduleName.split(/[?#]/, 1)[0];
const logicalModuleIdentity = (file) => {
  let identity = path.posix.normalize(file.replaceAll("\\", "/"));
  let previousIdentity;
  do {
    previousIdentity = identity;
    identity = identity
      .replace(/\.(?:[cm]?[jt]sx?)$/, "")
      .replace(/(?:\/index)+$/, "");
  } while (identity !== previousIdentity);
  return identity;
};
const localModulePath = (file, moduleName) => {
  const normalized = normalizedModuleName(moduleName);
  const aliases = [
    ["@/", "src/"],
    ["@app/", "src/app/"],
    ["@components/", "src/components/"],
    ["@hooks/", "src/hooks/"],
    ["@pages/", "src/pages/"],
    ["@services/", "src/services/"],
    ["@shared/", "src/shared/"],
  ];
  let resolved = normalized;
  if (normalized.startsWith(".")) {
    resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), normalized));
  } else {
    const alias = aliases.find(([prefix]) => normalized.startsWith(prefix));
    if (!alias) return null;
    resolved = `${alias[1]}${normalized.slice(alias[0].length)}`;
  }
  return logicalModuleIdentity(resolved);
};
const isCanonicalNotificationProtectedDependency = (moduleName, resolved) => {
  const canonicalSpecifier = notificationProtectedDependencySpecifiers.get(resolved);
  return canonicalSpecifier === undefined || moduleName === canonicalSpecifier;
};
const isAllowedNotificationChannelDependency = (file, moduleName) => {
  if (!isLocalModule(moduleName)) return file !== notificationChannelServiceOwner;
  const resolved = localModulePath(file, moduleName);
  if (!resolved) return false;
  if (!isCanonicalNotificationProtectedDependency(moduleName, resolved)) return false;
  if (file === notificationChannelServiceOwner) {
    return resolved === "src/services/api" || resolved === "src/lib/secrets";
  }
  if (file === notificationChannelPageOwner) {
    return (
      resolved.startsWith(notificationChannelComponentRoot) ||
      notificationChannelPageAllowedDependencies.has(resolved)
    );
  }
  return (
    resolved.startsWith(notificationChannelComponentRoot) ||
    notificationChannelComponentAllowedDependencies.has(resolved)
  );
};
const isAllowedNotificationPreferencesDependency = (file, moduleName) =>
  file !== notificationPreferencesServiceOwner ||
  (isLocalModule(moduleName) &&
    localModulePath(file, moduleName) === "src/services/api" &&
    isCanonicalNotificationProtectedDependency(moduleName, "src/services/api"));
const isExcludedTestModule = (moduleName) =>
  /(?:^|\/)(?:__tests__|test)(?:\/|$)|\.(?:test|spec)(?:\.[cm]?[jt]sx?)?$/.test(
    normalizedModuleName(moduleName),
  );
const resolvesOutsideSource = (file, moduleName) => {
  const normalized = normalizedModuleName(moduleName);
  if (!file.startsWith("src/") || !normalized.startsWith(".")) return false;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), normalized));
  return resolved !== "src" && !resolved.startsWith("src/");
};

const backendPathPattern = /^\/(?:api\/v1|v1|v2\/stream)(?:\/|$)/;
const legacyNativePathPattern = /^\/v1(?:\/|$)/;
const containsAsciiControlCharacter = (text) => {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

const backendTextKind = (text) => {
  const classifyPath = (pathname) => {
    if (/^\/api\/v1(?:\/|$)/.test(pathname)) return "canonical-native";
    if (legacyNativePathPattern.test(pathname)) return "legacy-native";
    if (/^\/v2\/stream(?:\/|$)/.test(pathname)) return "v2-stream";
    return null;
  };

  try {
    const parsed = new URL(text);
    if (["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
      return classifyPath(parsed.pathname);
    }
  } catch {
    // Relative and partially static expressions are classified as paths below.
  }
  return classifyPath(text);
};

const isBackendPathComposition = (node) => {
  let parent = node.parent;
  while (ts.isParenthesizedExpression(parent)) parent = parent.parent;
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return true;
  }
  return (
    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    parent.arguments?.includes(node) &&
    parent.arguments.length > 1
  );
};

const rawEndpointLiteral = (node) => {
  if (!ts.isStringLiteralLike(node) && !ts.isTemplateExpression(node)) return false;
  const text = ts.isStringLiteralLike(node)
    ? node.text
    : node.getText().replace(/^`|`$/g, "");
  try {
    const parsed = new URL(text);
    if (
      ["http:", "https:", "ws:", "wss:"].includes(parsed.protocol) &&
      backendPathPattern.test(parsed.pathname)
    ) {
      return true;
    }
  } catch {
    // Non-absolute literals are checked below only when they compose a URL.
  }
  if (ts.isTemplateExpression(node)) {
    return /\/(?:api\/v1|v1|v2\/stream)(?:\/|\b)/.test(text);
  }
  return backendPathPattern.test(text) && isBackendPathComposition(node);
};

const isFrozenProviderEndpoint = (file, node) =>
  ts.isStringLiteralLike(node) && providerEndpointDebt.get(file)?.has(node.text);

const legacyNativeTextKind = (text) => {
  try {
    const parsed = new URL(text);
    if (
      ["http:", "https:"].includes(parsed.protocol) &&
      legacyNativePathPattern.test(parsed.pathname)
    ) {
      return "absolute";
    }
  } catch {
    // Relative literals and interpolated templates are checked below.
  }
  return legacyNativePathPattern.test(text) ? "relative" : null;
};

const legacyNativeLiteralKind = (node) => {
  if (!ts.isStringLiteralLike(node) && !ts.isTemplateExpression(node)) return null;
  const text = ts.isStringLiteralLike(node)
    ? node.text
    : node.getText().replace(/^`|`$/g, "");
  if (ts.isTemplateExpression(node)) {
    // The slash in canonical `/api/v1` is preceded by `i`; require a real
    // segment boundary so canonical templates never masquerade as legacy
    // native routing. `${origin}/v1` still matches because `}` is a boundary.
    return /(?:^|[^A-Za-z0-9_])\/v1(?:\/|\b)/.test(text) ? "relative" : null;
  }
  return legacyNativeTextKind(text);
};

const positionLabel = (file, sourceFile, node) => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${file}:${line + 1}:${character + 1}`;
};

const addCount = (counts, category, file, amount = 1) => {
  const owners = counts[category] ?? (counts[category] = {});
  owners[file] = (owners[file] ?? 0) + amount;
};

const isEnvironmentFile = (file) => {
  const name = path.basename(file);
  return name === ".env" || name.startsWith(".env.");
};

const parseEnvironmentLiteral = (rawValue) => {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, "").trim();
};

const publicBackendInputError = (value) => {
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return "must be an absolute literal HTTP(S) URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "must use HTTP or HTTPS";
  }
  if (containsAsciiControlCharacter(value)) {
    return "must not contain control characters";
  }
  if (value.includes("\\")) return "path must be empty or /api/v1";
  if (value.includes("?") || value.includes("#")) {
    return "must not contain a query or fragment";
  }
  if (parsed.username || parsed.password) return "must not contain credentials";
  const rawEndpoint = /^(?:https?):\/\/([^/]+)(\/.*)?$/i.exec(value);
  if (!rawEndpoint) return "must be an absolute literal HTTP(S) URL";
  if (rawEndpoint[1].includes("@")) return "must not contain credentials";
  const rawPath = rawEndpoint[2] ?? "";
  if (/^\/v1\/*$/.test(rawPath)) {
    return "must use the backend origin or canonical /api/v1; legacy /v1 is not supported";
  }
  const isBareOrigin = rawPath === "" || rawPath === "/";
  const isCanonicalApi = /^\/api\/v1\/*$/.test(rawPath);
  if (!isBareOrigin && !isCanonicalApi) return "path must be empty or /api/v1";
  return null;
};

const analyzeNonCodeSource = (file, source) => {
  const inventory = {};
  const violations = [];

  if (isEnvironmentFile(file)) {
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      const name = match?.[1];
      if (!name || !/^VITE_/i.test(name)) continue;
      const canonicalName = name.toUpperCase();
      if (secretShapedViteName.test(name)) {
        violations.push(`${file}:${index + 1}:1: client-exposed secret-shaped variable ${name}`);
      }
      if (!allowedPublicViteNames.has(canonicalName)) {
        const reason = endpointViteName.test(name)
          ? `${name} creates a second public endpoint input; use VITE_BACKEND_BASE_URL`
          : `${name} is outside the exact public Vite variable allowlist`;
        violations.push(`${file}:${index + 1}:1: ${reason}`);
      }
      if (canonicalName === "VITE_BACKEND_BASE_URL") {
        const value = parseEnvironmentLiteral(line.slice(match[0].length));
        const error = publicBackendInputError(value);
        if (error) {
          violations.push(
            `${file}:${index + 1}:1: VITE_BACKEND_BASE_URL ${error}; credentials and tokens must never enter a public bundle`,
          );
        }
      }
    }
    return { inventory, violations };
  }

  if (file === "index.html") {
    const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let compositionEntrypoints = 0;
    for (const match of source.matchAll(scriptPattern)) {
      const attributes = match[1] ?? "";
      const body = match[2] ?? "";
      const sourceMatch = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))/i.exec(
        attributes,
      );
      const typeMatch = /\btype\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))/i.exec(
        attributes,
      );
      const scriptSource = sourceMatch?.[1] ?? sourceMatch?.[2] ?? sourceMatch?.[3] ?? null;
      const scriptType = (typeMatch?.[1] ?? typeMatch?.[2] ?? typeMatch?.[3] ?? "").toLowerCase();
      if (scriptSource === "/src/main.tsx" && scriptType === "module") {
        compositionEntrypoints += 1;
      } else if (scriptSource === "/src/main.tsx") {
        violations.push(
          `${file}: /src/main.tsx must be loaded by an executable type="module" script`,
        );
      } else if (scriptSource) {
        violations.push(
          `${file}: script source ${scriptSource} bypasses the canonical /src/main.tsx composition root`,
        );
      } else if (body.trim()) {
        violations.push(
          `${file}: inline application scripts bypass the post-install module boundary`,
        );
      }
    }
    if (compositionEntrypoints !== 1) {
      violations.push(
        `${file}: exactly one /src/main.tsx module script must own application bootstrap`,
      );
    }
  }

  return { inventory, violations };
};

const analyzeSource = (file, source) => {
  if (!codeExtensions.has(path.extname(file))) return analyzeNonCodeSource(file, source);
  const virtualRoot = path.resolve(file.replaceAll("\\", path.sep));
  const sourceFile = parseSource(virtualRoot, source);
  const inventory = {};
  const violations = [];

  const report = (node, message) => {
    violations.push(`${positionLabel(file, sourceFile, node)}: ${message}`);
  };

  const logicalIdentity = logicalModuleIdentity(file);
  const expectedPhysicalDependency = notificationProtectedPhysicalDependencies.get(logicalIdentity);
  if (expectedPhysicalDependency && file !== expectedPhysicalDependency) {
    report(
      sourceFile,
      `Notification authority dependency ${logicalIdentity} must resolve only to ${expectedPhysicalDependency}; alternate physical module ${file} is forbidden`,
    );
  }

  if (file === runtimeContract) {
    const endpointInterfaces = sourceFile.statements.filter(
      (statement) =>
        ts.isInterfaceDeclaration(statement) && statement.name.text === runtimeEndpointInterface,
    );
    const endpoint = endpointInterfaces[0];
    const endpointFields = endpoint?.members.map((member) => staticName(member.name)) ?? [];
    const hasExactEndpointSchema =
      endpointInterfaces.length === 1 &&
      endpointFields.length === canonicalRuntimeEndpointFields.size &&
      new Set(endpointFields).size === canonicalRuntimeEndpointFields.size &&
      endpoint.members.every(
        (member) =>
          canonicalRuntimeEndpointFields.has(staticName(member.name)) &&
          ts.isPropertySignature(member) &&
          ts.isIdentifier(member.name) &&
          !member.questionToken &&
          member.type?.kind === ts.SyntaxKind.StringKeyword &&
          member.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ReadonlyKeyword),
      );
    if (!hasExactEndpointSchema) {
      report(
        endpoint ?? sourceFile,
        `${runtimeEndpointInterface} must expose exactly origin, nativeApi, and v2Stream`,
      );
    }
    const inherited = endpointInterfaces.find(({ heritageClauses }) => heritageClauses?.length);
    if (inherited) report(inherited, `${runtimeEndpointInterface} must not extend another type`);
  }

  const unwrapStaticExpression = (node) => {
    let current = node;
    while (
      current &&
      (ts.isParenthesizedExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isTypeAssertionExpression(current) ||
        ts.isNonNullExpression(current) ||
        ts.isSatisfiesExpression(current))
    ) {
      current = current.expression;
    }
    return current;
  };

  const canonicalFileName = (requestedFile) => {
    const normalized = path.normalize(path.resolve(requestedFile.replaceAll("\\", path.sep)));
    return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
  };
  const canonicalVirtualRoot = canonicalFileName(virtualRoot);
  const isVirtualRoot = (requestedFile) =>
    canonicalFileName(requestedFile) === canonicalVirtualRoot;
  const compilerHost = {
    fileExists: isVirtualRoot,
    getCanonicalFileName: canonicalFileName,
    getCurrentDirectory: () => process.cwd(),
    getDefaultLibFileName: () => "",
    getDirectories: () => [],
    getNewLine: () => "\n",
    getSourceFile: (requestedFile) => (isVirtualRoot(requestedFile) ? sourceFile : undefined),
    readFile: (requestedFile) => (isVirtualRoot(requestedFile) ? source : undefined),
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    writeFile: () => {},
  };
  const program = ts.createProgram({
    rootNames: [virtualRoot],
    options: {
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
      noLib: true,
      noResolve: true,
      target: ts.ScriptTarget.Latest,
    },
    host: compilerHost,
  });
  const typeChecker = program.getTypeChecker();

  const constInitializerFor = (identifier) => {
    const symbol = typeChecker.getSymbolAtLocation(identifier);
    const declaration = symbol?.valueDeclaration;
    if (
      !declaration ||
      !ts.isVariableDeclaration(declaration) ||
      !declaration.initializer ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      !(declaration.parent.flags & ts.NodeFlags.Const)
    ) {
      return null;
    }
    return { initializer: declaration.initializer, symbol };
  };

  const staticCompositionCall = (node) => {
    if (!ts.isCallExpression(node) || node.questionDotToken) return null;
    const callee = unwrapStaticExpression(node.expression);
    if (!callee || (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee))) {
      return null;
    }
    const name = ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : ts.isStringLiteralLike(callee.argumentExpression)
        ? callee.argumentExpression.text
        : null;
    return name ? { callee, name } : null;
  };

  const joinedStaticParts = (parts) =>
    parts.every((part) => part !== null) ? parts.join("") : null;

  const staticStringParts = (node, resolvingSymbols = new Set()) => {
    const expression = unwrapStaticExpression(node);
    if (!expression) return [null];
    if (ts.isStringLiteralLike(expression)) return [expression.text];
    if (ts.isComputedPropertyName(expression)) {
      return staticStringParts(expression.expression, resolvingSymbols);
    }
    if (ts.isIdentifier(expression)) {
      const binding = constInitializerFor(expression);
      if (!binding || resolvingSymbols.has(binding.symbol)) return [null];
      const next = new Set(resolvingSymbols).add(binding.symbol);
      return staticStringParts(binding.initializer, next);
    }
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      return [
        ...staticStringParts(expression.left, resolvingSymbols),
        ...staticStringParts(expression.right, resolvingSymbols),
      ];
    }
    if (ts.isConditionalExpression(expression)) {
      const left = joinedStaticParts(staticStringParts(expression.whenTrue, resolvingSymbols));
      const right = joinedStaticParts(staticStringParts(expression.whenFalse, resolvingSymbols));
      return left !== null && left === right ? [left] : [null];
    }
    if (ts.isTemplateExpression(expression)) {
      return [
        expression.head.text,
        ...expression.templateSpans.flatMap((span) => [
          ...staticStringParts(span.expression, resolvingSymbols),
          span.literal.text,
        ]),
      ];
    }
    const call = staticCompositionCall(expression);
    if (call?.name === "concat") {
      return [call.callee.expression, ...expression.arguments].flatMap((part) =>
        staticStringParts(part, resolvingSymbols),
      );
    }
    if (call?.name === "join" && expression.arguments.length <= 1) {
      const receiver = unwrapStaticExpression(call.callee.expression);
      const separator = expression.arguments.length
        ? joinedStaticParts(staticStringParts(expression.arguments[0], resolvingSymbols))
        : ",";
      if (!receiver || !ts.isArrayLiteralExpression(receiver) || separator === null) return [null];
      return receiver.elements.flatMap((element, index) => [
        ...(index ? [separator] : []),
        ...(ts.isOmittedExpression(element)
          ? [""]
          : ts.isSpreadElement(element)
            ? [null]
            : staticStringParts(element, resolvingSymbols)),
      ]);
    }
    return [null];
  };

  const resolveStaticString = (node) => joinedStaticParts(staticStringParts(node));
  const isNotificationChannelConfigOwner =
    file === notificationChannelPageOwner ||
    file === notificationChannelServiceOwner ||
    file.startsWith(notificationChannelComponentRoot);
  const isNotificationAuthorityService = notificationAuthorityServiceApiBindings.has(file);
  const notificationChannelTrustedLeafDependencies =
    notificationChannelTrustedLeafAllowedDependencies.get(file);
  const isAllowedNotificationTrustedLeafDependency = (moduleName) => {
    if (!notificationChannelTrustedLeafDependencies || !isLocalModule(moduleName)) return true;
    const resolved = localModulePath(file, moduleName);
    return (
      resolved !== null &&
      notificationChannelTrustedLeafDependencies.has(resolved) &&
      isCanonicalNotificationProtectedDependency(moduleName, resolved)
    );
  };
  const isNotificationWholeConfigCall = (node) => {
    if (
      (!isNotificationChannelConfigOwner &&
        file !== notificationPreferencesServiceOwner &&
        !notificationChannelTrustedLeafDependencies) ||
      !ts.isCallExpression(node)
    ) {
      return false;
    }
    const callee = unwrapStaticExpression(node.expression);
    const callName = ts.isIdentifier(callee) ? callee.text : resolvedPropertyName(callee);
    if (notificationWholeConfigFacadeCallNames.has(callName)) return true;
    const routeArgument =
      callName === "request"
        ? node.arguments[1]
        : notificationWholeConfigCallNames.has(callName)
          ? node.arguments[0]
          : null;
    if (!routeArgument) return false;
    const route = resolveStaticString(routeArgument);
    if (route === null) return false;
    const normalized = route
      .trim()
      .replace(/[?#].*$/, "")
      .replace(/^\/+|\/+$/g, "");
    return ["bamboo/config", "api/v1/bamboo/config", "v1/bamboo/config"].includes(normalized);
  };
  const isNotificationTrustedLeafRuntimeCall = (node) => {
    if (!notificationChannelTrustedLeafDependencies || !ts.isCallExpression(node)) return false;
    const callee = unwrapStaticExpression(node.expression);
    return (
      callee &&
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "apiClient"
    );
  };
  const isUnverifiableNotificationServiceRoute = (node) => {
    if (file !== notificationChannelServiceOwner || !ts.isCallExpression(node)) return false;
    const callee = unwrapStaticExpression(node.expression);
    if (
      !callee ||
      !ts.isPropertyAccessExpression(callee) ||
      !ts.isIdentifier(callee.expression) ||
      callee.expression.text !== "apiClient"
    ) {
      return false;
    }
    const callName = callee.name.text;
    const routeArgument = node.arguments[0];
    if (!routeArgument) return true;
    const route = resolveStaticString(routeArgument);
    if (route === null) return true;
    const normalized = route.trim().replace(/^\/+|\/+$/g, "");
    return !notificationChannelAllowedRequests.has(`${callName}:${normalized}`);
  };
  const isUnverifiableNotificationPreferencesRoute = (node) => {
    if (file !== notificationPreferencesServiceOwner || !ts.isCallExpression(node)) return false;
    const callee = unwrapStaticExpression(node.expression);
    if (
      !callee ||
      !ts.isPropertyAccessExpression(callee) ||
      !ts.isIdentifier(callee.expression) ||
      callee.expression.text !== "apiClient"
    ) {
      return false;
    }
    const callName = callee.name.text;
    const routeArgument = node.arguments[0];
    if (!routeArgument) return true;
    const route = resolveStaticString(routeArgument);
    if (route === null) return true;
    const normalized = route.trim().replace(/^\/+|\/+$/g, "");
    return !notificationPreferencesAllowedRequests.has(`${callName}:${normalized}`);
  };
  const isApiClientImportBinding = (node) =>
    ts.isIdentifier(node) &&
    ts.isImportSpecifier(node.parent) &&
    node.parent.name === node &&
    (node.parent.propertyName?.text ?? node.parent.name.text) === "apiClient";
  const isDirectNotificationApiClientReceiver = (node) =>
    ts.isIdentifier(node) &&
    node.text === "apiClient" &&
    ts.isPropertyAccessExpression(node.parent) &&
    node.parent.expression === node &&
    ts.isCallExpression(node.parent.parent) &&
    node.parent.parent.expression === node.parent;
  const staticStringFragments = (node) => {
    const fragments = [];
    let current = "";
    for (const part of staticStringParts(node)) {
      if (part === null) {
        if (current) fragments.push(current);
        current = "";
      } else {
        current += part;
      }
    }
    if (current) fragments.push(current);
    return fragments;
  };

  const isStaticStringComposition = (node) =>
    (ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken) ||
    ts.isTemplateExpression(node) ||
    ["concat", "join"].includes(staticCompositionCall(node)?.name);

  const enclosingStaticStringComposition = (node) => {
    let current = node.parent;
    let aggregate = null;
    while (current && !ts.isStatement(current)) {
      if (isStaticStringComposition(current)) aggregate = current;
      current = current.parent;
    }
    return aggregate;
  };

  const foldedBackendKinds = (node) => {
    const expression = unwrapStaticExpression(node);
    if (!expression) return new Set();
    const enclosingAggregate = enclosingStaticStringComposition(expression);
    if (enclosingAggregate && enclosingAggregate !== expression) return new Set();
    if (!isStaticStringComposition(expression)) return new Set();
    return new Set(staticStringFragments(expression).map(backendTextKind).filter(Boolean));
  };

  const hasCompleteLegacyDescendant = (node) => {
    const expression = unwrapStaticExpression(node);
    if (!expression) return false;
    let containsCompleteLegacyLiteral = false;
    const findCompleteLiteral = (descendant) => {
      if (descendant !== expression && legacyNativeLiteralKind(descendant)) {
        containsCompleteLegacyLiteral = true;
        return;
      }
      ts.forEachChild(descendant, findCompleteLiteral);
    };
    findCompleteLiteral(expression);
    return containsCompleteLegacyLiteral;
  };

  const isLegacyFragmentOfCanonicalAggregate = (node) => {
    const aggregate = enclosingStaticStringComposition(node);
    if (!aggregate) return false;
    const kinds = foldedBackendKinds(aggregate);
    return (
      !kinds.has("legacy-native") &&
      (kinds.has("canonical-native") || kinds.has("v2-stream"))
    );
  };

  const resolveStaticKey = (node) => {
    const expression = unwrapStaticExpression(node);
    const resolved = resolveStaticString(expression);
    if (resolved !== null) return resolved;
    return ts.isIdentifier(expression) && expression.text === "fetch" ? "fetch" : null;
  };

  const resolvedPropertyName = (node) => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node)) {
      return resolveStaticKey(node.argumentExpression);
    }
    return null;
  };

  const resolvedDeclaredPropertyName = (node) =>
    ts.isComputedPropertyName(node) ? resolveStaticKey(node.expression) : staticName(node);

  const valueInitializers = new Map();
  const addValueInitializer = (identifier, initializer) => {
    const symbol = typeChecker.getSymbolAtLocation(identifier);
    if (!symbol) return;
    const initializers = valueInitializers.get(symbol) ?? [];
    initializers.push(initializer);
    valueInitializers.set(symbol, initializers);
  };
  const collectValueInitializers = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      addValueInitializer(node.name, node.initializer);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const left = unwrapStaticExpression(node.left);
      if (ts.isIdentifier(left)) addValueInitializer(left, node.right);
    }
    ts.forEachChild(node, collectValueInitializers);
  };
  collectValueInitializers(sourceFile);

  const projectionCandidates = new Map();
  const addProjectionCandidate = (identifier, sourceExpression, segments) => {
    const symbol = typeChecker.getSymbolAtLocation(identifier);
    if (!symbol || !sourceExpression || segments.some((segment) => segment.value === null)) return;
    const candidates = projectionCandidates.get(symbol) ?? [];
    candidates.push({ sourceExpression, segments });
    projectionCandidates.set(symbol, candidates);
  };
  const collectProjectedTargets = (targetNode, sourceExpression, segments = []) => {
    const target = unwrapStaticExpression(targetNode);
    if (!target || !sourceExpression) return;
    if (ts.isIdentifier(target)) {
      addProjectionCandidate(target, sourceExpression, segments);
      return;
    }
    if (
      ts.isBinaryExpression(target) &&
      target.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      collectProjectedTargets(target.left, sourceExpression, segments);
      collectProjectedTargets(target.left, target.right);
      return;
    }
    if (ts.isObjectBindingPattern(target)) {
      for (const element of target.elements) {
        if (element.dotDotDotToken) continue;
        const propertyName = resolvedDeclaredPropertyName(element.propertyName ?? element.name);
        collectProjectedTargets(element.name, sourceExpression, [
          ...segments,
          { kind: "property", value: propertyName },
        ]);
        if (element.initializer) collectProjectedTargets(element.name, element.initializer);
      }
      return;
    }
    if (ts.isArrayBindingPattern(target)) {
      for (const [index, element] of target.elements.entries()) {
        if (!ts.isBindingElement(element) || element.dotDotDotToken) continue;
        collectProjectedTargets(element.name, sourceExpression, [
          ...segments,
          { kind: "index", value: index },
        ]);
        if (element.initializer) collectProjectedTargets(element.name, element.initializer);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(target)) {
      for (const property of target.properties) {
        if (ts.isPropertyAssignment(property)) {
          collectProjectedTargets(property.initializer, sourceExpression, [
            ...segments,
            { kind: "property", value: resolvedDeclaredPropertyName(property.name) },
          ]);
        } else if (ts.isShorthandPropertyAssignment(property)) {
          const propertyName = resolvedDeclaredPropertyName(property.name);
          collectProjectedTargets(property.name, sourceExpression, [
            ...segments,
            { kind: "property", value: propertyName },
          ]);
          if (property.objectAssignmentInitializer) {
            collectProjectedTargets(property.name, property.objectAssignmentInitializer);
          }
        }
      }
      return;
    }
    if (ts.isArrayLiteralExpression(target)) {
      for (const [index, element] of target.elements.entries()) {
        if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) continue;
        collectProjectedTargets(element, sourceExpression, [
          ...segments,
          { kind: "index", value: index },
        ]);
      }
    }
  };
  const collectProjectionCandidates = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      collectProjectedTargets(node.name, node.initializer);
    }
    if (ts.isParameter(node) && node.initializer) {
      collectProjectedTargets(node.name, node.initializer);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      collectProjectedTargets(node.left, node.right);
    }
    if (ts.isForOfStatement(node) && ts.isArrayLiteralExpression(node.expression)) {
      const initializer = ts.isVariableDeclarationList(node.initializer)
        ? node.initializer.declarations[0]?.name
        : node.initializer;
      if (initializer) {
        for (const element of node.expression.elements) {
          if (!ts.isOmittedExpression(element) && !ts.isSpreadElement(element)) {
            collectProjectedTargets(initializer, element);
          }
        }
      }
    }
    ts.forEachChild(node, collectProjectionCandidates);
  };
  collectProjectionCandidates(sourceFile);

  const browserGlobalNames = new Set(["globalThis", "self", "window"]);
  const resolveProjectionKind = (candidate, resolvingSymbols) => {
    let sourceExpression = unwrapStaticExpression(candidate.sourceExpression);
    let kind = null;
    for (const segment of candidate.segments) {
      if (segment.kind === "index") {
        if (kind !== null || !ts.isArrayLiteralExpression(sourceExpression)) return null;
        sourceExpression = unwrapStaticExpression(sourceExpression.elements[segment.value]);
        if (!sourceExpression) return null;
      } else {
        if (kind === null) {
          if (!isBrowserGlobalExpression(sourceExpression, resolvingSymbols)) return null;
          kind = "browser-global";
        }
        if (kind !== "browser-global") return null;
        if (browserGlobalNames.has(segment.value)) continue;
        if (segment.value === "Reflect") {
          kind = "reflect";
        } else {
          return null;
        }
      }
    }
    if (kind === null) {
      if (isBrowserGlobalExpression(sourceExpression, resolvingSymbols)) {
        kind = "browser-global";
      } else if (isReflectNamespaceExpression(sourceExpression, resolvingSymbols)) {
        kind = "reflect";
      } else {
        return null;
      }
    }
    return kind;
  };
  const isBrowserGlobalExpression = (node, resolvingSymbols = new Set()) => {
    const expression = unwrapStaticExpression(node);
    if (!expression) return false;
    if (ts.isIdentifier(expression)) {
      const symbol = typeChecker.getSymbolAtLocation(expression);
      if (!symbol?.declarations?.length) return browserGlobalNames.has(expression.text);
      const initializers = valueInitializers.get(symbol);
      const projections = projectionCandidates.get(symbol);
      if (resolvingSymbols.has(symbol)) return false;
      const nextResolvingSymbols = new Set(resolvingSymbols);
      nextResolvingSymbols.add(symbol);
      return Boolean(
        initializers?.some((initializer) =>
          isBrowserGlobalExpression(initializer, nextResolvingSymbols),
        ) ||
          projections?.some(
            (candidate) =>
              resolveProjectionKind(candidate, nextResolvingSymbols) === "browser-global",
          ),
      );
    }
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      return (
        browserGlobalNames.has(resolvedPropertyName(expression)) &&
        isBrowserGlobalExpression(expression.expression, resolvingSymbols)
      );
    }
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      return isBrowserGlobalExpression(expression.right, resolvingSymbols);
    }
    if (ts.isConditionalExpression(expression)) {
      return (
        isBrowserGlobalExpression(expression.whenTrue, resolvingSymbols) ||
        isBrowserGlobalExpression(expression.whenFalse, resolvingSymbols)
      );
    }
    return false;
  };

  const isReflectNamespaceExpression = (node, resolvingSymbols = new Set()) => {
    const expression = unwrapStaticExpression(node);
    if (!expression) return false;
    if (ts.isIdentifier(expression)) {
      const symbol = typeChecker.getSymbolAtLocation(expression);
      if (!symbol?.declarations?.length) return expression.text === "Reflect";
      const initializers = valueInitializers.get(symbol);
      const projections = projectionCandidates.get(symbol);
      if (resolvingSymbols.has(symbol)) return false;
      const nextResolvingSymbols = new Set(resolvingSymbols);
      nextResolvingSymbols.add(symbol);
      return Boolean(
        initializers?.some((initializer) =>
          isReflectNamespaceExpression(initializer, nextResolvingSymbols),
        ) ||
          projections?.some(
            (candidate) => resolveProjectionKind(candidate, nextResolvingSymbols) === "reflect",
          ),
      );
    }
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      return (
        resolvedPropertyName(expression) === "Reflect" &&
        isBrowserGlobalExpression(expression.expression)
      );
    }
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      return isReflectNamespaceExpression(expression.right, resolvingSymbols);
    }
    if (ts.isConditionalExpression(expression)) {
      return (
        isReflectNamespaceExpression(expression.whenTrue, resolvingSymbols) ||
        isReflectNamespaceExpression(expression.whenFalse, resolvingSymbols)
      );
    }
    return false;
  };

  const reflectivePropertyRead = (node) => {
    if (!ts.isCallExpression(node) || node.arguments.length < 2) return null;
    const callee = unwrapStaticExpression(node.expression);
    if (
      !callee ||
      (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) ||
      resolvedPropertyName(callee) !== "get" ||
      !isReflectNamespaceExpression(callee.expression)
    ) {
      return null;
    }
    return { key: resolveStaticKey(node.arguments[1]) };
  };

  const isReflectivePropertyRead = (node, propertyName) => {
    const read = reflectivePropertyRead(node);
    return read?.key === propertyName;
  };

  const isUnprovenReflectivePropertyRead = (node) => {
    const read = reflectivePropertyRead(node);
    return read !== null && read.key === null;
  };

  const assignmentPatternSource = (node) => {
    let current = node;
    while (current.parent) {
      const parent = current.parent;
      if (
        ts.isObjectLiteralExpression(parent) ||
        ts.isArrayLiteralExpression(parent) ||
        ts.isPropertyAssignment(parent) ||
        ts.isSpreadAssignment(parent) ||
        ts.isSpreadElement(parent) ||
        ((ts.isParenthesizedExpression(parent) ||
          ts.isAsExpression(parent) ||
          ts.isTypeAssertionExpression(parent) ||
          ts.isNonNullExpression(parent) ||
          ts.isSatisfiesExpression(parent)) &&
          parent.expression === current)
      ) {
        current = parent;
        continue;
      }
      if (
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        parent.left === current
      ) {
        return parent.right;
      }
      if (
        (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) &&
        parent.initializer === current
      ) {
        return parent.expression;
      }
      return null;
    }
    return null;
  };
  const isAssignmentPatternProperty = (node) => assignmentPatternSource(node) !== null;

  const bindingPatternSource = (node) => {
    let current = node.parent;
    while (current && !ts.isStatement(current)) {
      if (ts.isVariableDeclaration(current)) return current.initializer ?? null;
      current = current.parent;
    }
    return null;
  };

  const isDescendantOf = (node, ancestor) => {
    let current = node;
    while (current && current !== ancestor) current = current.parent;
    return current === ancestor;
  };

  const isInsideAssignmentTarget = (node, target) => {
    let current = node;
    while (current && current !== target) {
      const parent = current.parent;
      if (!parent) return false;
      const followsTargetPath =
        ((ts.isParenthesizedExpression(parent) ||
          ts.isAsExpression(parent) ||
          ts.isTypeAssertionExpression(parent) ||
          ts.isNonNullExpression(parent) ||
          ts.isSatisfiesExpression(parent)) &&
          parent.expression === current) ||
        (ts.isBinaryExpression(parent) &&
          parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          parent.left === current) ||
        (ts.isObjectLiteralExpression(parent) && parent.properties.includes(current)) ||
        (ts.isArrayLiteralExpression(parent) && parent.elements.includes(current)) ||
        (ts.isPropertyAssignment(parent) && parent.initializer === current) ||
        (ts.isShorthandPropertyAssignment(parent) && parent.name === current) ||
        ((ts.isSpreadAssignment(parent) || ts.isSpreadElement(parent)) &&
          parent.expression === current);
      if (!followsTargetPath) return false;
      current = parent;
    }
    return current === target;
  };

  const isFetchAssignmentSite = (node) =>
    (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
    isAssignmentPatternProperty(node) &&
    (resolvedDeclaredPropertyName(node.name) === "fetch" ||
      (ts.isComputedPropertyName(node.name) &&
        resolvedDeclaredPropertyName(node.name) === null &&
        isBrowserGlobalExpression(assignmentPatternSource(node))));

  const assignmentFetchSiteForDescendant = (node) => {
    if (isFetchAssignmentSite(node)) return node;
    let current = node;
    while (current.parent && !ts.isStatement(current.parent)) {
      const parent = current.parent;
      if (isFetchAssignmentSite(parent)) {
        const target = ts.isPropertyAssignment(parent) ? parent.initializer : parent.name;
        if (
          (isDescendantOf(node, parent.name) || isInsideAssignmentTarget(node, target))
        ) {
          return parent;
        }
      }
      current = parent;
    }
    return null;
  };

  const structuralFetchSiteForDescendant = (node) => {
    const assignmentSite = assignmentFetchSiteForDescendant(node);
    if (assignmentSite) return assignmentSite;
    let current = node;
    while (current.parent && !ts.isStatement(current.parent)) {
      const parent = current.parent;
      if (
        ts.isElementAccessExpression(parent) &&
        parent.argumentExpression === current &&
        (resolvedPropertyName(parent) === "fetch" ||
          (resolvedPropertyName(parent) === null &&
            isBrowserGlobalExpression(parent.expression)))
      ) {
        return parent;
      }
      if (
        ts.isCallExpression(parent) &&
        parent.arguments[1] === current &&
        (isReflectivePropertyRead(parent, "fetch") ||
          isUnprovenReflectivePropertyRead(parent))
      ) {
        return parent;
      }
      if (ts.isComputedPropertyName(parent) && parent.expression === current) {
        const owner = parent.parent;
        if (
          ts.isBindingElement(owner) &&
          (resolvedDeclaredPropertyName(parent) === "fetch" ||
            (resolvedDeclaredPropertyName(parent) === null &&
              isBrowserGlobalExpression(bindingPatternSource(owner))))
        ) {
          return owner;
        }
      }
      current = parent;
    }
    return null;
  };

  const isInsideProvenNonFetchKey = (node) => {
    let current = node;
    while (current.parent && !ts.isStatement(current.parent)) {
      const parent = current.parent;
      if (
        ts.isElementAccessExpression(parent) &&
        parent.argumentExpression === current
      ) {
        const name = resolvedPropertyName(parent);
        return name !== null && name !== "fetch";
      }
      if (ts.isCallExpression(parent) && parent.arguments[1] === current) {
        const read = reflectivePropertyRead(parent);
        if (read) return read.key !== null && read.key !== "fetch";
      }
      if (ts.isComputedPropertyName(parent) && parent.expression === current) {
        const name = resolvedDeclaredPropertyName(parent);
        return name !== null && name !== "fetch";
      }
      current = parent;
    }
    return false;
  };

  const recordedFetchSites = new Set();
  const recordFetchSite = (node) => {
    if (recordedFetchSites.has(node)) return;
    recordedFetchSites.add(node);
    addCount(inventory, "fetch-reference", file);
    if (file !== httpOwner) {
      report(node, "direct or aliased fetch access creates a second HTTP transport owner");
    }
  };

  const canonicalTransportModules = new Set(["./transport", "./transport.ts"]);
  const canonicalClientModules = new Set(["./client", "./client.ts"]);
  const canonicalNamedImport = (identifier, importedName, moduleNames) => {
    if (!ts.isIdentifier(identifier) || !ts.isImportSpecifier(identifier.parent)) return false;
    const specifier = identifier.parent;
    const importClause = specifier.parent.parent;
    const declaration = importClause.parent;
    return (
      specifier.name === identifier &&
      !specifier.propertyName &&
      identifier.text === importedName &&
      ts.isImportDeclaration(declaration) &&
      ts.isStringLiteralLike(declaration.moduleSpecifier) &&
      moduleNames.has(declaration.moduleSpecifier.text)
    );
  };
  const canonicalBrowserTransportImports = [];
  const canonicalApiClientImports = [];
  if (file === apiCompositionOwner) {
    const collectCanonicalImports = (node) => {
      if (canonicalNamedImport(node, browserHttpTransportFactory, canonicalTransportModules)) {
        canonicalBrowserTransportImports.push(node);
      }
      if (canonicalNamedImport(node, "ApiClient", canonicalClientModules)) {
        canonicalApiClientImports.push(node);
      }
      ts.forEachChild(node, collectCanonicalImports);
    };
    collectCanonicalImports(sourceFile);
    if (canonicalBrowserTransportImports.length !== 1) {
      report(
        sourceFile,
        `${apiCompositionOwner} must import exactly one ${browserHttpTransportFactory} binding directly from ./transport`,
      );
    }
    if (canonicalApiClientImports.length !== 1) {
      report(
        sourceFile,
        `${apiCompositionOwner} must import exactly one ApiClient binding directly from ./client`,
      );
    }
  }

  const isTopLevelConstInitializer = (expression) => {
    const declaration = expression.parent;
    if (
      !ts.isVariableDeclaration(declaration) ||
      declaration.initializer !== expression ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      !(declaration.parent.flags & ts.NodeFlags.Const) ||
      !ts.isVariableStatement(declaration.parent.parent)
    ) {
      return false;
    }
    return declaration.parent.parent.parent === sourceFile;
  };

  const sharedBrowserTransportBindings = new Set();
  if (file === apiCompositionOwner) {
    for (const statement of sourceFile.statements) {
      if (
        !ts.isVariableStatement(statement) ||
        !(statement.declarationList.flags & ts.NodeFlags.Const)
      ) {
        continue;
      }
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          ts.isCallExpression(declaration.initializer) &&
          ts.isIdentifier(declaration.initializer.expression) &&
          declaration.initializer.expression.text === browserHttpTransportFactory &&
          canonicalBrowserTransportImports.length === 1
        ) {
          sharedBrowserTransportBindings.add(declaration.name.text);
        }
      }
    }
  }

  const usesSharedBrowserTransport = (construction) => {
    if (!isTopLevelConstInitializer(construction)) return false;
    const config = construction.arguments?.[0];
    if (!config || !ts.isObjectLiteralExpression(config)) return false;
    const transportProperty = config.properties.find(
      (property) => property.name && staticName(property.name) === "transport",
    );
    if (!transportProperty) return false;
    if (ts.isShorthandPropertyAssignment(transportProperty)) {
      return sharedBrowserTransportBindings.has(transportProperty.name.text);
    }
    return (
      ts.isPropertyAssignment(transportProperty) &&
      ts.isIdentifier(transportProperty.initializer) &&
      sharedBrowserTransportBindings.has(transportProperty.initializer.text)
    );
  };

  const usesCanonicalNativeEndpoint = (construction) => {
    const config = construction.arguments?.[0];
    if (!config || !ts.isObjectLiteralExpression(config)) return false;
    const baseUrlProperty = config.properties.find(
      (property) => property.name && staticName(property.name) === "baseUrl",
    );
    if (!baseUrlProperty || !ts.isPropertyAssignment(baseUrlProperty)) return false;
    const names = [];
    let expression = unwrapStaticExpression(baseUrlProperty.initializer);
    while (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      names.unshift(resolvedPropertyName(expression));
      expression = unwrapStaticExpression(expression.expression);
    }
    return ts.isIdentifier(expression) && [expression.text, ...names].join(".") === "runtime.endpoints.nativeApi";
  };

  const containsPropertyRead = (node, name) => {
    let found = false;
    const find = (descendant) => {
      found ||=
        (ts.isPropertyAccessExpression(descendant) || ts.isElementAccessExpression(descendant)) &&
        resolvedPropertyName(descendant) === name;
      if (!found) ts.forEachChild(descendant, find);
    };
    find(node);
    return found;
  };

  const isLegacyInputValidationLiteral = (node) => {
    if (
      ![runtimeResolver, viteConfiguration].includes(file) ||
      !ts.isStringLiteralLike(node) ||
      node.text !== "/v1"
    ) {
      return false;
    }
    let expression = node;
    while (expression.parent && ts.isParenthesizedExpression(expression.parent)) {
      expression = expression.parent;
    }
    const comparison = expression.parent;
    if (
      !ts.isBinaryExpression(comparison) ||
      ![
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ].includes(comparison.operatorToken.kind)
    ) {
      return false;
    }
    const other = comparison.left === expression ? comparison.right : comparison.left;
    return (
      containsPropertyRead(other, "pathname") ||
      (file === viteConfiguration && ts.isIdentifier(other) && other.text === "pathname")
    );
  };

  const executableLegacyCallNames = new Set([
    "ApiClient", "URL", "delete", "fetch", "fetchRaw", "get", "patch", "post", "put",
    "request", "requestOnce", "resolveUrl", "send",
  ]);
  const isExecutableLegacyNativeLiteral = (node) => {
    if (ts.isTemplateExpression(node)) return true;
    let current = node;
    while (current.parent && !ts.isStatement(current.parent)) {
      const parent = current.parent;
      if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken) return true;
      if (
        ts.isPropertyAssignment(parent) &&
        parent.initializer === current &&
        ["baseUrl", "nativeApi"].includes(staticName(parent.name))
      ) {
        return true;
      }
      if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
        const bindingName = staticName(parent.name);
        if (["baseUrl", "endpoint", "nativeApi"].includes(bindingName)) return true;
      }
      if (
        (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
        parent.arguments?.includes(current)
      ) {
        const callName = ts.isIdentifier(parent.expression)
          ? parent.expression.text
          : resolvedPropertyName(parent.expression);
        if (executableLegacyCallNames.has(callName)) return true;
      }
      current = parent;
    }
    return false;
  };

  const isNamedDeclaration = (identifier) => {
    const parent = identifier.parent;
    return (
      ((ts.isMethodDeclaration(parent) ||
        ts.isMethodSignature(parent) ||
        ts.isPropertyDeclaration(parent) ||
        ts.isPropertySignature(parent) ||
        ts.isPropertyAssignment(parent) ||
        ts.isBindingElement(parent) ||
        ts.isParameter(parent) ||
        ts.isVariableDeclaration(parent) ||
        ts.isFunctionDeclaration(parent) ||
        ts.isClassDeclaration(parent)) &&
        (parent.name === identifier || parent.propertyName === identifier)) ||
      (ts.isImportSpecifier(parent) && parent.name === identifier)
    );
  };
  const isClassDeclarationName = (node, name) =>
    ts.isIdentifier(node) &&
    node.text === name &&
    ts.isClassDeclaration(node.parent) &&
    node.parent.name === node;
  const isDirectNamedConstructionReference = (node, name) =>
    ts.isIdentifier(node) &&
    node.text === name &&
    ts.isNewExpression(node.parent) &&
    node.parent.expression === node;
  const isTypeOnlyReference = (node) => {
    if (ts.isIdentifier(node) && ts.isImportSpecifier(node.parent)) {
      const importSpecifier = node.parent;
      const importClause = importSpecifier.parent.parent;
      return (
        importSpecifier.isTypeOnly ||
        (ts.isImportClause(importClause) && importClause.isTypeOnly)
      );
    }

    let current = node.parent;
    while (current && !ts.isStatement(current)) {
      if (
        (ts.isHeritageClause(current) &&
          current.token === ts.SyntaxKind.ExtendsKeyword) ||
        (ts.isExpressionWithTypeArguments(current) &&
          ts.isHeritageClause(current.parent) &&
          current.parent.token === ts.SyntaxKind.ExtendsKeyword)
      ) {
        return false;
      }
      if (ts.isTypeNode(current)) return true;
      current = current.parent;
    }
    return false;
  };
  const isInsideNamedClass = (node, name) => {
    let current = node.parent;
    while (current) {
      if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
        return current.name?.text === name;
      }
      current = current.parent;
    }
    return false;
  };
  const reflectiveConstructionTarget = (node) => {
    if (!ts.isCallExpression(node) || node.arguments.length === 0) return null;
    const callee = unwrapStaticExpression(node.expression);
    if (
      !callee ||
      (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) ||
      resolvedPropertyName(callee) !== "construct" ||
      !isReflectNamespaceExpression(callee.expression)
    ) {
      return null;
    }
    return node.arguments[0];
  };
  const isDirectBrowserTransportFactoryUse = (node) => {
    if (file === httpOwner) return true;
    if (file !== apiCompositionOwner) return false;

    if (canonicalNamedImport(node, browserHttpTransportFactory, canonicalTransportModules)) {
      return true;
    }
    return (
      canonicalBrowserTransportImports.length === 1 &&
      ts.isIdentifier(node) &&
      ts.isCallExpression(node.parent) &&
      node.parent.expression === node &&
      isTopLevelConstInitializer(node.parent)
    );
  };
  const isDirectCanonicalApiClientUse = (node) => {
    if (file === apiClientOwner) return true;
    if (file !== apiCompositionOwner) return false;
    if (canonicalNamedImport(node, "ApiClient", canonicalClientModules)) return true;
    return (
      canonicalApiClientImports.length === 1 &&
      ts.isIdentifier(node) &&
      ts.isNewExpression(node.parent) &&
      node.parent.expression === node &&
      isTopLevelConstInitializer(node.parent)
    );
  };
  const checkRuntimeLocalDependency = (node, moduleName) => {
    const allowed = runtimeLocalImportAllowlist.get(file);
    if (allowed && isLocalModule(moduleName) && !allowed.has(moduleName)) {
      report(
        node,
        `${file} is a pre-install runtime module and cannot depend on application module ${moduleName}`,
      );
    }
  };
  const checkExcludedTestDependency = (node, moduleName) => {
    if (file.startsWith("src/") && isLocalModule(moduleName) && isExcludedTestModule(moduleName)) {
      report(node, "production code cannot import a verifier-excluded test module");
    }
  };
  const checkSourceDependencyBoundary = (node, moduleName) => {
    if (resolvesOutsideSource(file, moduleName)) {
      report(node, "production source cannot import an unverified module outside src/");
    }
  };

  const visit = (node) => {
    if (isNotificationWholeConfigCall(node)) {
      report(
        node,
        "Notification Channels must use the dedicated bamboo/config/notifications section contract, never the whole-config endpoint",
      );
    }
    if (isNotificationTrustedLeafRuntimeCall(node)) {
      report(node, "Notification Channels dependency closure must not use runtime authority");
    }
    if (isUnverifiableNotificationServiceRoute(node)) {
      report(
        node,
        "Notification Channels service routes must resolve statically to an approved dedicated endpoint",
      );
    }
    if (isUnverifiableNotificationPreferencesRoute(node)) {
      report(
        node,
        "Notification preferences service routes must resolve statically to its approved dedicated endpoint",
      );
    }
    if (
      (file === notificationChannelServiceOwner || file === notificationPreferencesServiceOwner) &&
      ts.isIdentifier(node) &&
      node.text === "apiClient" &&
      !isApiClientImportBinding(node) &&
      !isDirectNotificationApiClientReceiver(node)
    ) {
      report(
        node,
        "Notification authority services may use apiClient only through direct approved calls",
      );
    }
    if (
      file !== runtimeContract &&
      ts.isInterfaceDeclaration(node) &&
      node.name.text === runtimeEndpointInterface
    ) {
      report(
        node,
        `${runtimeEndpointInterface} may be declared only by ${runtimeContract}; module augmentation and shadow schemas are forbidden`,
      );
    }
    if (
      file.startsWith("src/") &&
      ts.isStringLiteralLike(node) &&
      isLocalModule(node.text) &&
      isExcludedTestModule(node.text) &&
      !(
        (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) &&
        node.parent.moduleSpecifier === node
      )
    ) {
      report(node, "production code cannot reference a verifier-excluded test module");
    }
    const deprecatedNativeApiName =
      ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) &&
        deprecatedNativeApiNames.has(node.text) &&
        node.text) ||
      null;
    if (deprecatedNativeApiName) {
      report(
        node,
        `deprecated native REST name ${deprecatedNativeApiName} reintroduces the dual-client boundary; use apiClient and runtime.endpoints.nativeApi`,
      );
    }
    if (
      file.startsWith("src/") &&
      ts.isStringLiteralLike(node) &&
      retiredProviderPaths.has(node.text)
    ) {
      report(
        node,
        `retired provider endpoint ${node.text} must not re-enter Lotus Next; use the canonical provider-instances or provider-catalog contract`,
      );
    }
    const runtimeApiName =
      (ts.isIdentifier(node) && runtimeCompositionApiOwners.has(node.text) && node.text) ||
      (ts.isElementAccessExpression(node) &&
      runtimeCompositionApiOwners.has(resolveStaticKey(node.argumentExpression))
        ? resolveStaticKey(node.argumentExpression)
        : null);
    if (runtimeApiName) {
      addCount(inventory, "runtime-composition-api", file);
      if (!runtimeCompositionApiOwners.get(runtimeApiName).has(file)) {
        report(
          node,
          `${runtimeApiName} is a concrete runtime composition API outside its frozen owner`,
        );
      }
    }

    if (
      isImportMetaGlobCall(node) &&
      (file === compositionRoot || runtimeLocalImportAllowlist.has(file))
    ) {
      report(node, "eager or deferred import.meta.glob bypasses the pre-install dependency boundary");
    }
    if (isImportMetaGlobCall(node) && isNotificationChannelConfigOwner) {
      report(node, "import.meta.glob bypasses the Notification Channels authority boundary");
    }
    if (isImportMetaGlobCall(node) && notificationChannelTrustedLeafDependencies) {
      report(node, "import.meta.glob bypasses the Notification Channels dependency closure");
    }
    if (isImportMetaGlobCall(node) && file === notificationPreferencesServiceOwner) {
      report(node, "import.meta.glob bypasses the Notification preferences authority boundary");
    }

    if (isFrozenProviderEndpoint(file, node)) {
      addCount(inventory, "provider-endpoint-debt", file);
    } else {
      const legacyNativeKind = legacyNativeLiteralKind(node);
      if (
        legacyNativeKind &&
        !isLegacyInputValidationLiteral(node) &&
        !isLegacyFragmentOfCanonicalAggregate(node) &&
        (legacyNativeKind === "relative" || isExecutableLegacyNativeLiteral(node))
      ) {
        report(
          node,
          "Lotus native /v1 routing is legacy-only; executable paths must use the canonical /api/v1 client",
        );
      }
      const foldedKinds = foldedBackendKinds(node);
      if (
        foldedKinds.has("legacy-native") &&
        !legacyNativeKind &&
        !hasCompleteLegacyDescendant(node)
      ) {
        report(
          node,
          "Lotus native /v1 routing is legacy-only; statically composed paths must use the canonical /api/v1 client",
        );
      }
      const isRawEndpoint = rawEndpointLiteral(node);
      if (
        !isRawEndpoint &&
        (foldedKinds.has("canonical-native") || foldedKinds.has("v2-stream")) &&
        ![runtimeResolver, runtimeContract].includes(file)
      ) {
        report(
          node,
          "statically composed backend endpoint is outside the frozen runtime owners",
        );
      }
      if (isRawEndpoint) {
        addCount(inventory, "raw-endpoint", file);
        if (!rawEndpointOwners.has(file)) {
          report(node, "raw backend endpoint is outside the frozen runtime/documentation owners");
        }
      }
    }

    if (isImportMetaEnv(node)) {
      addCount(inventory, "import-meta-env", file);
    }

    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      isImportMetaEnv(node.expression)
    ) {
      const name = accessedPropertyName(node);
      const dynamicElement =
        ts.isElementAccessExpression(node) &&
        (!node.argumentExpression || !ts.isStringLiteralLike(node.argumentExpression));
      if (dynamicElement) {
        report(node, "dynamic import.meta.env access cannot prove the exact public input schema");
      }
      if (name && secretShapedViteName.test(name)) {
        report(node, `client-exposed secret-shaped variable ${name}`);
      }
      if (
        name &&
        /^VITE_/i.test(name) &&
        (file !== runtimeResolver || !allowedPublicViteNames.has(name.toUpperCase()))
      ) {
        const reason = endpointViteName.test(name)
          ? `endpoint-related import.meta.env access is owned by ${runtimeResolver}`
          : `public Vite variable ${name} is outside the exact runtime input schema`;
        report(node, reason);
      }
    }

    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && isImportMetaEnv(node.initializer)) {
      for (const element of node.name.elements) {
        const name = staticName(element.propertyName ?? element.name);
        if (name && secretShapedViteName.test(name)) {
          report(element, `client-exposed secret-shaped variable ${name}`);
        }
        if (
          name &&
          /^VITE_/i.test(name) &&
          (file !== runtimeResolver || !allowedPublicViteNames.has(name.toUpperCase()))
        ) {
          const reason = endpointViteName.test(name)
            ? `endpoint-related import.meta.env access is owned by ${runtimeResolver}`
            : `public Vite variable ${name} is outside the exact runtime input schema`;
          report(element, reason);
        }
      }
    }

    if (
      (ts.isIdentifier(node) && backendOverrideStorageNames.has(node.text)) ||
      (ts.isStringLiteralLike(node) && backendOverrideStorageKeys.has(node.text))
    ) {
      addCount(inventory, "endpoint-override-storage", file);
      if (file !== runtimeResolver) {
        report(node, `backend override storage is owned by ${runtimeResolver}`);
      }
    }

    const tauriStringAccess =
      ts.isStringLiteralLike(node) &&
      tauriGlobalNames.has(node.text) &&
      ts.isBinaryExpression(node.parent) &&
      node.parent.operatorToken.kind === ts.SyntaxKind.InKeyword &&
      node.parent.left === node;
    const tauriName =
      (ts.isIdentifier(node) && tauriGlobalNames.has(node.text) && node.text) ||
      (ts.isElementAccessExpression(node) &&
      tauriGlobalNames.has(resolveStaticKey(node.argumentExpression))
        ? resolveStaticKey(node.argumentExpression)
        : null) ||
      (tauriStringAccess ? node.text : null);
    if (tauriName) {
      addCount(inventory, "tauri-runtime", file);
      if (!tauriDebtOwners.has(file)) {
        report(node, "concrete Tauri access is outside the frozen host adapter debt list");
      }
    }

    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const moduleName = node.moduleSpecifier.text;
      if (!isAllowedNotificationTrustedLeafDependency(moduleName)) {
        report(
          node,
          "Notification Channels dependency closure may import only audited pure dependencies",
        );
      }
      if (
        isNotificationChannelConfigOwner &&
        (moduleName.endsWith("/common/ServiceFactory") ||
          moduleName.endsWith("/store/bambooConfigStore"))
      ) {
        report(node, "Notification Channels must not import a whole-config facade or store");
      }
      if (
        isNotificationChannelConfigOwner &&
        !isAllowedNotificationChannelDependency(file, moduleName)
      ) {
        report(
          node,
          "Notification Channels may import only its audited local authority dependencies",
        );
      }
      if (!isAllowedNotificationPreferencesDependency(file, moduleName)) {
        report(
          node,
          "Notification preferences service may import only the canonical API authority",
        );
      }
      if (
        (file === notificationChannelServiceOwner || file === notificationPreferencesServiceOwner) &&
        localModulePath(file, moduleName) === "src/services/api"
      ) {
        const allowedBindings = notificationAuthorityServiceApiBindings.get(file);
        const clause = node.importClause;
        const bindings = node.importClause?.namedBindings;
        const elements = bindings && ts.isNamedImports(bindings) ? bindings.elements : [];
        const hasOnlyAuditedBindings =
          !clause?.isTypeOnly &&
          !clause?.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          elements.length > 0 &&
          elements.every((element) => {
            const imported = element.propertyName?.text ?? element.name.text;
            return (
              !element.isTypeOnly &&
              element.name.text === imported &&
              allowedBindings?.has(imported) === true
            );
          }) &&
          elements.some((element) => element.name.text === "apiClient");
        if (!hasOnlyAuditedBindings) {
          report(
            node,
            "Notification authority services must import only audited named, unaliased bindings including apiClient",
          );
        }
      }
      checkRuntimeLocalDependency(node, moduleName);
      checkExcludedTestDependency(node, moduleName);
      checkSourceDependencyBoundary(node, moduleName);
      if (moduleName.startsWith("@tauri-apps/")) {
        addCount(inventory, "tauri-runtime", file);
        if (!tauriDebtOwners.has(file)) {
          report(node, "concrete Tauri import is outside the frozen host adapter debt list");
        }
      }
      if (isAlternateHttpModule(moduleName)) {
        report(node, "alternate HTTP/SSE client bypasses the canonical API transport");
      }
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const moduleName = node.moduleSpecifier.text;
      if (isNotificationAuthorityService) {
        report(node, "Notification authority services must not re-export dependency authority");
      }
      if (!isAllowedNotificationTrustedLeafDependency(moduleName)) {
        report(
          node,
          "Notification Channels dependency closure may re-export only audited pure dependencies",
        );
      }
      if (
        isNotificationChannelConfigOwner &&
        !isAllowedNotificationChannelDependency(file, moduleName)
      ) {
        report(
          node,
          "Notification Channels may re-export only its audited local authority dependencies",
        );
      }
      if (!isAllowedNotificationPreferencesDependency(file, moduleName)) {
        report(
          node,
          "Notification preferences service may re-export only the canonical API authority",
        );
      }
      checkRuntimeLocalDependency(node, moduleName);
      checkExcludedTestDependency(node, moduleName);
      checkSourceDependencyBoundary(node, moduleName);
      if (isAlternateHttpModule(moduleName)) {
        report(node, "alternate HTTP/SSE client bypasses the canonical API transport");
      }
    }

    const calledModule = moduleNameFromCall(node);
    if (calledModule) {
      if (isNotificationAuthorityService) {
        report(node, "Notification authority services must not dynamically load dependencies");
      }
      if (!isAllowedNotificationTrustedLeafDependency(calledModule)) {
        report(
          node,
          "Notification Channels dependency closure may load only audited pure dependencies",
        );
      }
      if (
        isNotificationChannelConfigOwner &&
        !isAllowedNotificationChannelDependency(file, calledModule)
      ) {
        report(
          node,
          "Notification Channels may load only its audited local authority dependencies",
        );
      }
      if (!isAllowedNotificationPreferencesDependency(file, calledModule)) {
        report(
          node,
          "Notification preferences service may load only the canonical API authority",
        );
      }
      checkRuntimeLocalDependency(node, calledModule);
      checkExcludedTestDependency(node, calledModule);
      checkSourceDependencyBoundary(node, calledModule);
    }
    if (
      (isNotificationChannelConfigOwner ||
        file === notificationPreferencesServiceOwner ||
        notificationChannelTrustedLeafDependencies) &&
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      !calledModule
    ) {
      report(node, "Notification Channels requires a static approved runtime dependency");
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL" &&
      node.arguments?.length === 2 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (ts.isPropertyAccessExpression(node.arguments[1]) ||
        ts.isElementAccessExpression(node.arguments[1])) &&
      accessedPropertyName(node.arguments[1]) === "url" &&
      isImportMeta(node.arguments[1].expression)
    ) {
      checkSourceDependencyBoundary(node, node.arguments[0].text);
    }
    if (
      runtimeLocalImportAllowlist.has(file) &&
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      !calledModule
    ) {
      report(
        node,
        `${file} is a pre-install runtime module and requires a static approved dependency`,
      );
    }
    if (calledModule?.startsWith("@tauri-apps/")) {
      addCount(inventory, "tauri-runtime", file);
      if (!tauriDebtOwners.has(file)) {
        report(node, "concrete Tauri import is outside the frozen host adapter debt list");
      }
    }
    if (isAlternateHttpModule(calledModule)) {
      report(node, "alternate HTTP/SSE client bypasses the canonical API transport");
    }

    const concreteOwnerClass =
      file === apiClientOwner
        ? "ApiClient"
        : file === httpOwner
          ? httpTransportType
          : null;
    const directOwnerConstructionTarget = ts.isNewExpression(node)
      ? unwrapStaticExpression(node.expression)
      : null;
    const reflectiveOwnerConstructionTarget = reflectiveConstructionTarget(node);
    const allowedOwnerConstructors = ownerClassAllowedConstructors.get(file);
    const hasForbiddenOwnerConstruction =
      reflectiveOwnerConstructionTarget !== null ||
      (directOwnerConstructionTarget !== null &&
        (!ts.isIdentifier(directOwnerConstructionTarget) ||
          !allowedOwnerConstructors?.has(directOwnerConstructionTarget.text)));
    if (
      concreteOwnerClass &&
      isInsideNamedClass(node, concreteOwnerClass) &&
      hasForbiddenOwnerConstruction
    ) {
      report(
        node,
        `${concreteOwnerClass} definition owner may not construct a second instance inside its class body`,
      );
    }

    const isFetchMember =
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      resolvedPropertyName(node) === "fetch";
    const isUnprovenBrowserFetchMember =
      ts.isElementAccessExpression(node) &&
      resolvedPropertyName(node) === null &&
      isBrowserGlobalExpression(node.expression);
    const isFetchMemberName =
      ts.isIdentifier(node) &&
      ((ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
        (ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node));
    const isFetchIdentifier =
      ts.isIdentifier(node) &&
      node.text === "fetch" &&
      !isFetchMemberName &&
      !isInsideProvenNonFetchKey(node) &&
      !isNamedDeclaration(node);
    const isFetchBinding =
      ts.isBindingElement(node) &&
      resolvedDeclaredPropertyName(node.propertyName ?? node.name) === "fetch";
    const isUnprovenFetchBinding =
      ts.isBindingElement(node) &&
      node.propertyName &&
      ts.isComputedPropertyName(node.propertyName) &&
      resolvedDeclaredPropertyName(node.propertyName) === null &&
      isBrowserGlobalExpression(bindingPatternSource(node));
    const isFetchAssignmentProperty =
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      resolvedDeclaredPropertyName(node.name) === "fetch" &&
      isAssignmentPatternProperty(node);
    const isUnprovenFetchAssignmentProperty =
      ts.isPropertyAssignment(node) &&
      ts.isComputedPropertyName(node.name) &&
      resolvedDeclaredPropertyName(node.name) === null &&
      isBrowserGlobalExpression(assignmentPatternSource(node));
    const isReflectiveFetchRead = isReflectivePropertyRead(node, "fetch");
    const isUnprovenReflectiveFetchRead = isUnprovenReflectivePropertyRead(node);
    if (
      isFetchMember ||
      isUnprovenBrowserFetchMember ||
      isFetchIdentifier ||
      isFetchBinding ||
      isUnprovenFetchBinding ||
      isFetchAssignmentProperty ||
      isUnprovenFetchAssignmentProperty ||
      isReflectiveFetchRead ||
      isUnprovenReflectiveFetchRead
    ) {
      recordFetchSite(structuralFetchSiteForDescendant(node) ?? node);
    }

    const browserTransportFactoryIdentifier =
      ts.isIdentifier(node) && node.text === browserHttpTransportFactory;
    const browserTransportFactoryElement =
      ts.isElementAccessExpression(node) &&
      resolveStaticKey(node.argumentExpression) === browserHttpTransportFactory;
    if (
      (browserTransportFactoryIdentifier || browserTransportFactoryElement) &&
      (!browserHttpTransportFactoryOwners.has(file) ||
        !isDirectBrowserTransportFactoryUse(node))
    ) {
      report(
        node,
        `${browserHttpTransportFactory} is a production composition API owned by ${apiCompositionOwner} and must be called directly`,
      );
    }

    const httpTransportIdentifier =
      ts.isIdentifier(node) && node.text === httpTransportType;
    const httpTransportElement =
      ts.isElementAccessExpression(node) &&
      resolveStaticKey(node.argumentExpression) === httpTransportType;
    if (httpTransportIdentifier || httpTransportElement) {
      if (file === httpOwner) {
        const allowedOwnerReference =
          isClassDeclarationName(node, httpTransportType) ||
          isTypeOnlyReference(node) ||
          isDirectNamedConstructionReference(node, httpTransportType);
        if (!allowedOwnerReference) {
          report(
            node,
            `${httpTransportType} definition owner may not alias, extend, or reflectively construct the transport`,
          );
        }
      } else if (!isTypeOnlyReference(node)) {
        report(
          node,
          `${httpTransportType} is an infrastructure transport type outside src/services/api`,
        );
      }
    }

    const alternateTransportIdentifier =
      ts.isIdentifier(node) && alternateTransportNames.has(node.text);
    const alternateTransportElement =
      ts.isElementAccessExpression(node) &&
      alternateTransportNames.has(resolveStaticKey(node.argumentExpression));
    if (alternateTransportIdentifier || alternateTransportElement) {
      report(node, "alternate HTTP/SSE client bypasses the canonical API transport");
    }

    const apiClientIdentifier = ts.isIdentifier(node) && node.text === "ApiClient";
    const apiClientElement =
      ts.isElementAccessExpression(node) &&
      resolveStaticKey(node.argumentExpression) === "ApiClient";
    if (apiClientIdentifier || apiClientElement) {
      if (file === apiClientOwner) {
        const allowedDefinitionReference =
          isClassDeclarationName(node, "ApiClient") || isTypeOnlyReference(node);
        if (!allowedDefinitionReference) {
          report(
            node,
            "ApiClient definition owner may not construct, alias, extend, or reflectively construct a client",
          );
        }
      } else if (!apiClientValueOwners.has(file)) {
        report(
          node,
          `ApiClient construction is owned by ${apiCompositionOwner}; concrete value access is forbidden elsewhere`,
        );
      } else if (file === apiCompositionOwner && !isDirectCanonicalApiClientUse(node)) {
        report(
          node,
          `production ApiClient must be the direct top-level binding imported from ./client`,
        );
      }
    }

    const websocketIdentifier = ts.isIdentifier(node) && node.text === "WebSocket";
    const websocketElement =
      ts.isElementAccessExpression(node) &&
      resolveStaticKey(node.argumentExpression) === "WebSocket";
    if (websocketIdentifier || websocketElement) {
      const isReadDebt =
        file === websocketReadDebtOwner &&
        websocketIdentifier &&
        ts.isTypeOfExpression(node.parent);
      if (isReadDebt) {
        addCount(inventory, "websocket-read-debt", file);
      } else if (file !== websocketOwner) {
        report(node, "WebSocket access is outside the canonical v2 transport owner");
      }
    }

    if (ts.isNewExpression(node)) {
      const constructorName = ts.isIdentifier(node.expression)
        ? node.expression.text
        : resolvedPropertyName(node.expression);
      if (constructorName === "WebSocket") {
        addCount(inventory, "websocket-constructor", file);
      }
      if (constructorName === "ApiClient") {
        addCount(inventory, "api-client-constructor", file);
        if (file === apiCompositionOwner && !usesSharedBrowserTransport(node)) {
          report(
            node,
            `the production ApiClient must receive the direct ${browserHttpTransportFactory} binding`,
          );
        }
        if (file === apiCompositionOwner && !usesCanonicalNativeEndpoint(node)) {
          report(
            node,
            "the production ApiClient must use direct runtime.endpoints.nativeApi as its baseUrl",
          );
        }
      }
      if (constructorName === httpTransportType) {
        addCount(inventory, "http-transport-constructor", file);
        if (file !== httpOwner) {
          report(
            node,
            `${httpTransportType} construction is owned by ${httpOwner}; production composition must use ${browserHttpTransportFactory}`,
          );
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const callName = ts.isIdentifier(node.expression)
        ? node.expression.text
        : resolvedPropertyName(node.expression);
      if (callName === browserHttpTransportFactory) {
        addCount(inventory, "browser-http-transport-composition", file);
        if (file !== apiCompositionOwner) {
          report(
            node,
            `${browserHttpTransportFactory} may be called only once by ${apiCompositionOwner}`,
          );
        }
      }
    }

    const endpointPropertyAccess =
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      resolvedPropertyName(node) === "endpoints";
    let endpointBinding =
      ts.isBindingElement(node) &&
      staticName(node.propertyName ?? node.name) === "endpoints" &&
      ts.isObjectBindingPattern(node.parent);
    if (endpointBinding && nonRuntimeEndpointBindingOwners.has(file)) {
      addCount(inventory, "non-runtime-endpoint-binding", file);
      endpointBinding = false;
    }
    const endpointProperty = endpointPropertyAccess || endpointBinding;
    if (endpointProperty) {
      addCount(inventory, "runtime-endpoint-read", file);
      if (!endpointConsumers.has(file) && file !== runtimeResolver) {
        report(node, "runtime endpoints are consumed outside designated transport adapters");
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  const countFor = (category) => inventory[category]?.[file] ?? 0;
  if (file === apiCompositionOwner) {
    if (countFor("api-client-constructor") !== 1) {
      report(sourceFile, `${apiCompositionOwner} must construct exactly one native ApiClient`);
    }
    if (countFor("browser-http-transport-composition") !== 1) {
      report(
        sourceFile,
        `${apiCompositionOwner} must compose exactly one ${browserHttpTransportFactory}`,
      );
    }
    if (countFor("runtime-endpoint-read") !== 1) {
      report(
        sourceFile,
        `${apiCompositionOwner} must read exactly one native runtime endpoint`,
      );
    }
  }
  if (file === httpOwner) {
    if (countFor("http-transport-constructor") !== 1) {
      report(sourceFile, `${httpOwner} must construct exactly one ${httpTransportType}`);
    }
    if (countFor("fetch-reference") !== 1) {
      report(sourceFile, `${httpOwner} must own exactly one browser fetch reference`);
    }
  }
  return { inventory, violations };
};

export const buildInventory = (sources) => {
  const inventory = {};
  for (const [file, source] of sources) {
    const analyzed = analyzeSource(file, source).inventory;
    for (const [category, owners] of Object.entries(analyzed)) {
      for (const [owner, count] of Object.entries(owners)) {
        addCount(inventory, category, owner, count);
      }
    }
  }
  return inventory;
};

export const compareInventory = (actual, expected) => {
  const failures = [];
  for (const category of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
    const actualOwners = actual[category] ?? {};
    const expectedOwners = expected[category] ?? {};
    for (const file of new Set([...Object.keys(actualOwners), ...Object.keys(expectedOwners)])) {
      const actualCount = actualOwners[file] ?? 0;
      const expectedCount = expectedOwners[file] ?? 0;
      if (actualCount !== expectedCount) {
        failures.push(
          `${category}: ${file} has ${actualCount} occurrence(s); expected ${expectedCount}`,
        );
      }
    }
  }
  return failures;
};

export const findArchitectureViolations = (sources) => {
  const violations = [];
  for (const [file, source] of sources) {
    violations.push(...analyzeSource(file, source).violations);
    for (const protectedFile of notificationProtectedPhysicalFiles) {
      if (file.startsWith(protectedFile + "/")) {
        violations.push(
          file +
            ": Notification authority dependency " +
            protectedFile +
            " must remain a regular source file; a same-name directory entry is forbidden",
        );
      }
    }
  }
  return violations;
};

const referencedNotificationProtectedPhysicalFiles = (sources) => {
  const referencedPhysicalFiles = new Set();
  for (const [file, source] of sources) {
    if (!codeExtensions.has(path.extname(file))) continue;
    const sourceFile = parseSource(file, source);
    const recordProtectedDependency = (moduleName) => {
      if (!isLocalModule(moduleName)) return;
      const resolved = localModulePath(file, moduleName);
      const protectedFile = notificationProtectedPhysicalDependencies.get(resolved);
      if (
        protectedFile &&
        isCanonicalNotificationProtectedDependency(moduleName, resolved)
      ) {
        referencedPhysicalFiles.add(protectedFile);
      }
    };
    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
        recordProtectedDependency(node.moduleSpecifier.text);
      }
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        recordProtectedDependency(node.moduleSpecifier.text);
      }
      const calledModule = moduleNameFromCall(node);
      if (calledModule) recordProtectedDependency(calledModule);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return referencedPhysicalFiles;
};

const verifyNotificationProtectedPhysicalFiles = (sources) =>
  [...referencedNotificationProtectedPhysicalFiles(sources)]
    .filter((file) => !sources.has(file))
    .map(
      (file) =>
        file +
        ": Notification authority dependency must remain present as its canonical regular source file",
    );

const verifyNotificationProtectedFilesystemFiles = async (root, sources) => {
  const failures = [];
  for (const file of referencedNotificationProtectedPhysicalFiles(sources)) {
    if (!sources.has(file)) continue;
    const segments = file.split("/");
    let currentPath = root;
    for (const [index, segment] of segments.entries()) {
      currentPath = path.join(currentPath, segment);
      const fileStatus = await lstat(currentPath);
      const isTarget = index === segments.length - 1;
      if ((isTarget && fileStatus.isFile()) || (!isTarget && fileStatus.isDirectory())) continue;
      const relativePath = path.relative(root, currentPath).split(path.sep).join("/");
      failures.push(
        file +
          ": Notification authority dependency must be a regular file reached only through real directories; " +
          relativePath +
          " is a directory, symbolic link, or other non-canonical path entry",
      );
      break;
    }
  }
  return failures;
};

export const verifyBootstrapOrder = (mainSource) => {
  const file = "src/main.tsx";
  const sourceFile = parseSource(file, mainSource);
  const failures = [];
  const safeStaticModules = new Set([
    "react",
    "react-dom/client",
    "./index.css",
    "./runtime/browserRuntime",
    "./runtime/browserRuntime.ts",
    "./runtime/preloadErrorPolicy",
    "./runtime/preloadErrorPolicy.ts",
    "./runtime/runtimeConfig",
    "./runtime/runtimeConfig.ts",
  ]);
  const installCalls = [];
  const bootstrapInvocations = [];
  const localDynamicImports = [];
  const renderCalls = [];
  const identifierOccurrences = [];

  const directStatement = (node, containerKind) => {
    let current = node;
    while (current.parent && current.parent.kind !== containerKind) current = current.parent;
    return current.parent?.kind === containerKind ? current : null;
  };

  const functionNameForBlock = (block) => {
    if (!block || !ts.isBlock(block)) return null;
    const owner = block.parent;
    if (ts.isFunctionDeclaration(owner) && owner.name) return owner.name.text;
    if (
      (ts.isArrowFunction(owner) || ts.isFunctionExpression(owner)) &&
      ts.isVariableDeclaration(owner.parent) &&
      ts.isIdentifier(owner.parent.name)
    ) {
      return owner.parent.name.text;
    }
    return null;
  };

  const hasUnconditionalPathToStatement = (node, statement) => {
    let current = node;
    while (current && current !== statement) {
      if (
        ts.isBinaryExpression(current) ||
        ts.isConditionalExpression(current) ||
        ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current) ||
        (ts.isCallExpression(current) && current.questionDotToken) ||
        (ts.isPropertyAccessExpression(current) && current.questionDotToken) ||
        (ts.isElementAccessExpression(current) && current.questionDotToken)
      ) {
        return false;
      }
      current = current.parent;
    }
    return current === statement;
  };

  const defaultBindingName = (element) => {
    if (
      !element ||
      !ts.isBindingElement(element) ||
      element.dotDotDotToken ||
      element.initializer ||
      !ts.isObjectBindingPattern(element.name)
    ) {
      return null;
    }
    const [binding] = element.name.elements;
    return element.name.elements.length === 1 &&
      !binding.dotDotDotToken &&
      !binding.initializer &&
      ts.isIdentifier(binding.propertyName) &&
      binding.propertyName.text === "default" &&
      ts.isIdentifier(binding.name)
      ? binding.name.text
      : null;
  };

  const isCanonicalApplicationImportStatement = (statement) => {
    if (!statement || !ts.isVariableStatement(statement)) return false;
    const declarations = statement.declarationList.declarations;
    if (declarations.length !== 1 || !declarations[0].initializer) return false;
    const declaration = declarations[0];
    if (
      !ts.isArrayBindingPattern(declaration.name) ||
      declaration.name.elements.length !== 2 ||
      defaultBindingName(declaration.name.elements[0]) !== "Root" ||
      defaultBindingName(declaration.name.elements[1]) !== "ErrorBoundary"
    ) {
      return false;
    }
    let initializer = declaration.initializer;
    if (!ts.isAwaitExpression(initializer)) return false;
    initializer = initializer.expression;
    if (
      !ts.isCallExpression(initializer) ||
      !ts.isPropertyAccessExpression(initializer.expression) ||
      !ts.isIdentifier(initializer.expression.expression) ||
      initializer.expression.expression.text !== "Promise" ||
      initializer.expression.name.text !== "all" ||
      initializer.arguments.length !== 1 ||
      !ts.isArrayLiteralExpression(initializer.arguments[0])
    ) {
      return false;
    }
    const elements = initializer.arguments[0].elements;
    return (
      elements.length === 2 &&
      elements.every(
        (element) =>
          ts.isCallExpression(element) &&
          element.expression.kind === ts.SyntaxKind.ImportKeyword &&
          element.arguments.length === 1,
      ) &&
      moduleNameFromCall(elements[0]) === "./Root.tsx" &&
      moduleNameFromCall(elements[1]) === "./components/app/ErrorBoundary.tsx"
    );
  };

  const isCanonicalRenderCall = (node) =>
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "render" &&
    ts.isCallExpression(node.expression.expression) &&
    ts.isIdentifier(node.expression.expression.expression) &&
    node.expression.expression.expression.text === "createRoot";

  const nonWhitespaceJsxChildren = (node) =>
    node.children.filter((child) => !ts.isJsxText(child) || child.text.trim());

  const isCanonicalRenderStatement = (statement) => {
    if (!statement || !ts.isExpressionStatement(statement)) return false;
    const renderCall = statement.expression;
    if (
      !isCanonicalRenderCall(renderCall) ||
      renderCall.expression.expression.arguments.length !== 1 ||
      !ts.isIdentifier(renderCall.expression.expression.arguments[0]) ||
      renderCall.expression.expression.arguments[0].text !== "rootElement" ||
      renderCall.arguments.length !== 1 ||
      !ts.isJsxElement(renderCall.arguments[0])
    ) {
      return false;
    }

    const strictMode = renderCall.arguments[0];
    const strictChildren = nonWhitespaceJsxChildren(strictMode);
    if (
      !ts.isIdentifier(strictMode.openingElement.tagName) ||
      strictMode.openingElement.tagName.text !== "StrictMode" ||
      !ts.isIdentifier(strictMode.closingElement.tagName) ||
      strictMode.closingElement.tagName.text !== "StrictMode" ||
      strictMode.openingElement.attributes.properties.length !== 0 ||
      strictChildren.length !== 1 ||
      !ts.isJsxElement(strictChildren[0])
    ) {
      return false;
    }

    const boundary = strictChildren[0];
    const boundaryChildren = nonWhitespaceJsxChildren(boundary);
    const [nameAttribute] = boundary.openingElement.attributes.properties;
    return (
      ts.isIdentifier(boundary.openingElement.tagName) &&
      boundary.openingElement.tagName.text === "ErrorBoundary" &&
      ts.isIdentifier(boundary.closingElement.tagName) &&
      boundary.closingElement.tagName.text === "ErrorBoundary" &&
      boundary.openingElement.attributes.properties.length === 1 &&
      ts.isJsxAttribute(nameAttribute) &&
      nameAttribute.name.text === "name" &&
      Boolean(nameAttribute.initializer) &&
      ts.isStringLiteral(nameAttribute.initializer) &&
      nameAttribute.initializer.text === "Root" &&
      boundaryChildren.length === 1 &&
      ts.isJsxSelfClosingElement(boundaryChildren[0]) &&
      ts.isIdentifier(boundaryChildren[0].tagName) &&
      boundaryChildren[0].tagName.text === "Root" &&
      boundaryChildren[0].attributes.properties.length === 0
    );
  };

  const hasOnlyExactNamedImport = (moduleName, importedName) => {
    const matchingImports = sourceFile.statements.filter(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteralLike(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === moduleName,
    );
    if (matchingImports.length !== 1) return false;
    const clause = matchingImports[0].importClause;
    const elements =
      clause && !clause.isTypeOnly && !clause.name && clause.namedBindings &&
      ts.isNamedImports(clause.namedBindings)
        ? clause.namedBindings.elements
        : [];
    const [specifier] = elements;
    return (
      elements.length === 1 &&
      !specifier.isTypeOnly &&
      !specifier.propertyName &&
      specifier.name.text === importedName
    );
  };

  const visit = (node) => {
    if (ts.isIdentifier(node)) identifierOccurrences.push(node);
    if (isImportMetaGlobCall(node)) {
      failures.push(`${file}: import.meta.glob bypasses the explicit post-install module boundary`);
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const moduleName = node.moduleSpecifier.text;
      if (!node.importClause?.isTypeOnly && !safeStaticModules.has(moduleName)) {
        failures.push(`${file}: unsafe static application import before runtime installation: ${moduleName}`);
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const moduleName = node.moduleSpecifier.text;
      failures.push(`${file}: unsafe static application re-export before runtime installation: ${moduleName}`);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "installRuntimeConfig"
    ) {
      const statement = node.parent;
      const block = ts.isExpressionStatement(statement) && ts.isBlock(statement.parent)
        ? statement.parent
        : null;
      installCalls.push({ node, statement, block });
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression)
    ) {
      const topLevelStatement = directStatement(node, ts.SyntaxKind.SourceFile);
      if (
        topLevelStatement &&
        ts.isExpressionStatement(topLevelStatement) &&
        hasUnconditionalPathToStatement(node, topLevelStatement)
      ) {
        bootstrapInvocations.push({ name: node.expression.text, node });
      }
    }
    if (isCanonicalRenderCall(node)) {
      const statement = directStatement(node, ts.SyntaxKind.Block);
      const block = statement?.parent && ts.isBlock(statement.parent) ? statement.parent : null;
      const unconditional =
        Boolean(statement) &&
        ts.isExpressionStatement(statement) &&
        hasUnconditionalPathToStatement(node, statement);
      renderCalls.push({ statement, block, unconditional });
    }
    const moduleName = moduleNameFromCall(node);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (!moduleName) {
        failures.push(`${file}: dynamic imports in the composition root must use a static module name`);
      } else if (isLocalModule(moduleName)) {
        const statement = directStatement(node, ts.SyntaxKind.Block);
        const block = statement?.parent && ts.isBlock(statement.parent) ? statement.parent : null;
        const unconditional =
          Boolean(statement) &&
          (ts.isVariableStatement(statement) || ts.isExpressionStatement(statement)) &&
          hasUnconditionalPathToStatement(node, statement);
        localDynamicImports.push({ moduleName, statement, block, unconditional });
      }
    }
    if (
      moduleName &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      isLocalModule(moduleName)
    ) {
      failures.push(`${file}: unsafe CommonJS application import before runtime installation: ${moduleName}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (installCalls.length !== 1) {
    failures.push(`${file}: exactly one unconditional runtime installation is required in the bootstrap function`);
  }
  const [install] = installCalls;
  if (install && !install.block) {
    failures.push(`${file}: installRuntimeConfig must be an unconditional statement in the bootstrap function block`);
  }

  const rootImports = localDynamicImports.filter(({ moduleName }) =>
    /^\.\/Root(?:\.tsx)?$/.test(moduleName),
  );
  if (rootImports.length !== 1) {
    failures.push(`${file}: Root must be loaded through the post-install dynamic boundary`);
  }

  for (const { moduleName, statement, block, unconditional } of localDynamicImports) {
    if (
      !install?.block ||
      block !== install.block ||
      !unconditional ||
      !statement ||
      statement.getStart(sourceFile) <= install.statement.getStart(sourceFile)
    ) {
      failures.push(`${file}: dynamic application import precedes runtime installation: ${moduleName}`);
    }
  }

  if (install?.block) {
    const bootstrapName = functionNameForBlock(install.block);
    const matchingInvocations = bootstrapName
      ? bootstrapInvocations.filter(
          ({ name, node }) => name === bootstrapName && node.getStart(sourceFile) > install.block.end,
        )
      : [];
    const bootstrapOwner = install.block.parent;
    const bootstrapHasNoParameters =
      (ts.isFunctionDeclaration(bootstrapOwner) ||
        ts.isArrowFunction(bootstrapOwner) ||
        ts.isFunctionExpression(bootstrapOwner)) &&
      bootstrapOwner.parameters.length === 0;
    const declarationIdentifier =
      (ts.isFunctionDeclaration(bootstrapOwner) && bootstrapOwner.name) ||
      ((ts.isArrowFunction(bootstrapOwner) || ts.isFunctionExpression(bootstrapOwner)) &&
      ts.isVariableDeclaration(bootstrapOwner.parent) &&
      ts.isIdentifier(bootstrapOwner.parent.name)
        ? bootstrapOwner.parent.name
        : null);
    const matchingIdentifiers = bootstrapName
      ? identifierOccurrences.filter((identifier) => identifier.text === bootstrapName)
      : [];
    const invocationIdentifier = matchingInvocations[0]?.node.expression;
    const frozenIdentity =
      matchingIdentifiers.length === 2 &&
      matchingIdentifiers.includes(declarationIdentifier) &&
      matchingIdentifiers.includes(invocationIdentifier);
    if (!bootstrapName || matchingInvocations.length !== 1 || !frozenIdentity) {
      failures.push(
        `${file}: the runtime bootstrap function must be invoked exactly once and unconditionally at module scope`,
      );
    }

    const statements = install.block.statements;
    const importStatements = new Set(localDynamicImports.map(({ statement }) => statement));
    const bootstrapRenderCalls = renderCalls.filter(({ block }) => block === install.block);
    const canonicalShape =
      bootstrapHasNoParameters &&
      [
        ["react", "StrictMode"],
        ["react-dom/client", "createRoot"],
        ["./runtime/browserRuntime.ts", "resolveDefaultBrowserRuntimeConfig"],
        ["./runtime/runtimeConfig.ts", "installRuntimeConfig"],
      ].every(([moduleName, importedName]) => hasOnlyExactNamedImport(moduleName, importedName)) &&
      Object.entries({
        Promise: 1,
        createRoot: 2,
        ErrorBoundary: 3,
        installRuntimeConfig: 2,
        resolveDefaultBrowserRuntimeConfig: 2,
        Root: 2,
        StrictMode: 3,
      }).every(
        ([name, count]) =>
          identifierOccurrences.filter((identifier) => identifier.text === name).length === count,
      ) &&
      statements.length === 3 &&
      statements[0] === install.statement &&
      ts.isExpressionStatement(statements[0]) &&
      install.node.arguments.length === 1 &&
      ts.isCallExpression(install.node.arguments[0]) &&
      ts.isIdentifier(install.node.arguments[0].expression) &&
      install.node.arguments[0].expression.text === "resolveDefaultBrowserRuntimeConfig" &&
      install.node.arguments[0].arguments.length === 0 &&
      importStatements.size === 1 &&
      importStatements.has(statements[1]) &&
      isCanonicalApplicationImportStatement(statements[1]) &&
      renderCalls.length === 1 &&
      bootstrapRenderCalls.length === 1 &&
      bootstrapRenderCalls[0].unconditional &&
      bootstrapRenderCalls[0].statement === statements[2] &&
      isCanonicalRenderStatement(statements[2]);
    if (!canonicalShape) {
      failures.push(
        `${file}: bootstrap must install runtime, load application modules, and render React as three reachable statements`,
      );
    }
  }
  return failures;
};

const collectSourceFiles = async (root) => {
  const sourceRoot = path.join(root, "src");
  const files = [];

  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "test" || entry.name === "__tests__") continue;
        await walk(absolute);
        continue;
      }
      const extension = path.extname(entry.name);
      if (!codeExtensions.has(extension)) continue;
      if (/\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(entry.name)) continue;
      files.push(absolute);
    }
  };

  await walk(sourceRoot);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      !/\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(entry.name) &&
      (codeExtensions.has(path.extname(entry.name)) ||
        entry.name === "index.html" ||
        entry.name === ".env" ||
        entry.name.startsWith(".env."))
    ) {
      files.push(path.join(root, entry.name));
    }
  }

  const sources = new Map();
  for (const absolute of files.sort()) {
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    sources.set(relative, await readFile(absolute, "utf8"));
  }
  return sources;
};

export const verifyRepositoryArchitecture = async (root = defaultRoot) => {
  const sources = await collectSourceFiles(root);
  return [
    ...findArchitectureViolations(sources),
    ...verifyNotificationProtectedPhysicalFiles(sources),
    ...(await verifyNotificationProtectedFilesystemFiles(root, sources)),
    ...compareInventory(buildInventory(sources), expectedInventory),
    ...verifyBootstrapOrder(sources.get("src/main.tsx") ?? ""),
  ];
};

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  const failures = await verifyRepositoryArchitecture(defaultRoot);
  if (failures.length > 0) {
    console.error("Lotus Next architecture boundary check failed:\n");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("Lotus Next architecture boundary check passed.");
  }
}
