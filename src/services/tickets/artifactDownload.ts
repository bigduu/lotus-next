// Keep filenames local and bounded; only the format comes from artifact metadata.
export function artifactDownloadName(hash: string, uri: string, mediaType: string) {
  const extensions: Record<string, string> = {
    "text/plain": "txt", "text/markdown": "md", "text/csv": "csv", "application/json": "json",
    "application/pdf": "pdf", "application/zip": "zip", "application/gzip": "gz",
    "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
    "image/svg+xml": "svg", "image/avif": "avif", "audio/mpeg": "mp3", "video/mp4": "mp4",
  }
  const extension = extensions[mediaType.split(";")[0].trim().toLowerCase()]
    ?? uri.split(/[?#]/, 1)[0].match(/\.([a-z0-9]{1,16})$/i)?.[1].toLowerCase()
  return "work-result-" + hash.slice(0, 8) + (extension ? "." + extension : "")
}
