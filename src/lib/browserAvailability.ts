/** Keep the embedded browser off phones even when landscape exceeds the layout breakpoint. */
export function isPhoneBrowser(userAgent: string, mobileHint?: boolean): boolean {
  return mobileHint === true || /\b(?:iPhone|iPod)\b|\bAndroid\b.*\bMobile\b/i.test(userAgent)
}

export function isPhoneDevice(): boolean {
  if (typeof navigator === "undefined") return false
  const mobileHint = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile
  return isPhoneBrowser(navigator.userAgent, mobileHint)
}
