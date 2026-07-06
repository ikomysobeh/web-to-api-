// Clean up MDX/JSX-style tags the model sometimes emits so they never render as
// raw code. Runs only OUTSIDE fenced code blocks, so real code samples are untouched.

function cleanSegment(text: string): string {
  let out = text;

  // 1. Remove {/* ... */} comments (single or multi-line)
  out = out.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

  // 2. Convert <Step title="A" subtitle="B">body</Step> → a bold titled block
  out = out.replace(
    /<Step\b([^>]*)>([\s\S]*?)<\/Step>/gi,
    (_m, attrs: string, body: string) => {
      const title = (attrs.match(/title="([^"]*)"/i) || [])[1] || "";
      const subtitle = (attrs.match(/subtitle="([^"]*)"/i) || [])[1] || "";
      let header = "";
      if (title) header = `**${title}**`;
      if (subtitle) header += header ? ` — _${subtitle}_` : `_${subtitle}_`;
      return `\n\n${header}\n\n${body.trim()}\n`;
    },
  );

  // 3. Drop any remaining capitalized JSX component tags (<Sequence>, </Sequence>, etc.)
  out = out.replace(/<\/?[A-Z][A-Za-z0-9]*\b[^>]*>/g, "");

  return out;
}

/**
 * Sanitize a model answer: strip MDX comments and custom component tags,
 * converting <Step> blocks into Markdown — but leave fenced code blocks alone.
 */
export function cleanMdxTags(content: string): string {
  if (!content) return content;
  // Split on fenced code blocks so we never touch code samples.
  const parts = content.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part) => (part.startsWith("```") ? part : cleanSegment(part)))
    .join("");
}
