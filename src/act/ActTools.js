/**
 * @fileoverview Static tool schemas exposed by the Act capability.
 * @module ActTools
 */

import { PAGE_ACTION_KEYS } from '../utils/pageActionPolicy.js';

// Optional bounded model-supplied human label for one page action, shared by
// the tool schemas. Display-only on the progress card; the policy layer
// rejects control characters, credential/payment wording, and over-long text.
const PAGE_ACTION_TITLE_SCHEMA = Object.freeze({
  type: 'string',
  minLength: 1,
  maxLength: 80,
  description:
    'Optional ≤80-char human label for this step shown on the progress card (e.g. "Opening the form"). Never echo typed text, entered values, or secrets.',
});

const PAGE_ACTION_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'page_set_value',
      description:
        'Set a non-sensitive range, number, date, time, color, slider or spinbutton value. Read the returned value and receipt before continuing.',
      parameters: {
        type: 'object',
        properties: {
          snapshotId: { type: 'string' },
          index: { type: 'integer', minimum: 0 },
          value: { type: 'string', maxLength: 160 },
          title: PAGE_ACTION_TITLE_SCHEMA,
        },
        required: ['snapshotId', 'index', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_keypress',
      description:
        'Press an allowed key on one indexed control, or the freshly observed focused element when index is omitted. Enter uses the form submit control risk; inspect changed state before continuing.',
      parameters: {
        type: 'object',
        properties: {
          snapshotId: { type: 'string' },
          index: { type: 'integer', minimum: 0 },
          key: { type: 'string', enum: PAGE_ACTION_KEYS },
          expect: {
            type: 'object',
            description:
              'Optional observed postcondition. Use text_gone when closing a dialog or choosing a suggestion that closes its list, text_appears for a visible result, or url_changes for navigation. Typed field values are not visible text. Use only observed, non-sensitive text.',
            properties: {
              type: { type: 'string', enum: ['text_appears', 'text_gone', 'url_changes'] },
              text: { type: 'string', maxLength: 160 },
            },
            required: ['type'],
          },
          title: PAGE_ACTION_TITLE_SCHEMA,
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_hover',
      description: 'Hover one indexed control to reveal a menu, then read the refreshed snapshot.',
      parameters: {
        type: 'object',
        properties: {
          snapshotId: { type: 'string' },
          index: { type: 'integer', minimum: 0 },
          title: PAGE_ACTION_TITLE_SCHEMA,
        },
        required: ['snapshotId', 'index'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_get_state',
      description: `Take a fresh snapshot of the current page before acting. After a mutation, use its refreshed snapshot when one is returned; call this before another state-changing action when the result has no snapshot, and before final verification. Pass regionId only as a region-N id from the snapshot regions list (for example region-0); never pass a snapshotId (frames-... or page-...); omit regionId for the full page.`,
      parameters: {
        type: 'object',
        properties: {
          regionId: {
            type: 'string',
            maxLength: 32,
            description:
              'Optional region-N id from the snapshot regions list (for example region-0). Never a snapshotId; omit for the full page.',
          },
          title: PAGE_ACTION_TITLE_SCHEMA,
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_find_text',
      description: `Search the bounded page text without scrolling or changing the page. Use this to locate exact filters, labels, prices, or login/interstitial messages; then inspect matching controls with page_get_state before acting. Pass regionId only as a region-N id (for example region-0); never a snapshotId.`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 160 },
          regionId: {
            type: 'string',
            maxLength: 32,
            description:
              'Optional region-N id (for example region-0). Never a snapshotId; omit for the full page.',
          },
          title: PAGE_ACTION_TITLE_SCHEMA,
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_wait',
      description: `Wait for bounded asynchronous page work without changing the page. Use text when content should appear, text_gone when a loading or blocking message should disappear, or url_changed after navigation. Prefer this over fixed delays; it returns after the condition is met or the timeout expires. Pass regionId only as region-N (for example region-0), never a snapshotId.`,
      parameters: {
        type: 'object',
        properties: {
          condition: { type: 'string', enum: ['text', 'text_gone', 'url_changed'] },
          text: { type: 'string', maxLength: 160 },
          timeoutMs: { type: 'integer', minimum: 0, maximum: 10000 },
          regionId: {
            type: 'string',
            maxLength: 32,
            description:
              'Optional region-N id (for example region-0). Never a snapshotId; omit for the full page.',
          },
          title: PAGE_ACTION_TITLE_SCHEMA,
        },
        required: ['condition'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_batch',
      description: `Run 2 to 6 read-only observations in sequence in one turn. Prefer individual tool calls when one result should guide the next action. When batching helps, use flat fields on each action item (for example {"name":"page_find_text","query":"Economics"}); do not nest an args object. It cannot contain clicks, inputs, selects, navigation, or another batch.`,
      parameters: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            minItems: 2,
            maxItems: 6,
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  enum: [
                    'page_get_state',
                    'page_scroll',
                    'page_find_text',
                    'page_wait',
                    'page_hover',
                  ],
                },
                snapshotId: { type: 'string', maxLength: 128 },
                index: { type: 'integer', minimum: 0 },
                direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
                pages: { type: 'number', minimum: 0.1, maximum: 8 },
                containerIndex: { type: 'integer', minimum: 0 },
                query: { type: 'string', maxLength: 120 },
                condition: { type: 'string', enum: ['text', 'text_gone', 'url_changed'] },
                text: { type: 'string', maxLength: 160 },
                timeoutMs: { type: 'integer', minimum: 0, maximum: 10000 },
                regionId: { type: 'string', maxLength: 32 },
              },
              required: ['name'],
            },
          },
          title: PAGE_ACTION_TITLE_SCHEMA,
        },
        required: ['actions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_click',
      description: `Perform the click on one indexed control to complete the requested click or navigation action. Do not click an editable field just to focus it before typing; page_input focuses and types in one action. For search forms, set the query and all requested filters before submitting. Valid HTTP(S) same-tab links are supported; links that open a new tab must use page_open_link.`,
      parameters: {
        type: 'object',
        properties: {
          snapshotId: { type: 'string' },
          index: { type: 'integer', minimum: 0 },
          count: { type: 'integer', enum: [1, 2] },
          expect: {
            type: 'object',
            description:
              'Optional observed postcondition. Use text_gone when closing a dialog or choosing a suggestion that closes its list, text_appears for a visible result, or url_changes for navigation. Typed field values are not visible text. Use only observed, non-sensitive text.',
            properties: {
              type: { type: 'string', enum: ['text_appears', 'text_gone', 'url_changes'] },
              text: { type: 'string', maxLength: 160 },
            },
            required: ['type'],
          },
          title: PAGE_ACTION_TITLE_SCHEMA,
        },
        required: ['snapshotId', 'index'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_input',
      description: `Focus and type the user-provided text into one indexed non-sensitive editable control in a single action; use this directly without a preparatory page_click. Copy search phrases from the user's wording verbatim; do not paraphrase or respell them. If the task requires submission, submit it or use page_keypress Enter on the freshly observed control. Never invent or request secrets.`,
      parameters: {
        type: 'object',
        properties: {
          snapshotId: { type: 'string' },
          index: { type: 'integer', minimum: 0 },
          mode: { type: 'string', enum: ['replace', 'append'] },
          text: { type: 'string', maxLength: 2000 },
          submit: {
            type: 'boolean',
            description:
              'Submit the containing form, or press Enter, after entering text. Submission remains confirmation-gated by the submit control.',
          },
          expect: {
            type: 'object',
            description:
              'Optional observed postcondition. Use text_gone when closing a dialog or choosing a suggestion that closes its list, text_appears for a visible result, or url_changes for navigation. Typed field values are not visible text. Use only observed, non-sensitive text.',
            properties: {
              type: { type: 'string', enum: ['text_appears', 'text_gone', 'url_changes'] },
              text: { type: 'string', maxLength: 160 },
            },
            required: ['type'],
          },
          title: PAGE_ACTION_TITLE_SCHEMA,
        },
        required: ['snapshotId', 'index', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_select',
      description: `Set one indexed <select> control to the option matching the task, by visible text or value. The index must identify the <select> control itself, not one of its <option> items.`,
      parameters: {
        type: 'object',
        properties: {
          snapshotId: { type: 'string' },
          index: { type: 'integer', minimum: 0 },
          option: { type: 'string', maxLength: 320 },
          title: PAGE_ACTION_TITLE_SCHEMA,
        },
        required: ['snapshotId', 'index', 'option'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_scroll',
      description:
        'Scroll the current page or one indexed scroll container to reveal content the task needs. This is read-only and runs immediately. Prefer page_find_text first: it searches the full page text including offscreen content, so locate the exact section or label before scrolling. Scroll only to bring an already-found match into view, and combine a find with up to two scrolls in one page_batch instead of many single-scroll turns.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
          pages: { type: 'number', minimum: 0, maximum: 5 },
          snapshotId: { type: 'string' },
          index: { type: 'integer', minimum: 0 },
          containerIndex: { type: 'integer', minimum: 0, maximum: 15 },
          title: PAGE_ACTION_TITLE_SCHEMA,
        },
        required: ['direction'],
      },
    },
  },
];

const PAGE_TAB_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'page_go_back',
      description: 'Go back in one owned tab, then inspect its current state before acting.',
      parameters: {
        type: 'object',
        properties: { tabId: { type: 'integer' } },
        required: ['tabId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_list_tabs',
      description:
        'List the small set of tabs owned by this page-action run. The result marks unavailable tabs; do not switch to those tabs.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_open_tab',
      description:
        'Open one http(s) URL in a separate owned tab only when the task needs multiple pages. Reuse an existing owned tab for that site when possible; wait for readiness before inspecting it.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', maxLength: 2000 },
          background: { type: 'boolean' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_open_link',
      description:
        'Navigate the current target tab to one indexed HTTP(S) link from the current snapshot. Use background=true only when a separate research/reference tab is genuinely needed; never invent a URL.',
      parameters: {
        type: 'object',
        properties: {
          snapshotId: { type: 'string' },
          index: { type: 'integer', minimum: 0 },
          background: { type: 'boolean' },
        },
        required: ['snapshotId', 'index'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_switch_tab',
      description: 'Switch the active target to an owned tab before using page actions.',
      parameters: {
        type: 'object',
        properties: { tabId: { type: 'integer' } },
        required: ['tabId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_close_tab',
      description:
        'Close one owned non-source tab. This remains a confirmation-gated browser action.',
      parameters: {
        type: 'object',
        properties: { tabId: { type: 'integer' } },
        required: ['tabId'],
      },
    },
  },
];

/** Return the cached tool schemas. */
export function getPageTabTools() {
  return PAGE_TAB_TOOLS;
}

const PAGE_USER_INPUT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'page_request_user_input',
      description: 'Ask the user one bounded clarification question. Never ask for secrets.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', maxLength: 600 },
          options: { type: 'array', items: { type: 'string', maxLength: 120 }, maxItems: 6 },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_pause_for_user',
      description:
        'Pause automation while the user completes a safe manual step such as CAPTCHA or SSO. The user resumes explicitly; never request secrets, payments, destructive actions, or security changes.',
      parameters: {
        type: 'object',
        properties: { question: { type: 'string', maxLength: 600 } },
        required: ['question'],
      },
    },
  },
];

/** Return the cached tool schemas. */
export function getPageUserInputTools() {
  return PAGE_USER_INPUT_TOOLS;
}

const PAGE_TASK_MEMORY_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'page_record_note',
      description:
        'Record one short, untrusted observation only when a fact must be retained for a later task step. Do not record findings that can go directly in the final answer. For counted quota progress, provide item and status together; otherwise omit status. Never record secrets.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', maxLength: 800 },
          item: { type: 'string', maxLength: 80 },
          status: { type: 'string', enum: ['done', 'skipped'] },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_update_plan',
      description:
        'Write or update a checklist for multi-step work. Keep resolved steps; exactly one in_progress while work remains, none when all resolved. Completion requires new observed evidence since the last update. Five revisions maximum. Planning never changes approval policy.',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            minItems: 1,
            maxItems: 12,
            items: {
              type: 'object',
              properties: {
                description: { type: 'string', minLength: 1, maxLength: 200 },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed', 'skipped'],
                },
              },
              required: ['description', 'status'],
              additionalProperties: false,
            },
          },
        },
        required: ['steps'],
        additionalProperties: false,
      },
    },
  },
];

/** Return the cached planner and task-memory tool schemas. */
export function getPageTaskMemoryTools() {
  return PAGE_TASK_MEMORY_TOOLS;
}

/** Return the cached page-action tool schemas. */
export function getPageActionTools() {
  return PAGE_ACTION_TOOL_SCHEMAS;
}

/** Return the fixed first-action tool set used by the Mind2Web evaluator. */
export function getMind2WebPageTools() {
  const actionNames = new Set(['page_get_state', 'page_click', 'page_input', 'page_select']);
  const descriptions = {
    page_get_state:
      'Inspect the current page and return the snapshot used to choose one next action. Use only IDs and indexes from that snapshot.',
    page_click:
      'Choose the observed control that performs the immediate next step in task order. When labels overlap, compare control role and menu state, not text alone. Open a relevant collapsed parent menu before a child; do not click an ancestor merely because it contains the target.',
    page_input:
      'Enter the shortest query that identifies the requested entity for this field. Remove task verbs and generic result words such as “recipe”; keep entity-defining modifiers when the field searches for an entity, and use only the category head noun when the field asks for a business/category. For a city-or-point-of-interest field, enter the city only; for a city/state/ZIP field, enter city plus the task’s two-letter state. Do not add qualifiers absent from the task. Use only the current snapshot ID and index.',
    page_select:
      'Set one indexed select control from the current snapshot to the option matching the next requested action.',
  };
  return getPageActionTools()
    .filter((tool) => actionNames.has(tool.function?.name))
    .map((tool) => ({
      ...tool,
      function: {
        ...tool.function,
        description: descriptions[tool.function.name],
      },
    }));
}
