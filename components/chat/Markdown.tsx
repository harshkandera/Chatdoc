"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
}

function CodeBlock({
  language,
  children,
}: {
  language: string | undefined;
  children: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-4">
      <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleCopy}
          className="h-7 w-7 bg-neutral-700/80 hover:bg-neutral-600 text-neutral-300"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-green-400" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </Button>
      </div>
      <div className="rounded-lg overflow-hidden border border-white/[0.08]">
        {language && (
          <div className="px-4 py-2 bg-neutral-900 border-b border-white/[0.08] text-xs text-neutral-400">
            {language}
          </div>
        )}
        <SyntaxHighlighter
          language={language || "text"}
          style={oneDark}
          customStyle={{
            margin: 0,
            padding: "1rem",
            background: "#1a1a1a",
            fontSize: "0.875rem",
          }}
        >
          {children}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={cn("prose prose-invert max-w-none", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headings
          h1: ({ children }) => (
            <h1 className="text-xl font-bold text-white mt-6 mb-3">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold text-white mt-5 mb-2">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold text-white mt-4 mb-2">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm font-semibold text-white mt-3 mb-1">
              {children}
            </h4>
          ),

          // Paragraphs
          p: ({ children }) => (
            <p className="text-neutral-300 leading-relaxed mb-3">{children}</p>
          ),

          // Lists
          ul: ({ children }) => (
            <ul className="list-disc list-inside text-neutral-300 space-y-1 mb-3 ml-2">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside text-neutral-300 space-y-1 mb-3 ml-2">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-neutral-300">{children}</li>
          ),

          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
            >
              {children}
            </a>
          ),

          // Inline code
          code: ({ className, children }) => {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !match && !className;

            if (isInline) {
              return (
                <code className="px-1.5 py-0.5 bg-neutral-800 text-neutral-200 rounded text-sm font-mono">
                  {children}
                </code>
              );
            }

            return (
              <CodeBlock language={match?.[1]}>
                {String(children).replace(/\n$/, "")}
              </CodeBlock>
            );
          },

          // Code block wrapper
          pre: ({ children }) => <>{children}</>,

          // Blockquote
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-neutral-600 pl-4 py-1 my-3 text-neutral-400 italic">
              {children}
            </blockquote>
          ),

          // Horizontal rule
          hr: () => <hr className="border-neutral-700 my-4" />,

          // Strong/Bold
          strong: ({ children }) => (
            <strong className="font-semibold text-white">{children}</strong>
          ),

          // Emphasis/Italic
          em: ({ children }) => (
            <em className="italic text-neutral-200">{children}</em>
          ),
          // Images
          img: ({ src, alt }) => (
            <img
              src={src}
              alt={alt}
              className="my-4 max-w-full h-auto rounded-lg border border-white/[0.08] max-h-96"
            />
          ),
          // Tables
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto border border-white/[0.08] rounded-lg">
              <table className="w-full text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-white/[0.02] border-b border-white/[0.08]">
              {children}
            </thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-white/[0.04] last:border-0">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="text-left px-4 py-3 text-neutral-400 font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-3 text-neutral-300">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
