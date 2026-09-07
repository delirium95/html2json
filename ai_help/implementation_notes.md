# AI collaboration notes

This document is a retrospective explanation written by the assistant at the
user's request. It is not a transcript or a record of questions the user asked.

## How the collaboration worked

The user asked the assistant to clone Jito's assignment repository and implement
the task, then specified that publication should use a separate repository.
The assistant read the assignment, selected the representation, wrote the
parser, tests, samples, and documentation, ran checks, and created a local
implementation commit (`efb154c`). The short, directive user messages reflect
that delegated workflow; they do not establish that the user independently
designed or reviewed each implementation choice.

## Decisions behind the implementation

- An ordered tree represents mixed text and elements without losing sibling
  order. One document root also accommodates fragments with multiple roots.
- Attributes are an array of `{ name, value }` entries so duplicates and order
  survive. `null` represents a boolean attribute; `""` represents an explicitly
  empty value.
- Text and attribute character references remain as written. This choice
  preserves their source spelling rather than returning decoded DOM values.
- The parser uses an explicit stack, recognizes quoted attribute values, and
  handles raw-text element bodies separately. It does not use a DOM parser.
- Open-element counters avoid scanning the stack when a candidate closing
  element is absent. This improved the measured deeply nested `div` case;
  it is not a proof of linear runtime for every possible input.

## Checks actually performed during implementation

At the initial implementation commit, the checked-in suite passed 19 tests.
It covered the Node.js export, a
classic-script invocation with a mocked UI, expected tree structures, malformed
inputs, samples, and large/deep inputs. Additional one-off checks exercised
25,000 generated inputs directly against the internal parser and traversed a
100,000-level result without recursively serializing it.

Headless Chrome successfully loaded the supplied page. That check did not
exercise button clicks in Chrome; the UI callback was exercised by the mocked
classic-script test. Generated-input checks establish robustness for those
inputs, not HTML standard conformance or correctness of every resulting tree.

## Follow-up test review

After the user asked whether more tests were needed, the assistant added 11
tests for nested lists and tables, MathML, Unicode and mixed-case tags, all
listed void elements, raw-text closing-tag boundaries, unusual attribute names,
input script non-execution, both example callbacks, and serialization failures.
The expanded suite contains 30 tests.

The nested-description-list test failed on the previous implementation: an inner
`dt` incorrectly closed the outer `dd`. The fix adds `dl` as a boundary for the
description-item search. Both explicit and omitted inner closing tags are
covered. The relevant tree-building behavior was checked against the
[HTML Standard's in-body parsing rules](https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inbody).
This targeted fix does not extend the converter into a full browser parser.

## Limits relevant to a code review

The result is a source-oriented tree, not a complete browser HTML tree builder
or a byte-for-byte reversible representation. For example, it retains text and
attribute values but does not retain quote style, tag spacing, or unmatched end
tags. Optional-end-tag handling is a selected subset, and character references
are not decoded.

Parsing uses an iterative stack, but native `JSON.stringify` can still exceed
the JavaScript engine's recursion limit for very deep trees. The UI catches
serialization errors and displays an error message. The public parser catches
unexpected exceptions and falls back to a text node; that fallback prevents
ordinary exceptions escaping but does not guarantee a correct structural result
or protection against process-level resource exhaustion.

## Submission status

The dialogue transcript is included as `conversation_transcript.md`. It omits
tool execution logs and does not replace the assignment's requested public
conversation link. `chatgpt_chat.txt` still contains a clearly marked placeholder.
The user supplied `https://github.com/delirium95/html2json.git` as the destination
repository for publication.
