import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cleanMdxTags } from "@/lib/markdown";
import { cn } from "@/lib/utils";

/**
 * Renders an assistant/user message as Markdown.
 * - Handles headings, lists, quotes, tables, links, bold, code (via remark-gfm).
 * - First cleans MDX/JSX tags (<Sequence>/<Step>/{comments}) so they never show raw.
 * - Text colors inherit from the parent so it works on dark (chat) and light (widget).
 */
export function MarkdownMessage({ content, className }: { content: string; className?: string }) {
  const cleaned = useMemo(() => cleanMdxTags(content), [content]);

  return (
    <div className={cn("flex min-w-0 flex-col gap-2 leading-relaxed [word-break:break-word]", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mt-2 text-lg font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-2 text-base font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-1 text-sm font-semibold">{children}</h3>,
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic opacity-90">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-400 underline underline-offset-2 hover:text-violet-300"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-zinc-400/40 pl-3 italic opacity-90">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-white/10" />,
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-xl bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-200 ring-1 ring-inset ring-zinc-800">
              {children}
            </pre>
          ),
          code: ({ className: codeCls, children, ...props }) => {
            const isInline = !codeCls;
            if (isInline) {
              return (
                <code className="rounded bg-zinc-500/15 px-1.5 py-0.5 font-mono text-[0.85em]">
                  {children}
                </code>
              );
            }
            return (
              <code className={codeCls} {...props}>
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-white/10 px-2 py-1 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border border-white/10 px-2 py-1">{children}</td>,
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
