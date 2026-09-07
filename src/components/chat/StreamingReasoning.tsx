import { Reasoning } from "./Reasoning"

/** Live reasoning stays compact until the reader chooses to inspect it. */
export function StreamingReasoning({ text, spaced }: { text: string; spaced?: boolean }) {
  return <Reasoning text={text} active spaced={spaced} />
}
