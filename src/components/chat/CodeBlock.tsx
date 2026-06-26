import { PrismAsyncLight as SyntaxHighlighter } from "react-syntax-highlighter"
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark"

/**
 * The Prism highlighter is the single heaviest dependency (~650KB). It lives in
 * its own module so it is lazy-loaded only when a fenced code block actually
 * renders — most messages have none, so it stays out of first paint entirely.
 */
export default function CodeBlock({ language, value }: { language: string; value: string }) {
  return (
    <SyntaxHighlighter
      language={language}
      style={oneDark}
      PreTag="div"
      customStyle={{
        margin: 0,
        background: "transparent",
        padding: "0.75rem",
        // Wrap long lines (file paths, signed URLs) instead of horizontal
        // scrolling — a scrollbar was overlapping/clipping the content.
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflowWrap: "anywhere",
      }}
      wrapLongLines
      codeTagProps={{ style: { fontSize: "inherit", whiteSpace: "pre-wrap" } }}
    >
      {value}
    </SyntaxHighlighter>
  )
}
