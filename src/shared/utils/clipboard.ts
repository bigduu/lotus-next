/**
 * Unified clipboard helper for both browser and desktop webview environments.
 *
 * Preferred path: navigator.clipboard.writeText
 * Fallback path: document.execCommand("copy")
 */

const copyWithNavigatorClipboard = async (text: string): Promise<void> => {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    throw new Error("navigator.clipboard.writeText is unavailable");
  }
  await navigator.clipboard.writeText(text);
};

const copyWithExecCommand = (text: string): void => {
  if (typeof document === "undefined") {
    throw new Error("document is unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  const previousFocus = document.activeElement;
  const selection = document.getSelection();
  const ranges = Array.from({ length: selection?.rangeCount ?? 0 }, (_, index) => selection!.getRangeAt(index).cloneRange());
  const anchor = selection?.anchorNode;
  const focus = selection?.focusNode;
  const backwards = ranges.length === 1 && anchor === ranges[0].endContainer && selection?.anchorOffset === ranges[0].endOffset;
  const selectionEnds = () => [selection?.anchorNode, selection?.anchorOffset, selection?.focusNode, selection?.focusOffset];
  let ownedSelection: ReturnType<typeof selectionEnds> | undefined;
  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    ownedSelection = selectionEnds();
    if (!document.execCommand("copy")) {
      throw new Error("document.execCommand('copy') returned false");
    }
  } finally {
    // Only undo this synchronous fallback's focus change, never a newer one.
    const currentSelection = selectionEnds();
    const selectionUntouched = ownedSelection?.every((value, index) => value === currentSelection[index]) ?? true;
    const restoreFocus = document.activeElement === textarea && selectionUntouched;
    const restoreSelection = restoreFocus && ownedSelection
      && anchor?.isConnected && focus?.isConnected && anchor.ownerDocument === document && focus.ownerDocument === document;
    textarea.remove();
    const releasedSelection = selectionEnds();
    if (restoreFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
    if (restoreSelection && selection && document.activeElement === previousFocus
      && (selection.isCollapsed || selectionEnds().every((value, index) => value === releasedSelection[index]))
      && ranges.every((range) => range.startContainer.isConnected && range.endContainer.isConnected)) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
      if (backwards) selection.setBaseAndExtent(ranges[0].endContainer, ranges[0].endOffset, ranges[0].startContainer, ranges[0].startOffset);
    }
  }
};

export const copyText = async (text: string): Promise<void> => {
  try {
    await copyWithNavigatorClipboard(text);
    return;
  } catch (navigatorError) {
    try {
      copyWithExecCommand(text);
      return;
    } catch (fallbackError) {
      const navigatorMessage =
        navigatorError instanceof Error ? navigatorError.message : String(navigatorError);
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(
        `Clipboard copy failed: navigator(${navigatorMessage}); fallback(${fallbackMessage})`,
      );
    }
  }
};
