import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, "..");

const runtimeResolver = "src/runtime/browserRuntime.ts";
const runtimeContract = "src/runtime/runtimeConfig.ts";
const compositionRoot = "src/main.tsx";
const httpOwner = "src/services/api/client.ts";
const apiCompositionOwner = "src/services/api/index.ts";
const websocketOwner = "src/services/chat/v2Stream.ts";
const websocketReadDebtOwner = "src/services/chat/accountFeed.ts";
const apiClientValueOwners = new Set([httpOwner, apiCompositionOwner]);
const runtimeLocalImportAllowlist = new Map([
  [runtimeResolver, new Set(["./runtimeConfig", "./runtimeConfig.ts"])],
  [runtimeContract, new Set()],
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
    "src/runtime/browserRuntime.ts": 2,
    "src/runtime/runtimeConfig.ts": 3,
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
    "src/runtime/browserRuntime.ts": 7,
  },
  "tauri-runtime": {
    "src/runtime/browserRuntime.ts": 4,
    "src/services/notification/desktopNotification.ts": 2,
    "src/shared/services/FileOperationsService.ts": 2,
    "src/shared/utils/openExternalLink.ts": 1,
    "src/shared/utils/osInfoUtils.ts": 1,
  },
  "fetch-reference": {
    "src/services/api/client.ts": 2,
  },
  "websocket-constructor": {
    "src/services/chat/v2Stream.ts": 2,
  },
  "websocket-read-debt": {
    "src/services/chat/accountFeed.ts": 1,
  },
  "api-client-constructor": {
    "src/services/api/index.ts": 2,
  },
  "runtime-endpoint-read": {
    "src/services/api/index.ts": 2,
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
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  if (
    ts.isComputedPropertyName(node) &&
    (ts.isStringLiteralLike(node.expression) || ts.isIdentifier(node.expression))
  ) {
    return node.expression.text;
  }
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
  if (parsed.username || parsed.password) return "must not contain credentials";
  if (parsed.search || parsed.hash) return "must not contain a query or fragment";
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname && pathname !== "/v1") return "path must be empty or /v1";
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
  const sourceFile = parseSource(file, source);
  const inventory = {};
  const violations = [];

  const report = (node, message) => {
    violations.push(`${positionLabel(file, sourceFile, node)}: ${message}`);
  };

  const globalObjectName = (expression) =>
    ts.isIdentifier(expression) && ["globalThis", "self", "window"].includes(expression.text);
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
  const isFetchBindingFromGlobal = (identifier) => {
    const binding = identifier.parent;
    if (!ts.isBindingElement(binding) || !ts.isObjectBindingPattern(binding.parent)) return false;
    const declaration = binding.parent.parent;
    return (
      ts.isVariableDeclaration(declaration) &&
      Boolean(declaration.initializer) &&
      globalObjectName(declaration.initializer)
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
    const runtimeApiName =
      (ts.isIdentifier(node) && runtimeCompositionApiOwners.has(node.text) && node.text) ||
      (ts.isElementAccessExpression(node) &&
      runtimeCompositionApiOwners.has(staticName(node.argumentExpression))
        ? staticName(node.argumentExpression)
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

    if (isFrozenProviderEndpoint(file, node)) {
      addCount(inventory, "provider-endpoint-debt", file);
    } else if (rawEndpointLiteral(node)) {
      addCount(inventory, "raw-endpoint", file);
      if (!rawEndpointOwners.has(file)) {
        report(node, "raw backend endpoint is outside the frozen runtime/documentation owners");
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
      (ts.isIdentifier(node) && node.text === "BACKEND_OVERRIDE_STORAGE_KEY") ||
      (ts.isStringLiteralLike(node) && node.text === "copilot_backend_base_url")
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
      (ts.isElementAccessExpression(node) && tauriGlobalNames.has(staticName(node.argumentExpression))
        ? staticName(node.argumentExpression)
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
      checkRuntimeLocalDependency(node, node.moduleSpecifier.text);
      checkExcludedTestDependency(node, node.moduleSpecifier.text);
      checkSourceDependencyBoundary(node, node.moduleSpecifier.text);
    }

    const calledModule = moduleNameFromCall(node);
    if (calledModule) {
      checkRuntimeLocalDependency(node, calledModule);
      checkExcludedTestDependency(node, calledModule);
      checkSourceDependencyBoundary(node, calledModule);
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

    const isFetchIdentifier =
      ts.isIdentifier(node) &&
      node.text === "fetch" &&
      (!ts.isPropertyAccessExpression(node.parent) ||
        node.parent.name !== node ||
        globalObjectName(node.parent.expression)) &&
      (!isNamedDeclaration(node) || isFetchBindingFromGlobal(node));
    const isFetchElement =
      ts.isElementAccessExpression(node) &&
      staticName(node.argumentExpression) === "fetch" &&
      globalObjectName(node.expression);
    if (isFetchIdentifier || isFetchElement) {
      addCount(inventory, "fetch-reference", file);
      if (file !== httpOwner) {
        report(node, "direct or aliased fetch access creates a second HTTP transport owner");
      }
    }

    const alternateTransportIdentifier =
      ts.isIdentifier(node) && alternateTransportNames.has(node.text);
    const alternateTransportElement =
      ts.isElementAccessExpression(node) &&
      alternateTransportNames.has(staticName(node.argumentExpression));
    if (alternateTransportIdentifier || alternateTransportElement) {
      report(node, "alternate HTTP/SSE client bypasses the canonical API transport");
    }

    const apiClientIdentifier = ts.isIdentifier(node) && node.text === "ApiClient";
    const apiClientElement =
      ts.isElementAccessExpression(node) && staticName(node.argumentExpression) === "ApiClient";
    if ((apiClientIdentifier || apiClientElement) && !apiClientValueOwners.has(file)) {
      report(
        node,
        `ApiClient construction is owned by ${apiCompositionOwner}; concrete value access is forbidden elsewhere`,
      );
    }

    const websocketIdentifier = ts.isIdentifier(node) && node.text === "WebSocket";
    const websocketElement =
      ts.isElementAccessExpression(node) && staticName(node.argumentExpression) === "WebSocket";
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
        : accessedPropertyName(node.expression);
      if (constructorName === "WebSocket") {
        addCount(inventory, "websocket-constructor", file);
      }
      if (constructorName === "ApiClient") {
        addCount(inventory, "api-client-constructor", file);
      }
    }

    const endpointPropertyAccess =
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      accessedPropertyName(node) === "endpoints";
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
  }
  return violations;
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
