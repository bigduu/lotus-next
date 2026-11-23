import { createSignal } from "solid-js"

import { Badge } from "./badge"
import { Button } from "./button"
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog"
import { Input } from "./input"
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "./popover"
import { Select, type SelectOption } from "./select"

const privacyOptions: SelectOption[] = [
  { value: "private", label: "Private" },
  { value: "shared", label: "Shared" },
  { value: "public", label: "Public", disabled: true },
]

export function UiPrimitivesPreview() {
  const [visibility, setVisibility] = createSignal("private")

  return (
    <Dialog>
      <DialogTrigger as={Button} variant="outline">Open preferences dialog</DialogTrigger>
      <DialogContent responsive>
        <div class="grid gap-4 p-6">
          <DialogTitle>Workspace preferences</DialogTitle>
          <DialogDescription>Choose how this workspace is listed.</DialogDescription>
          <label class="grid gap-2 text-sm">
            Workspace name
            <Input value="My workspace" />
          </label>
          <div class="flex items-center gap-2">
            <Select label="Workspace visibility" options={privacyOptions} value={visibility()} onValueChange={setVisibility} />
            <Badge variant="secondary" role="status">
              {privacyOptions.find((option) => option.value === visibility())?.label}
            </Badge>
          </div>
          <Popover>
            <PopoverTrigger as={Button} variant="outline">Sharing details</PopoverTrigger>
            <PopoverContent class="grid gap-3" aria-label="Workspace sharing">
              <label class="grid gap-2 text-sm">
                Sharing note
                <Input />
              </label>
              <PopoverClose as={Button} variant="secondary" aria-label="Done">Done</PopoverClose>
            </PopoverContent>
          </Popover>
        </div>
      </DialogContent>
    </Dialog>
  )
}
