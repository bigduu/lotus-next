import { expect, it } from "vitest"
import { artifactDownloadName } from "./artifactDownload"

it.each([
  ["image/png", "artifact://hash", "png"],
  ["application/pdf; charset=binary", "artifact://wrong.txt", "pdf"],
  ["application/zip", "artifact://hash", "zip"],
  ["application/octet-stream", "file:///results/program.exe?download=1", "exe"],
  ["", "file:///results/report.docx#artifact", "docx"],
  ["text/plain", "artifact://hash", "txt"],
  ["application/octet-stream", "artifact://hash", ""],
])("preserves artifact format %s from %s", (mediaType, uri, extension) => {
  expect(artifactDownloadName("a".repeat(64), uri, mediaType)).toBe("work-result-aaaaaaaa" + (extension ? "." + extension : ""))
})
it("never uses an artifact path as the download filename", () => {
  expect(artifactDownloadName("b".repeat(64), "../../private/report.PDF?token=redacted", ""))
    .toBe("work-result-bbbbbbbb.pdf")
})
