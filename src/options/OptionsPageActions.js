/**
 * @fileoverview Options UI for background-owned, bounded Act site policies.
 * @module OptionsPageActions
 */
import {
  normalizePageActionOrigin,
  normalizePageActionSitePolicies,
  PAGE_ACTION_SITE_POLICY_KEY,
} from '../utils/pageActionSitePolicies.js';

export function setupPageActionSitePolicies({ list, form, originInput, ruleInput, notify }) {
  if (!list || !form || !originInput || !ruleInput) return;
  let revision = 0;
  const showError = (error) =>
    notify(error.message || 'Site policies could not be saved.', true, true);
  const render = (policies = {}) => {
    list.replaceChildren();
    const normalized = normalizePageActionSitePolicies(policies);
    if (!normalized.valid) {
      list.textContent =
        'Site policies could not be loaded. Restore a valid backup to repair them.';
      throw new Error(normalized.error);
    }
    const entries = Object.entries(normalized.value);
    if (!entries.length) {
      list.textContent = 'No site policies. Default approvals apply.';
      return;
    }
    for (const [origin, rule] of entries) {
      const row = document.createElement('div');
      row.className = 'd-flex gap-2 flex-wrap align-items-center mb-2';
      const label = document.createElement('span');
      label.className = 'text-break mw-100';
      label.textContent = `${origin} — ${rule === 'block' ? 'Blocked' : 'Allow low-risk actions'}`;
      row.append(label);
      const addButton = (text, policy) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-outline-secondary btn-sm';
        button.textContent = text;
        button.setAttribute('aria-label', `${text} ${origin}`);
        button.addEventListener('click', () => {
          button.disabled = true;
          void update(origin, policy)
            .catch(showError)
            .finally(() => {
              button.disabled = false;
            });
        });
        row.append(button);
      };
      if (rule !== 'block') addButton('Block', 'block');
      addButton('Remove', null);
      list.append(row);
    }
  };
  const refresh = async () => {
    const current = ++revision;
    const stored = await chrome.storage.local.get([PAGE_ACTION_SITE_POLICY_KEY]);
    if (current === revision) render(stored[PAGE_ACTION_SITE_POLICY_KEY] || {});
  };
  const update = async (origin, policy) => {
    const response = await chrome.runtime.sendMessage({
      action: 'setPageActionSitePolicy',
      origin,
      policy,
    });
    if (!response?.success) throw new Error(response?.error || 'The site policy was not saved.');
    revision += 1;
    render(response.policies);
    notify(
      'Site policy saved. It applies to new runs. High-risk actions always require approval.',
      false,
      true
    );
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const origin = normalizePageActionOrigin(originInput.value.trim());
    if (!origin) {
      showError(new Error('Enter a HTTP(S) origin without a path, query or credentials.'));
      originInput.focus();
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    void update(origin, ruleInput.value)
      .then(() => {
        originInput.value = '';
      })
      .catch(showError)
      .finally(() => {
        button.disabled = false;
      });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[PAGE_ACTION_SITE_POLICY_KEY]) void refresh().catch(showError);
  });
  void refresh().catch(showError);
}
