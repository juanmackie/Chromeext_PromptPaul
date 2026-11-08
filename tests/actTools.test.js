import { describe, expect, it } from 'vitest';
import {
  getPageActionTools,
  getPageTabTools,
  getPageTaskMemoryTools,
  getPageUserInputTools,
} from '../src/act/index.js';

describe('Act tool schema provider', () => {
  it('returns the stable semantic page-action tool set with bounded display titles', () => {
    const tools = getPageActionTools();
    const names = tools.map((tool) => tool.function.name);
    expect(names).toContain('page_get_state');
    expect(names).toContain('page_click');
    expect(names).toContain('page_input');
    expect(names).toContain('page_scroll');
    expect(getPageActionTools()).toBe(tools);

    const titledTools = tools.filter((tool) => tool.function.parameters.properties?.title);
    expect(titledTools.length).toBeGreaterThan(0);
    for (const tool of titledTools) {
      expect(tool.function.parameters.properties.title).toMatchObject({
        type: 'string',
        minLength: 1,
        maxLength: 80,
      });
    }
  });

  it('provides the planner and task-memory tools from the Act capability', () => {
    const tools = getPageTaskMemoryTools();
    expect(tools.map((tool) => tool.function.name)).toEqual([
      'page_record_note',
      'page_update_plan',
    ]);
    expect(getPageTaskMemoryTools()).toBe(tools);
  });

  it('provides clarification, manual-intervention, and owned-tab schemas', () => {
    expect(getPageUserInputTools().map((tool) => tool.function.name)).toEqual([
      'page_request_user_input',
      'page_pause_for_user',
    ]);
    expect(getPageTabTools().map((tool) => tool.function.name)).toEqual([
      'page_go_back',
      'page_list_tabs',
      'page_open_tab',
      'page_open_link',
      'page_switch_tab',
      'page_close_tab',
    ]);
  });
});
