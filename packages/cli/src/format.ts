import { marked, type MarkedExtension } from 'marked';
import { markedTerminal } from 'marked-terminal';

marked.use(markedTerminal() as MarkedExtension);

export function formatMarkdown(text: string): string {
  return marked.parse(text) as string;
}
