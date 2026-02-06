import { marked, type MarkedExtension } from 'marked';
import { markedTerminal } from 'marked-terminal';

marked.use(markedTerminal() as MarkedExtension);

export function formatMarkdown(text: string): string {
  return marked.parse(text) as string;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
