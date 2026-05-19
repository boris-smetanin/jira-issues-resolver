import adfToMd from 'adf-to-md';
import type { AdfDoc } from '../jira/jira.client.js';

// adf-to-md exports a singleton with a `.convert()` method that returns
// { result: string, warnings?: string[] }. We collapse it to just the
// markdown string and a sentinel for empty/missing input.
export function adfToMarkdown(doc: AdfDoc | null | undefined): string {
  if (!doc) return '';
  try {
    const out = (adfToMd as { convert: (d: AdfDoc) => { result: string } }).convert(doc);
    return out.result.trim();
  } catch (err) {
    // ADF can occasionally include node types the library doesn't recognise.
    // Falling back to a raw JSON dump beats throwing — the agent still has
    // some signal to work with.
    return `[adf-to-md failed: ${err instanceof Error ? err.message : String(err)}]\n\n\`\`\`json\n${JSON.stringify(doc, null, 2)}\n\`\`\``;
  }
}
