import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createLookupQuery,
  JIANDU_MEMORY_GRANULARITIES,
  JIANDU_MEMORY_LIMITS,
  JIANDU_MEMORY_TYPES,
  JianduMemoryApiError,
  jianduMemoryApi,
  normalizeCreateProjectMemoryInput,
  sameJianduProjectContext,
  type CreateProjectMemoryInput,
  type JianduMemoryApiClient,
  type JianduMemoryDetail,
  type JianduMemoryListItem,
  type JianduMemoryPage,
  type JianduMemoryType,
  type JianduProjectContext,
} from "@/services/memory/jianduMemoryApi";
import { useAppStore } from "@/shared/store/appStore";

type UiError =
  "invalid" | "context" | "denied" | "unavailable" | "rejected" | "malformed";

type Notice =
  | { kind: "created" | "archived"; title: string }
  | { kind: "createdRefreshFailed" | "archivedRefreshFailed"; title: string };

interface Draft {
  title: string;
  type: JianduMemoryType;
  content: string;
  tags: string;
  keywords: string;
  entities: string;
  granularity: string;
}

interface PreflightResult {
  fingerprint: string;
  items: JianduMemoryListItem[];
  truncated: boolean;
}

type StatusFilter = "active" | "archived";

const EMPTY_DRAFT: Draft = {
  title: "",
  type: "project",
  content: "",
  tags: "",
  keywords: "",
  entities: "",
  granularity: "",
};

const errorKey = (error: unknown): UiError => {
  if (!(error instanceof JianduMemoryApiError)) return "unavailable";
  switch (error.code) {
    case "invalid_input":
      return "invalid";
    case "context_unavailable":
      return "context";
    case "access_denied":
      return "denied";
    case "action_rejected":
      return "rejected";
    case "malformed_response":
      return "malformed";
    case "request_failed":
      return "unavailable";
  }
};

const csv = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const toCreateInput = (draft: Draft): CreateProjectMemoryInput => ({
  title: draft.title,
  type: draft.type,
  content: draft.content,
  tags: csv(draft.tags),
  keywords: csv(draft.keywords),
  entities: csv(draft.entities),
  ...(draft.granularity
    ? {
        granularity:
          draft.granularity as CreateProjectMemoryInput["granularity"],
      }
    : {}),
});

const mergeItems = (
  current: JianduMemoryListItem[],
  incoming: JianduMemoryListItem[],
): JianduMemoryListItem[] => {
  const byId = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => byId.set(item.id, item));
  return [...byId.values()];
};

export function SettingsJiandu({
  api = jianduMemoryApi,
}: {
  api?: JianduMemoryApiClient;
}) {
  const { t } = useTranslation();
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const activeSessionRef = useRef(currentSessionId);
  activeSessionRef.current = currentSessionId;

  const epochRef = useRef(0);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const preflightRequestRef = useRef(0);
  const mutationRequestRef = useRef(0);

  const [reloadKey, setReloadKey] = useState(0);
  const [context, setContext] = useState<JianduProjectContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<UiError | null>(null);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [appliedStatus, setAppliedStatus] = useState<StatusFilter>("active");
  const [items, setItems] = useState<JianduMemoryListItem[]>([]);
  const [page, setPage] = useState<JianduMemoryPage | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<UiError | null>(null);
  const [detail, setDetail] = useState<JianduMemoryDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<UiError | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [createError, setCreateError] = useState<UiError | null>(null);
  const [mutation, setMutation] = useState<"create" | "archive" | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<JianduMemoryDetail | null>(
    null,
  );
  const [archiveError, setArchiveError] = useState<UiError | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const loadList = useCallback(
    async (
      nextContext: JianduProjectContext,
      nextQuery: string,
      nextStatus: StatusFilter,
      cursor: string | undefined,
      append: boolean,
      epoch: number,
    ): Promise<"ok" | "failed" | "stale"> => {
      const request = ++listRequestRef.current;
      setListLoading(true);
      setListError(null);
      try {
        const result = await api.queryProjectMemories(nextContext, {
          query: nextQuery,
          filters: { status: [nextStatus] },
          ...(cursor ? { cursor } : {}),
        });
        if (epochRef.current !== epoch || listRequestRef.current !== request)
          return "stale";
        setItems((current) =>
          append ? mergeItems(current, result.items) : result.items,
        );
        setPage(result);
        return "ok";
      } catch (error) {
        if (epochRef.current !== epoch || listRequestRef.current !== request)
          return "stale";
        setListError(errorKey(error));
        if (!append) {
          setItems([]);
          setPage(null);
        }
        return "failed";
      } finally {
        if (epochRef.current === epoch && listRequestRef.current === request) {
          setListLoading(false);
        }
      }
    },
    [api],
  );

  const expireEpoch = useCallback((epoch: number) => {
    const currentEpoch = epochRef.current;
    if (currentEpoch === epoch) epochRef.current = currentEpoch + 1;
  }, []);

  useEffect(() => {
    const epoch = ++epochRef.current;
    ++listRequestRef.current;
    ++detailRequestRef.current;
    ++preflightRequestRef.current;
    ++mutationRequestRef.current;
    setContext(null);
    setContextError(null);
    setContextLoading(Boolean(currentSessionId));
    setQuery("");
    setAppliedQuery("");
    setStatusFilter("active");
    setAppliedStatus("active");
    setItems([]);
    setPage(null);
    setListError(null);
    setListLoading(false);
    setDetail(null);
    setDetailLoadingId(null);
    setDetailError(null);
    setCreateOpen(false);
    setDraft(EMPTY_DRAFT);
    setPreflight(null);
    setPreflightLoading(false);
    setCreateError(null);
    setMutation(null);
    setArchiveTarget(null);
    setArchiveError(null);
    setNotice(null);

    if (!currentSessionId) {
      setContextError("context");
      return;
    }

    void api
      .resolveProjectContext(currentSessionId)
      .then((resolved) => {
        if (
          epochRef.current !== epoch ||
          activeSessionRef.current !== currentSessionId
        )
          return;
        setContext(resolved);
        setContextLoading(false);
        void loadList(resolved, "", "active", undefined, false, epoch);
      })
      .catch((error: unknown) => {
        if (
          epochRef.current !== epoch ||
          activeSessionRef.current !== currentSessionId
        )
          return;
        setContextLoading(false);
        setContextError(errorKey(error));
      });

    return () => expireEpoch(epoch);
  }, [api, currentSessionId, expireEpoch, loadList, reloadKey]);

  const invalidateContext = useCallback((failure: UiError) => {
    ++epochRef.current;
    ++listRequestRef.current;
    ++detailRequestRef.current;
    ++preflightRequestRef.current;
    ++mutationRequestRef.current;
    setContext(null);
    setQuery("");
    setAppliedQuery("");
    setStatusFilter("active");
    setAppliedStatus("active");
    setItems([]);
    setPage(null);
    setListLoading(false);
    setListError(null);
    setDetail(null);
    setDetailLoadingId(null);
    setDetailError(null);
    setCreateOpen(false);
    setDraft(EMPTY_DRAFT);
    setPreflight(null);
    setPreflightLoading(false);
    setCreateError(null);
    setMutation(null);
    setArchiveTarget(null);
    setArchiveError(null);
    setNotice(null);
    setContextError(failure);
    setContextLoading(false);
  }, []);

  const reauthorize = useCallback(
    async (expected: JianduProjectContext, epoch: number) => {
      const activeId = activeSessionRef.current;
      if (!activeId || epochRef.current !== epoch) return null;
      try {
        const fresh = await api.resolveProjectContext(activeId);
        if (epochRef.current !== epoch || activeSessionRef.current !== activeId)
          return null;
        if (!sameJianduProjectContext(expected, fresh)) {
          invalidateContext("context");
          return null;
        }
        return fresh;
      } catch (error) {
        if (epochRef.current === epoch) invalidateContext(errorKey(error));
        return null;
      }
    },
    [api, invalidateContext],
  );

  const search = () => {
    if (!context) return;
    const nextQuery = query.trim();
    const nextStatus = statusFilter;
    setAppliedQuery(nextQuery);
    setAppliedStatus(nextStatus);
    setNotice(null);
    void loadList(
      context,
      nextQuery,
      nextStatus,
      undefined,
      false,
      epochRef.current,
    );
  };

  const openDetail = async (item: JianduMemoryListItem) => {
    if (!context) return;
    const request = ++detailRequestRef.current;
    const epoch = epochRef.current;
    setDetail(null);
    setDetailError(null);
    setDetailLoadingId(item.id);
    try {
      const result = await api.getProjectMemory(context, item.id);
      if (epochRef.current !== epoch || detailRequestRef.current !== request)
        return;
      setDetail(result);
    } catch (error) {
      if (epochRef.current === epoch && detailRequestRef.current === request) {
        setDetailError(errorKey(error));
      }
    } finally {
      if (epochRef.current === epoch && detailRequestRef.current === request) {
        setDetailLoadingId(null);
      }
    }
  };

  const closeDetail = () => {
    ++detailRequestRef.current;
    setDetail(null);
    setDetailError(null);
    setDetailLoadingId(null);
    setArchiveTarget(null);
    setArchiveError(null);
  };

  const draftFingerprint = useMemo(() => JSON.stringify(draft), [draft]);
  const updateDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    ++preflightRequestRef.current;
    setDraft((current) => ({ ...current, [key]: value }));
    setPreflight(null);
    setPreflightLoading(false);
    setCreateError(null);
  };

  const openCreate = () => {
    setDraft(EMPTY_DRAFT);
    setPreflight(null);
    setCreateError(null);
    setCreateOpen(true);
  };

  const closeCreate = () => {
    if (mutation === "create") return;
    ++preflightRequestRef.current;
    setCreateOpen(false);
    setDraft(EMPTY_DRAFT);
    setPreflight(null);
    setCreateError(null);
  };

  const runPreflight = async () => {
    if (!context || preflightLoading || mutation) return;
    const input = toCreateInput(draft);
    try {
      normalizeCreateProjectMemoryInput(input);
    } catch (error) {
      setCreateError(errorKey(error));
      return;
    }
    const fingerprint = draftFingerprint;
    const request = ++preflightRequestRef.current;
    const epoch = epochRef.current;
    setPreflightLoading(true);
    setPreflight(null);
    setCreateError(null);
    try {
      const inventory = await api.queryProjectMemories(context, {
        query: "",
        limit: 1,
      });
      if (epochRef.current !== epoch || preflightRequestRef.current !== request)
        return;
      const result =
        inventory.matchedCount === 0
          ? inventory
          : await api.queryProjectMemories(context, {
              query: createLookupQuery(input),
              limit: 5,
            });
      if (epochRef.current !== epoch || preflightRequestRef.current !== request)
        return;
      setPreflight({
        fingerprint,
        items: result.items,
        truncated: result.truncated,
      });
    } catch (error) {
      if (
        epochRef.current === epoch &&
        preflightRequestRef.current === request
      ) {
        setCreateError(errorKey(error));
      }
    } finally {
      if (
        epochRef.current === epoch &&
        preflightRequestRef.current === request
      ) {
        setPreflightLoading(false);
      }
    }
  };

  const createMemory = async () => {
    if (
      !context ||
      mutation ||
      !preflight ||
      preflight.fingerprint !== draftFingerprint
    )
      return;
    const input = toCreateInput(draft);
    try {
      normalizeCreateProjectMemoryInput(input);
    } catch (error) {
      setCreateError(errorKey(error));
      return;
    }
    const epoch = epochRef.current;
    const request = ++mutationRequestRef.current;
    setMutation("create");
    setCreateError(null);
    const fresh = await reauthorize(context, epoch);
    if (
      !fresh ||
      epochRef.current !== epoch ||
      mutationRequestRef.current !== request
    ) {
      if (mutationRequestRef.current === request) setMutation(null);
      return;
    }
    try {
      const created = await api.createProjectMemory(fresh, input);
      if (epochRef.current !== epoch || mutationRequestRef.current !== request)
        return;
      setCreateOpen(false);
      setPreflight(null);
      setNotice({ kind: "created", title: created.title });
      const outcome = await loadList(
        fresh,
        appliedQuery,
        appliedStatus,
        undefined,
        false,
        epoch,
      );
      if (outcome === "failed" && mutationRequestRef.current === request) {
        setNotice({ kind: "createdRefreshFailed", title: created.title });
      }
    } catch (error) {
      if (
        epochRef.current === epoch &&
        mutationRequestRef.current === request
      ) {
        setCreateError(errorKey(error));
      }
    } finally {
      if (
        epochRef.current === epoch &&
        mutationRequestRef.current === request
      ) {
        setMutation(null);
      }
    }
  };

  const archiveMemory = async () => {
    const target = archiveTarget;
    if (!context || !target || mutation) return;
    const epoch = epochRef.current;
    const request = ++mutationRequestRef.current;
    setMutation("archive");
    setArchiveError(null);
    const fresh = await reauthorize(context, epoch);
    if (
      !fresh ||
      epochRef.current !== epoch ||
      mutationRequestRef.current !== request
    ) {
      if (mutationRequestRef.current === request) setMutation(null);
      return;
    }
    try {
      await api.archiveProjectMemory(fresh, target.id);
      if (epochRef.current !== epoch || mutationRequestRef.current !== request)
        return;
      setArchiveTarget(null);
      closeDetail();
      setNotice({ kind: "archived", title: target.title });
      const outcome = await loadList(
        fresh,
        appliedQuery,
        appliedStatus,
        undefined,
        false,
        epoch,
      );
      if (outcome === "failed" && mutationRequestRef.current === request) {
        setNotice({ kind: "archivedRefreshFailed", title: target.title });
      }
    } catch (error) {
      if (
        epochRef.current === epoch &&
        mutationRequestRef.current === request
      ) {
        setArchiveError(errorKey(error));
      }
    } finally {
      if (
        epochRef.current === epoch &&
        mutationRequestRef.current === request
      ) {
        setMutation(null);
      }
    }
  };

  const translatedError = (failure: UiError) =>
    t(`settings.jiandu.errors.${failure}`);
  const typeLabel = (type: JianduMemoryType) =>
    t(`settings.jiandu.types.${type}`);
  const statusLabel = (status: JianduMemoryListItem["status"]) =>
    t(`settings.jiandu.statuses.${status}`);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">
              {t("settings.jiandu.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("settings.jiandu.description")}
            </p>
          </div>
          <Button onClick={openCreate} disabled={!context || contextLoading}>
            {t("settings.jiandu.create.open")}
          </Button>
        </div>
      </header>

      <section
        className="rounded-lg border p-3"
        aria-label={t("settings.jiandu.context.label")}
      >
        <div className="text-xs font-medium text-muted-foreground">
          {t("settings.jiandu.context.label")}
        </div>
        {contextLoading ? (
          <p className="mt-1 text-sm">{t("settings.jiandu.context.loading")}</p>
        ) : context ? (
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("settings.jiandu.context.session")}
              </dt>
              <dd className="break-words font-medium">
                {context.activeSessionTitle}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("settings.jiandu.context.project")}
              </dt>
              <dd className="break-all font-mono text-xs">
                {context.projectId}
              </dd>
            </div>
            {context.activeSessionId !== context.authoritySessionId ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">
                  {t("settings.jiandu.context.rootSession")}
                </dt>
                <dd>{context.authoritySessionTitle}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <div className="mt-2 space-y-2">
            <p role="alert" className="text-sm text-destructive">
              {translatedError(contextError ?? "context")}
            </p>
            {currentSessionId ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                {t("settings.jiandu.context.retry")}
              </Button>
            ) : null}
          </div>
        )}
      </section>

      {notice ? (
        <p
          role="status"
          className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"
        >
          {t(`settings.jiandu.notices.${notice.kind}`, { title: notice.title })}
        </p>
      ) : null}

      {context ? (
        <>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              search();
            }}
          >
            <Input
              aria-label={t("settings.jiandu.search.label")}
              value={query}
              maxLength={JIANDU_MEMORY_LIMITS.queryChars}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("settings.jiandu.search.placeholder")}
            />
            <Select
              value={statusFilter}
              disabled={listLoading}
              onValueChange={(value) => setStatusFilter(value as StatusFilter)}
            >
              <SelectTrigger
                className="w-full sm:w-36"
                aria-label={t("settings.jiandu.search.statusLabel")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[150]">
                <SelectItem value="active">{statusLabel("active")}</SelectItem>
                <SelectItem value="archived">
                  {statusLabel("archived")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={listLoading}>
              {t("settings.jiandu.search.action")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={listLoading}
              onClick={() =>
                void loadList(
                  context,
                  appliedQuery,
                  appliedStatus,
                  undefined,
                  false,
                  epochRef.current,
                )
              }
            >
              {t("settings.jiandu.search.refresh")}
            </Button>
          </form>

          {listError ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
            >
              {translatedError(listError)}
            </p>
          ) : null}

          {page ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                {t("settings.jiandu.list.count", {
                  visible: items.length,
                  matched: page.matchedCount,
                })}
              </span>
              {page.truncated ? (
                <span>{t("settings.jiandu.list.truncated")}</span>
              ) : null}
              {page.remainingCount > 0 ? (
                <span>
                  {t("settings.jiandu.list.remaining", {
                    count: page.remainingCount,
                  })}
                </span>
              ) : null}
            </div>
          ) : null}

          {items.length > 0 ? (
            <ul
              className="space-y-2"
              aria-label={t("settings.jiandu.list.label")}
            >
              {items.map((item) => (
                <li key={item.id} className="rounded-lg border p-3">
                  <button
                    type="button"
                    className="max-w-full break-words text-left text-sm font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    disabled={detailLoadingId === item.id}
                    onClick={() => void openDetail(item)}
                  >
                    {item.title}
                  </button>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant="outline">{typeLabel(item.type)}</Badge>
                    <Badge
                      variant={
                        item.status === "archived" ? "secondary" : "outline"
                      }
                    >
                      {statusLabel(item.status)}
                    </Badge>
                    {item.granularity ? (
                      <Badge variant="outline">{item.granularity}</Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {item.summary}
                  </p>
                </li>
              ))}
            </ul>
          ) : page && !listLoading ? (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">
              {t("settings.jiandu.list.empty")}
            </p>
          ) : null}

          {listLoading ? (
            <p role="status">{t("settings.jiandu.list.loading")}</p>
          ) : null}
          {page?.nextCursor ? (
            <Button
              variant="outline"
              className="w-full"
              disabled={listLoading}
              onClick={() =>
                void loadList(
                  context,
                  appliedQuery,
                  appliedStatus,
                  page.nextCursor,
                  true,
                  epochRef.current,
                )
              }
            >
              {t("settings.jiandu.list.more")}
            </Button>
          ) : null}
        </>
      ) : null}

      <ResponsiveDialog
        open={Boolean(detail || detailLoadingId || detailError)}
        onOpenChange={(open) => (!open ? closeDetail() : null)}
      >
        <ResponsiveDialogContent
          showCloseButton={false}
          className="gap-4 p-5 sm:max-w-2xl"
        >
          <ResponsiveDialogTitle>
            {detail?.title ?? t("settings.jiandu.detail.title")}
          </ResponsiveDialogTitle>
          {detailLoadingId ? (
            <p role="status">{t("settings.jiandu.detail.loading")}</p>
          ) : null}
          {detailError ? (
            <p role="alert" className="text-sm text-destructive">
              {translatedError(detailError)}
            </p>
          ) : null}
          {detail ? (
            <div className="min-h-0 space-y-3 overflow-y-auto">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{typeLabel(detail.type)}</Badge>
                <Badge
                  variant={
                    detail.status === "archived" ? "secondary" : "outline"
                  }
                >
                  {statusLabel(detail.status)}
                </Badge>
              </div>
              {detail.bodyTruncated || detail.retrievalMetadataTruncated ? (
                <p
                  role="status"
                  className="text-xs text-amber-600 dark:text-amber-400"
                >
                  {detail.bodyTruncated
                    ? t("settings.jiandu.detail.bodyTruncated")
                    : t("settings.jiandu.detail.metadataTruncated")}
                </p>
              ) : null}
              <pre className="max-h-[50dvh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-sans text-sm">
                {detail.body}
              </pre>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            {detail && detail.status !== "archived" ? (
              <Button
                variant="destructive"
                onClick={() => {
                  setArchiveError(null);
                  setArchiveTarget(detail);
                }}
              >
                {t("settings.jiandu.archive.open")}
              </Button>
            ) : null}
            <Button variant="outline" onClick={closeDetail}>
              {t("settings.jiandu.detail.close")}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={createOpen}
        onOpenChange={(open) => (!open ? closeCreate() : null)}
      >
        <ResponsiveDialogContent
          showCloseButton={false}
          dismissable={mutation !== "create"}
          className="gap-4 p-5 sm:max-w-2xl"
        >
          <ResponsiveDialogTitle>
            {t("settings.jiandu.create.title")}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t("settings.jiandu.create.description")}
          </ResponsiveDialogDescription>
          <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label htmlFor="jiandu-title">
                {t("settings.jiandu.create.titleLabel")}
              </Label>
              <Input
                id="jiandu-title"
                value={draft.title}
                maxLength={JIANDU_MEMORY_LIMITS.titleChars}
                disabled={Boolean(mutation)}
                onChange={(event) => updateDraft("title", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.jiandu.create.typeLabel")}</Label>
              <Select
                value={draft.type}
                disabled={Boolean(mutation)}
                onValueChange={(value) =>
                  updateDraft("type", value as JianduMemoryType)
                }
              >
                <SelectTrigger
                  className="w-full"
                  aria-label={t("settings.jiandu.create.typeLabel")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[150]">
                  {JIANDU_MEMORY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {typeLabel(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="jiandu-body">
                {t("settings.jiandu.create.bodyLabel")}
              </Label>
              <Textarea
                id="jiandu-body"
                rows={7}
                value={draft.content}
                maxLength={JIANDU_MEMORY_LIMITS.bodyChars}
                disabled={Boolean(mutation)}
                onChange={(event) => updateDraft("content", event.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["tags", "keywords", "entities"] as const).map((field) => (
                <div key={field} className="space-y-1.5">
                  <Label htmlFor={`jiandu-${field}`}>
                    {t(`settings.jiandu.create.${field}Label`)}
                  </Label>
                  <Input
                    id={`jiandu-${field}`}
                    value={draft[field]}
                    disabled={Boolean(mutation)}
                    onChange={(event) => updateDraft(field, event.target.value)}
                    placeholder={t("settings.jiandu.create.csvHint")}
                  />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label>{t("settings.jiandu.create.granularityLabel")}</Label>
                <Select
                  value={draft.granularity || "none"}
                  disabled={Boolean(mutation)}
                  onValueChange={(value) =>
                    updateDraft("granularity", value === "none" ? "" : value)
                  }
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={t("settings.jiandu.create.granularityLabel")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[150]">
                    <SelectItem value="none">
                      {t("settings.jiandu.create.noGranularity")}
                    </SelectItem>
                    {JIANDU_MEMORY_GRANULARITIES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {createError ? (
              <p role="alert" className="text-sm text-destructive">
                {translatedError(createError)}
              </p>
            ) : null}
            {preflight ? (
              <section
                className="rounded-lg border p-3"
                aria-label={t("settings.jiandu.create.matchesLabel")}
              >
                <h3 className="text-sm font-medium">
                  {preflight.items.length > 0
                    ? t("settings.jiandu.create.matches")
                    : t("settings.jiandu.create.noMatches")}
                </h3>
                {preflight.items.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-sm">
                    {preflight.items.map((item) => (
                      <li key={item.id}>
                        {item.title} · {statusLabel(item.status)}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {preflight.truncated ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("settings.jiandu.create.matchesTruncated")}
                  </p>
                ) : null}
              </section>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              disabled={mutation === "create"}
              onClick={closeCreate}
            >
              {t("settings.jiandu.create.close")}
            </Button>
            <Button
              variant="secondary"
              disabled={preflightLoading || Boolean(mutation)}
              onClick={() => void runPreflight()}
            >
              {preflightLoading
                ? t("settings.jiandu.create.lookingUp")
                : t("settings.jiandu.create.lookup")}
            </Button>
            <Button
              disabled={
                mutation === "create" ||
                !preflight ||
                preflight.fingerprint !== draftFingerprint
              }
              onClick={() => void createMemory()}
            >
              {mutation === "create"
                ? t("settings.jiandu.create.creating")
                : t("settings.jiandu.create.confirm")}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open && mutation !== "archive") {
            setArchiveTarget(null);
            setArchiveError(null);
          }
        }}
      >
        <ResponsiveDialogContent
          showCloseButton={false}
          dismissable={mutation !== "archive"}
          className="gap-4 p-5"
        >
          <ResponsiveDialogTitle>
            {t("settings.jiandu.archive.title", {
              title: archiveTarget?.title ?? "",
            })}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t("settings.jiandu.archive.description")}
          </ResponsiveDialogDescription>
          {archiveError ? (
            <p role="alert" className="text-sm text-destructive">
              {translatedError(archiveError)}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={mutation === "archive"}
              onClick={() => {
                setArchiveTarget(null);
                setArchiveError(null);
              }}
            >
              {t("settings.jiandu.archive.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={mutation === "archive"}
              onClick={() => void archiveMemory()}
            >
              {mutation === "archive"
                ? t("settings.jiandu.archive.archiving")
                : t("settings.jiandu.archive.confirm")}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
