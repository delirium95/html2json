# Dependency-free `html2json`

This repository contains my solution to Jito's Software Development Intern
test task. `html2json(htmlText)` converts a complete HTML document or a fragment
into a JSON-serializable syntax tree without using a browser DOM API, a DOM
parser, or a third-party dependency.

The supplied [`index.html`](index.html) remains the browser UI. Enter HTML and
press **Convert to JSON**, or use either example button.

## Running it

No installation is required for the browser demo. Open `index.html` in a
browser.

The function is also exported for Node.js:

```js
const html2json = require("./html2json");

const result = html2json('<p class="lead">Hello <em>world</em>!</p>');
console.log(JSON.stringify(result, null, 2));
```

Run the automated tests with Node.js 18 or newer:

```sh
npm test
```

## JSON format

Every result has one document root and an ordered `children` array:

```json
{
  "type": "document",
  "children": [
    {
      "type": "element",
      "tagName": "p",
      "attributes": [
        { "name": "class", "value": "lead" },
        { "name": "hidden", "value": null }
      ],
      "children": [
        { "type": "text", "value": "Hello " },
        {
          "type": "element",
          "tagName": "em",
          "attributes": [],
          "children": [{ "type": "text", "value": "world" }]
        },
        { "type": "text", "value": "!" }
      ]
    }
  ]
}
```

Supported node shapes are:

- `document`: the stable root for documents and fragments.
- `element`: source-spelled `tagName`, ordered `attributes`, and ordered
  `children`.
- `text` and `comment`: their contents in `value`.
- `doctype`: parsed `name`, `publicId`, and `systemId`.
- `cdata`, `declaration`, and `processingInstruction`: useful for foreign or
  XML-like content that can occur in real inputs.

Attributes are an array rather than an object for three reasons: source order
is retained, duplicate attributes do not overwrite each other, and a boolean
attribute (`value: null`) remains distinguishable from an explicitly empty one
(`value: ""`). Mixed content is represented correctly because text and element
nodes share the same ordered `children` array.

Text and attribute values deliberately retain character references exactly as
written. For example, `&copy;`, `&#169;`, and `©` remain distinguishable. This
makes the result source-faithful and avoids silently changing data during a
structural conversion.

## Parser behavior

The implementation is a custom, state-aware tokenizer plus an iterative tree
builder. It includes handling for:

- quoted, unquoted, empty, boolean, and duplicate attributes;
- comments, doctypes with public/system identifiers, declarations, CDATA, and
  processing instructions;
- raw-text and escapable raw-text elements such as `script`, `style`, `title`,
  and `textarea`;
- HTML void elements;
- common optional end tags (`p`, `li`, `dt`/`dd`, headings, options, and table
  rows/cells/sections);
- case-insensitive HTML end-tag matching while retaining source spelling;
- self-closing foreign content in SVG and MathML, including HTML integration
  points;
- complete documents, fragments, whitespace-only input, large text, and deeply
  nested input.

The main parsing loop always advances its cursor and uses an explicit stack, so
truncated tags and deep nesting cannot cause infinite loops or recursive stack
overflows. Invalid or incomplete markup is handled on a best-effort basis. The
public function also has a final safety boundary: if an unforeseen internal
error occurs, it returns the original input as a text node instead of throwing.
Values other than strings are safely converted, with `null` and `undefined`
treated as empty input.

This is intentionally a source-oriented syntax tree, not a reimplementation of
the browser DOM. It does not invent omitted `html`, `head`, or `body` nodes, and
it does not apply browser-only error-correction algorithms such as table foster
parenting or the active-formatting adoption-agency algorithm. Explicit source
structure and the documented optional-end-tag rules determine the output.

## Verification and samples

The test suite contains 30 scenarios covering the browser and Node.js APIs, the
output contract, mixed content, raw text, all listed void elements, SVG and
MathML, optional closing tags, nested lists and tables, Unicode, hostile and
malformed values, a 5000-level tree, a roughly 500 KB text payload, and every
checked-in sample. UI tests also exercise both example buttons and the
serialization-error path, and check that input scripts are not executed.

A regression test for nested description lists first reproduced a bug where
an inner `dt` closed an outer `dd`. The parser now stops that search at the
containing `dl`, preserving the nested structure.

The `html_samples/` directory contains:

- `mixed-fragment.html` — a small fragment with mixed content and attributes;
- `full-document.html` — a complete document with styles, scripts, and a table;
- `edge-cases.html` — optional end tags, raw text, boolean attributes, SVG,
  foreign content, and CDATA.
- `nested-lists.html` — nested description and numbered lists with optional
  closing tags.

## AI assistance disclosure

AI assistance was used throughout implementation and review, as required by the
assignment. The [dialogue transcript](ai_help/conversation_transcript.md) records
the visible user and assistant messages, with its snapshot boundary and omitted
tool logs explicitly noted. The separate
[collaboration notes](ai_help/implementation_notes.md) explain the decisions,
verification, and limitations; they are a retrospective summary, not additional
dialogue.

Before submission, replace the placeholder in `ai_help/chatgpt_chat.txt` with
the public share link for the complete conversation and verify that the link
opens in an incognito window. The local transcript is a supplementary artifact
and does not replace that requested link.
