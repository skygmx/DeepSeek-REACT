import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import { Marked, Renderer, type Tokens } from 'marked'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('jsx', javascript)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('plaintext', plaintext)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('tsx', typescript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('vue', xml)

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll('`', '&#96;')
}

function isSafeUrl(value: string) {
  try {
    const url = new URL(value, window.location.origin)
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)
  } catch {
    return false
  }
}

const renderer = new Renderer()

renderer.code = ({ text, lang }: Tokens.Code) => {
  const language = lang?.trim()
  const highlighted =
    language && hljs.getLanguage(language)
      ? hljs.highlight(text, { language }).value
      : hljs.highlightAuto(text).value

  const className = language
    ? `hljs language-${escapeAttribute(language)}`
    : 'hljs'

  return `<pre><code class="${className}">${highlighted}</code></pre>`
}

renderer.link = function ({ href, title, tokens }: Tokens.Link) {
  const label = this.parser.parseInline(tokens)
  if (!isSafeUrl(href)) return label

  const safeTitle = title ? ` title="${escapeAttribute(title)}"` : ''
  return `<a href="${escapeAttribute(href)}"${safeTitle} target="_blank" rel="noreferrer">${label}</a>`
}

const markdownParser = new Marked({
  breaks: true,
  gfm: true,
  renderer,
})

export function renderMarkdown(content: string) {
  if (!content) return '<div>思考中...</div>'

  return markdownParser.parse(escapeHtml(content), { async: false })
}
