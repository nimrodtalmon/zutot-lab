import MarkdownIt from "markdown-it";
// @ts-expect-error - no types
import footnote from "markdown-it-footnote";
// @ts-expect-error - no types
import taskLists from "markdown-it-task-lists";
import DOMPurify from "dompurify";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
})
  .use(footnote)
  .use(taskLists);

// Make all links open in a new tab and add rel=noopener.
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options);
  };
md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(src: string): string {
  return DOMPurify.sanitize(md.render(src || ""));
}

export function renderMarkdownDemoted(src: string): string {
  const tokens = md.parse(src || "", {});
  for (const tk of tokens) {
    if (tk.type === "heading_open" || tk.type === "heading_close") {
      const level = parseInt(tk.tag.slice(1), 10);
      const newLevel = Math.min(6, level + 1);
      tk.tag = "h" + newLevel;
    }
  }
  const html = md.renderer.render(tokens, md.options, {});
  return DOMPurify.sanitize(html);
}
