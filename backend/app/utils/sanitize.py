import html
import re
from html.parser import HTMLParser
from typing import Any, List

_STRIP = dict.fromkeys(map(ord, "<>`\\"), None)
_STRIP.update({ord("'"): "\u2019", ord('"'): "\u201d"})


def clean_payload(value: Any) -> Any:
    """Neutralises characters that can break out of HTML text, attribute or inline-JS contexts.

    Applied to unauthenticated forms, whose data is later rendered inside the admin portal.
    Apostrophes/quotes become typographic ones so names like O'Brien stay readable.
    """
    if isinstance(value, str):
        return value.translate(_STRIP)
    if isinstance(value, dict):
        return {k: clean_payload(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean_payload(v) for v in value]
    return value


# ---------------------------------------------------------------------------
# Rich-text allow-list (broadcast bodies are emailed as HTML)
# ---------------------------------------------------------------------------
_ALLOWED_TAGS = {"p", "br", "b", "strong", "i", "em", "u", "s", "ul", "ol", "li", "a", "h1", "h2", "h3", "h4",
                 "blockquote", "span", "div", "hr", "table", "thead", "tbody", "tr", "th", "td", "code", "pre"}
_VOID_TAGS = {"br", "hr"}
_DROP_CONTENT = {"script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math"}
_SAFE_URL = re.compile(r"^(https?:|mailto:)", re.IGNORECASE)


class _AllowListParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: List[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in _DROP_CONTENT:
            self.skip_depth += 1
            return
        if self.skip_depth or tag not in _ALLOWED_TAGS:
            return
        if tag == "a":
            href = next((v for k, v in attrs if k == "href" and v), "")
            href = href.strip()
            if _SAFE_URL.match(href):
                self.out.append(f'<a href="{html.escape(href, quote=True)}" rel="noopener noreferrer" target="_blank">')
            else:
                self.out.append("<a>")
            return
        self.out.append(f"<{tag}>")  # every other attribute (on*, style, src...) is dropped

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in _VOID_TAGS and tag in _ALLOWED_TAGS and not self.skip_depth:
            self.out.append(f"</{tag}>")

    def handle_endtag(self, tag):
        if tag in _DROP_CONTENT:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if self.skip_depth or tag not in _ALLOWED_TAGS or tag in _VOID_TAGS:
            return
        self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.skip_depth:
            self.out.append(html.escape(data, quote=False))


def sanitize_rich_text(value: str) -> str:
    """Safe HTML for an email body: allow-listed formatting tags only, links limited to http(s)/mailto.

    Plain text (no tags) keeps its line breaks.
    """
    value = value or ""
    if not re.search(r"<[a-zA-Z/!]", value):
        return html.escape(value, quote=False).replace("\r\n", "\n").replace("\n", "<br>")
    parser = _AllowListParser()
    parser.feed(value)
    parser.close()
    return "".join(parser.out)
