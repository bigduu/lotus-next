import { createContext, type Accessor } from "solid-js"

export const DialogLayerMount = createContext<Accessor<HTMLElement | undefined>>(() => undefined)
