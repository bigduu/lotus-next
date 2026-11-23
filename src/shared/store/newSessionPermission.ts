import { bindReactStore } from "./bindReactStore"
import { newSessionPermissionStore } from "./newSessionPermissionState"

export * from "./newSessionPermissionState"
export const useNewSessionPermission = bindReactStore(newSessionPermissionStore)
