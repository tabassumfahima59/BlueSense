"""Section-based, contextual chunking of the BlueSense markdown documentation.

Each markdown heading starts a new section, so chunks follow the documents' own structure and vary in length.
Every chunk is prefixed with its document title and section path ("Methods > 3. FAO-56 irrigation"), so a chunk
read on its own (by BM25, by the embedding model or by the language model) still says where it comes from.
A section longer than ``MAX_CHARS`` is split at paragraph, then line boundaries (code blocks are kept whole and
a split table repeats its header row); the parts are numbered.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass

# The knowledge base: the documents the Copilot may cite.
DOCS = ("METHODS.md", "DATA_SOURCES.md", "MODEL_CARD.md", "LIMITATIONS.md", "ASSUMPTIONS.md")
MAX_CHARS = 1800

HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
ANCHOR = re.compile(r"\s*\{#[^}]*\}\s*$")
FENCE = re.compile(r"^\s*(```|~~~)")


@dataclass(frozen=True)
class Chunk:
    id: str             # "<file>#<n>", stable for one build of the index
    doc: str            # file name, e.g. "METHODS.md"
    doc_title: str      # the document's H1, e.g. "Methods"
    section: str        # section path below the title ("Introduction" before the first sub-heading)
    text: str           # the section body (or one part of it)

    @property
    def context(self) -> str:
        return f"{self.doc_title} > {self.section}"

    @property
    def contextual_text(self) -> str:
        """What is keyword-indexed and shown to the model: document and section, then the text."""
        return f"Document: {self.doc_title} ({self.doc})\nSection: {self.section}\n\n{self.text}"

    def to_dict(self) -> dict:
        return asdict(self)


def _sections(markdown: str) -> tuple[str, list[tuple[list[str], str]]]:
    """Return (document title, [(heading path below the title, body)]) in document order."""
    title = ""
    stack: list[tuple[int, str]] = []
    sections: list[tuple[list[str], str]] = []
    body: list[str] = []
    in_fence = False

    def flush():
        text = "\n".join(body).strip()
        if text:
            sections.append(([h for _, h in stack], text))
        body.clear()

    for line in markdown.splitlines():
        if FENCE.match(line):
            in_fence = not in_fence
        m = None if in_fence else HEADING.match(line)
        if not m:
            body.append(line)
            continue
        flush()
        level, text = len(m.group(1)), ANCHOR.sub("", m.group(2)).strip()
        if level == 1 and not title:
            title, stack = text, []
            continue
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack.append((level, text))
    flush()
    return title, sections


def _blocks(text: str) -> list[str]:
    """Paragraph blocks separated by blank lines; a fenced code block is one block even if it has blank lines."""
    blocks, cur, in_fence = [], [], False
    for line in text.splitlines():
        if FENCE.match(line):
            in_fence = not in_fence
        if not line.strip() and not in_fence:
            if cur:
                blocks.append("\n".join(cur))
                cur = []
            continue
        cur.append(line)
    if cur:
        blocks.append("\n".join(cur))
    return blocks


def _split_block(block: str, limit: int) -> list[str]:
    """Split an oversized block at line boundaries; a markdown table repeats its header (and separator) row."""
    lines = block.splitlines()
    header: list[str] = []
    if len(lines) > 2 and lines[0].lstrip().startswith("|") and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[1]):
        header, lines = lines[:2], lines[2:]
    out, cur = [], list(header)
    for line in lines:
        if len(cur) > len(header) and len("\n".join([*cur, line])) > limit:
            out.append("\n".join(cur))
            cur = list(header)
        cur.append(line)
    if len(cur) > len(header):
        out.append("\n".join(cur))
    return out


def _pack(text: str, limit: int) -> list[str]:
    if len(text) <= limit:
        return [text]
    pieces: list[str] = []
    for b in _blocks(text):
        pieces.extend(_split_block(b, limit) if len(b) > limit else [b])
    parts, cur = [], ""
    for p in pieces:
        if cur and len(cur) + 2 + len(p) > limit:
            parts.append(cur)
            cur = p
        else:
            cur = f"{cur}\n\n{p}" if cur else p
    if cur:
        parts.append(cur)
    return parts


def chunk_markdown(markdown: str, doc: str, max_chars: int = MAX_CHARS) -> list[Chunk]:
    title, sections = _sections(markdown)
    title = title or doc.rsplit(".", 1)[0]
    chunks: list[Chunk] = []
    for path, body in sections:
        parts = _pack(body, max_chars)
        for i, part in enumerate(parts, 1):
            section = " > ".join(path) or "Introduction"
            if len(parts) > 1:
                section = f"{section} (part {i}/{len(parts)})"
            chunks.append(Chunk(f"{doc}#{len(chunks) + 1}", doc, title, section, part))
    return chunks
