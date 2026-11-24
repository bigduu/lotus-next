import { Check } from "@lucide/solid"
import { createUniqueId, For, Show, type Accessor } from "solid-js"
import type { FabricNode, SshAuth } from "@services/config/SettingsService"
import { cn } from "@/lib/utils"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogTitle } from "../../ui/responsive-dialog"
import { Select } from "../../ui/select"
import { Switch } from "../../ui/switch"
import { Textarea } from "../../ui/textarea"
import type { ClusterFabric } from "./createClusterFabric"
import type { NodeForm } from "./nodeForm"

export function placementLabel(node: FabricNode, text: ClusterFabric["text"]) {
  const placement = node.placement
  return placement.type === "ssh" ? `${placement.username}@${placement.host}:${placement.port}` : text("local_8a94c4a1")
}

function TextField(props: {
  label: string
  value: string
  update: (value: string) => void
  placeholder?: string
  disabled?: boolean
  password?: boolean
  numeric?: boolean
  inputRef?: (element: HTMLInputElement) => void
}) {
  const id = createUniqueId()
  return <div class="space-y-1">
    <Label for={id} class="text-xs">{props.label}</Label>
    <Input id={id} ref={(element) => props.inputRef?.(element)} value={props.value} placeholder={props.placeholder} disabled={props.disabled}
      type={props.password ? "password" : "text"} autocomplete={props.password ? "new-password" : undefined}
      inputmode={props.numeric ? "numeric" : undefined} onInput={(event) => props.update(event.currentTarget.value)} />
  </div>
}

function focusInitialField(event: Event, field: HTMLInputElement | undefined) {
  event.preventDefault()
  // A modal's asynchronous focus setup must not steal focus from a field
  // the user has already entered.
  if (field?.isConnected && !field.closest('[role="dialog"]')?.contains(document.activeElement)) field.focus()
}

function SshFields(props: { fabric: ClusterFabric; form: Accessor<NodeForm>; auth: Accessor<SshAuth | undefined>; disabled: boolean }) {
  const { text, setNodeField } = props.fabric
  const form = props.form
  const keyId = createUniqueId()
  return <>
    <div class="grid grid-cols-[1fr_6rem] gap-2">
      <TextField label={text("host_e87d9f23")} value={form().host} placeholder="10.0.0.5"
        disabled={props.disabled} update={(value) => setNodeField("host", value)} />
      <TextField label={text("port_e71ac32b")} value={form().port} placeholder="22" numeric
        disabled={props.disabled} update={(value) => setNodeField("port", value)} />
    </div>
    <TextField label={text("username_1a3f0617")} value={form().username} placeholder="deploy"
      disabled={props.disabled} update={(value) => setNodeField("username", value)} />
    <div class="space-y-1">
      <p class="text-xs">{text("authentication_d1ff8f98")}</p>
      <Select class="w-full" label={text("authentication_d1ff8f98")} value={form().authMethod} disabled={props.disabled}
        options={[
          { value: "password", label: text("password_a621ab60") },
          { value: "private_key", label: text("private_key_3ffe935f") },
          { value: "system_ssh_config", label: text("use_local_ssh_configuration_0acb0e3d") },
        ]}
        onValueChange={(value) => {
          if (value === "password" || value === "private_key" || value === "system_ssh_config") setNodeField("authMethod", value)
        }} />
    </div>
    <Show when={form().authMethod === "password"}>
      <TextField label={text("password_a621ab60")} value={form().password} password disabled={props.disabled}
        placeholder={props.auth()?.method === "password" ? text("leave_blank_to_keep_the_existing_password_66c2200e") : undefined}
        update={(value) => setNodeField("password", value)} />
    </Show>
    <Show when={form().authMethod === "private_key"}>
      <TextField label={text("private_key_file_path_local_4f44a132")} value={form().privateKeyPath} disabled={props.disabled}
        placeholder="~/.ssh/id_ed25519" update={(value) => setNodeField("privateKeyPath", value)} />
      <div class="space-y-1">
        <Label for={keyId} class="text-xs">{text("or_paste_a_private_key_pem_5e7cf830")}</Label>
        <Textarea id={keyId} class="min-h-16 resize-y border border-input font-mono text-xs"
          value={form().privateKey} disabled={props.disabled} autocomplete="off" spellcheck={false}
          placeholder={props.auth()?.method === "private_key"
            ? text("leave_blank_to_keep_the_existing_private_key_7f685d0b")
            : "-----BEGIN OPENSSH PRIVATE KEY-----"}
          onInput={(event) => setNodeField("privateKey", event.currentTarget.value)} />
      </div>
      <TextField label={text("private_key_passphrase_optional_8138fad9")} value={form().passphrase} password
        disabled={props.disabled} placeholder={props.auth()?.method === "private_key"
          ? text("leave_blank_to_keep_the_existing_passphrase_a50f11c8") : undefined}
        update={(value) => setNodeField("passphrase", value)} />
    </Show>
  </>
}

function DeployFields(props: { fabric: ClusterFabric; form: Accessor<NodeForm>; disabled: boolean }) {
  const { text, setNodeField } = props.fabric
  const form = props.form
  return <div class="space-y-2.5 rounded-lg border bg-muted/30 p-3">
    <div class="text-xs font-medium text-muted-foreground">{text("deployment_settings_ccbf90f5")}</div>
    <TextField label={text("artifact_path_bamboo_binary_to_upload_a8a61a77")} value={form().artifactPath}
      disabled={props.disabled} placeholder="/path/to/bamboo-linux-x64" update={(value) => setNodeField("artifactPath", value)} />
    <div class="grid grid-cols-2 gap-2">
      <TextField label={text("remote_directory_1cfa6840")} value={form().remoteDir} disabled={props.disabled}
        placeholder="~/.bamboo-worker" update={(value) => setNodeField("remoteDir", value)} />
      <TextField label={text("default_role_8a2a6551")} value={form().defaultRole} disabled={props.disabled}
        placeholder="worker" update={(value) => setNodeField("defaultRole", value)} />
    </div>
    <div class="grid grid-cols-2 gap-2">
      <TextField label={text("model_c98e118e")} value={form().model} disabled={props.disabled}
        placeholder={text("default_844b8cc8")} update={(value) => setNodeField("model", value)} />
      <TextField label={text("working_directory_3db7b06b")} value={form().workspace} disabled={props.disabled}
        placeholder={text("default_844b8cc8")} update={(value) => setNodeField("workspace", value)} />
    </div>
    <div class="flex items-center justify-between gap-2">
      <div>
        <div class="text-xs font-medium">{text("automatic_recovery_d4670a4c")}</div>
        <p class="text-xs text-muted-foreground">{text("redeploy_automatically_when_health_checks_detect_a_disc_46daaed1")}</p>
      </div>
      <Switch checked={form().autoRecover} disabled={props.disabled} aria-label={text("automatic_recovery_d4670a4c")}
        onCheckedChange={(value) => setNodeField("autoRecover", value)} />
    </div>
  </div>
}

export function NodeDialog(props: { fabric: ClusterFabric }) {
  const c = props.fabric
  const { text, nodeEditor, setNodeField } = c
  const busy = () => c.operation()?.kind === "save-node"
  let initial: HTMLInputElement | undefined
  return <ResponsiveDialog open={!!nodeEditor()} onOpenChange={(open) => { if (!open) c.closeNode() }}>
    <ResponsiveDialogContent class="p-5 sm:max-w-lg" dismissable={!busy()}
      onOpenAutoFocus={(event: Event) => focusInitialField(event, initial)}>
      <Show when={nodeEditor()}>{(editor) => {
        const form = () => editor().form
        const originalAuth = () => {
          const target = editor().original?.placement
          return target?.type === "ssh" ? target.auth : undefined
        }
        return <>
          <ResponsiveDialogTitle>{text(editor().original ? "edit_node_eca9fae8" : "add_node_09da9abd")}</ResponsiveDialogTitle>
          <div class="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <TextField label={text("name_d44e9b3d")} value={form().label} placeholder="gpu-1" disabled={busy()}
              inputRef={(element) => { initial = element }}
              update={(value) => setNodeField("label", value)} />
            <div class="grid grid-cols-2 gap-2">
              <div class="space-y-1">
                <p class="text-xs">{text("deployment_location_9d554c49")}</p>
                <Select class="w-full" label={text("deployment_location_9d554c49")} value={form().placementType} disabled={busy()}
                  options={[
                    { value: "ssh", label: text("ssh_remote_563675ae") },
                    { value: "local", label: text("local_8a94c4a1") },
                  ]}
                  onValueChange={(value) => {
                    if (value === "local" || value === "ssh") setNodeField("placementType", value)
                  }} />
              </div>
              <div class="space-y-1">
                <p class="text-xs">{text("trust_level_ca9df95a")}</p>
                <Select class="w-full" label={text("trust_level_ca9df95a")} value={form().trustLevel} disabled={busy()}
                  options={[
                    { value: "trusted", label: text("trusted_8627bad4") },
                    { value: "untrusted", label: text("untrusted_1ddc3b8a") },
                  ]}
                  onValueChange={(value) => {
                    if (value === "trusted" || value === "untrusted") setNodeField("trustLevel", value)
                  }} />
              </div>
            </div>
            <Show when={form().placementType === "ssh"}>
              <SshFields fabric={c} form={form} auth={originalAuth} disabled={busy()} />
            </Show>
            <DeployFields fabric={c} form={form} disabled={busy()} />
            <div class="flex items-center justify-between gap-2">
              <div class="text-xs font-medium">{text("enabled_f4f0ead1")}</div>
              <Switch checked={form().enabled} disabled={busy()} aria-label={text("enable_node_b7e7cd5a")}
                onCheckedChange={(checked) => setNodeField("enabled", checked)} />
            </div>
          </div>
          <Show when={editor().error}><p role="alert" class="mt-2 text-xs text-destructive">{editor().error}</p></Show>
          <div class="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy()} onClick={c.closeNode}>{text("cancel_2cd0f3be")}</Button>
            <Button type="button" disabled={busy()} onClick={() => void c.saveNode()}>
              {text(busy() ? "saving_ff509c9b" : "save_a3030bf8")}
            </Button>
          </div>
        </>
      }}</Show>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}

export function ClusterDialog(props: { fabric: ClusterFabric }) {
  const c = props.fabric
  const { text, clusterEditor } = c
  const busy = () => c.operation()?.kind === "save-cluster"
  let nameField: HTMLInputElement | undefined
  let descriptionField: HTMLInputElement | undefined
  return <ResponsiveDialog open={!!clusterEditor()} onOpenChange={(open) => { if (!open) c.closeCluster() }}>
    <ResponsiveDialogContent class="p-5" dismissable={!busy()}
      onOpenAutoFocus={(event: Event) => focusInitialField(event, nameField?.disabled ? descriptionField : nameField)}>
      <Show when={clusterEditor()}>{(editor) => <>
        <ResponsiveDialogTitle>{text(editor().originalName ? "edit_cluster_28890c2b" : "add_cluster_0a87eec0")}</ResponsiveDialogTitle>
        <div class="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <TextField label={text("name_d44e9b3d")} value={editor().name} placeholder="gpu-pool"
            disabled={!!editor().originalName || busy()} inputRef={(element) => { nameField = element }}
            update={(value) => c.setClusterField("name", value)} />
          <TextField label={text("description_optional_8b29dbed")} value={editor().description}
            placeholder={text("purpose_0bef9631")} disabled={busy()} inputRef={(element) => { descriptionField = element }}
            update={(value) => c.setClusterField("description", value)} />
          <div class="space-y-1">
            <div class="text-xs">{text("member_nodes_658ff86e")}</div>
            <Show when={c.nodes().length} fallback={<p class="text-xs text-muted-foreground">{text("no_nodes_yet_add_a_node_first_d769d2c5")}</p>}>
              <div class="space-y-1.5">
                <For each={c.nodes()} keyed={(node) => node.id}>{(node) => {
                  const checked = () => editor().members.includes(node().id)
                  return <button type="button" disabled={busy()} aria-pressed={checked() ? "true" : "false"} onClick={() => c.toggleMember(node().id)}
                    class={cn("flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
                      checked() ? "border-primary/50 bg-primary/5" : "hover:bg-accent/50")}>
                    <span class={cn("flex size-4 shrink-0 items-center justify-center rounded border",
                      checked() ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                      <Show when={checked()}><Check class="size-3" /></Show>
                    </span>
                    <span class="min-w-0 flex-1 truncate">{node().label}</span>
                    <span class="max-w-[55%] truncate font-mono text-xs text-muted-foreground">{placementLabel(node(), text)}</span>
                  </button>
                }}</For>
              </div>
            </Show>
          </div>
        </div>
        <Show when={editor().error}><p role="alert" class="mt-2 text-xs text-destructive">{editor().error}</p></Show>
        <div class="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy()} onClick={c.closeCluster}>{text("cancel_2cd0f3be")}</Button>
          <Button type="button" disabled={busy()} onClick={() => void c.saveCluster()}>
            {text(busy() ? "saving_ff509c9b" : "save_a3030bf8")}
          </Button>
        </div>
      </>}</Show>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}

export function NodeLogsDialog(props: { fabric: ClusterFabric }) {
  const { text, logs, closeLogs, readLogs } = props.fabric
  return <ResponsiveDialog open={!!logs()} onOpenChange={(open) => { if (!open) closeLogs() }}>
    <ResponsiveDialogContent class="p-5 sm:max-w-2xl">
      <Show when={logs()}>{(entry) => <>
        <ResponsiveDialogTitle>{text("logs_8a81380a")} {entry().label}</ResponsiveDialogTitle>
        <div class="mt-3 max-h-[50vh] min-h-24 flex-1 overflow-auto rounded-md border bg-muted/30 p-2">
          <Show when={!entry().loading} fallback={<p class="text-xs text-muted-foreground">{text("loading_4927a53b")}</p>}>
            <pre class="font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{entry().content}</pre>
          </Show>
        </div>
        <div class="mt-3 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={closeLogs}>{text("close_3fd47edc")}</Button>
          <Button type="button" disabled={entry().loading} onClick={() => void readLogs(entry())}>{text("refresh_aee88743")}</Button>
        </div>
      </>}</Show>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}
