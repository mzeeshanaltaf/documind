/**
 * remark plugin: splits text nodes on citation markers ("[3]", "[1, 3]") into
 * `citation` nodes rendered as <sup data-cite="3">. Code spans are separate node
 * types, so markers inside code stay literal. Same pattern as api/app/agents/citations.py.
 */

const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
};

function citationNode(n: number): MdNode {
  return {
    type: "citation",
    data: {
      hName: "sup",
      hProperties: { dataCite: String(n) },
      hChildren: [{ type: "text", value: String(n) }],
    },
  };
}

function splitText(value: string): MdNode[] | null {
  MARKER.lastIndex = 0;
  if (!MARKER.test(value)) return null;
  MARKER.lastIndex = 0;
  const parts: MdNode[] = [];
  let last = 0;
  for (const match of value.matchAll(MARKER)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ type: "text", value: value.slice(last, start) });
    for (const n of match[1].split(",")) parts.push(citationNode(Number(n.trim())));
    last = start + match[0].length;
  }
  if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
  return parts;
}

function walk(node: MdNode) {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value) {
      next.push(...(splitText(child.value) ?? [child]));
    } else {
      walk(child);
      next.push(child);
    }
  }
  node.children = next;
}

export function remarkCitations() {
  return (tree: MdNode) => walk(tree);
}
