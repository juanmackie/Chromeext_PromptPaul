/**
 * @fileoverview Custom skill management for the Options page.
 * @module OptionsSkills
 */

import {
  generateSkillMarkdown,
  MAX_SKILL_MARKDOWN_CHARS,
  parseSkillMarkdown,
  validateMetadata,
} from '../utils/skillParser.js';
import { escapeHtml } from '../utils/domSanitizer.js';
import { readBoundedResponseText } from '../utils/streamSafety.js';
import {
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORTED_RECORDS,
  MAX_SKILL_METADATA_CHARS,
} from './OptionsLimits.js';

function isValidJson(value) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

export function setupSkillHandlers({ showStatus, setChromeStorage }) {
  const saveSkillBtn = document.getElementById('saveSkill');
  const clearSkillFormBtn = document.getElementById('clearSkillForm');

  function normalizeStoredSkill(skill) {
    if (!skill || typeof skill !== 'object' || typeof skill.skillMd !== 'string') return null;
    const parsed = parseSkillMarkdown(skill.skillMd);
    if (!parsed.valid) return null;
    return {
      name: parsed.metadata.name,
      skillMd: skill.skillMd,
      lastUpdated:
        typeof skill.lastUpdated === 'string'
          ? skill.lastUpdated.trim().slice(0, 128)
          : new Date().toISOString(),
    };
  }

  // Load and display skills
  function loadSkills() {
    // Load built-in skills first
    const builtInSkillsPromise = fetch(chrome.runtime.getURL('skills/skills.json'))
      .then((response) => response.json())
      .catch((e) => {
        console.warn('Failed to load built-in skills:', e);
        return [];
      });

    // Load custom skills
    const customSkillsPromise = new Promise((resolve) => {
      chrome.storage.local.get(['customSkills'], (result) => {
        resolve(
          (Array.isArray(result.customSkills) ? result.customSkills : [])
            .map(normalizeStoredSkill)
            .filter(Boolean)
            .slice(0, MAX_IMPORTED_RECORDS)
        );
      });
    });

    Promise.all([builtInSkillsPromise, customSkillsPromise]).then(([builtIn, custom]) => {
      const skillsMap = new Map();
      // Built-in first
      builtIn.forEach((s) => skillsMap.set(s.name, { ...s, source: 'Built-in' }));
      // Custom overrides built-in (or adds new)
      custom.forEach((s) => {
        const parsed = typeof s.skillMd === 'string' ? parseSkillMarkdown(s.skillMd) : null;
        const description = parsed?.valid
          ? parsed.metadata.description
          : `Invalid SKILL.md (${parsed?.error || 'canonical skillMd is required'})`;
        skillsMap.set(s.name, { ...s, description, source: 'Custom' });
      });

      const skills = Array.from(skillsMap.values());
      const tableBody = document.querySelector('#skillsTable tbody');
      if (tableBody) {
        tableBody.innerHTML = '';

        skills.forEach((skill) => {
          const row = document.createElement('tr');
          const isCustom = skill.source === 'Custom';
          const actions = isCustom
            ? `<button class="edit-skill-btn" data-name="${escapeHtml(skill.name)}">Edit</button>
                  <button class="delete-skill-btn" data-name="${escapeHtml(skill.name)}">Delete</button>`
            : `<span class="text-muted" style="color: grey; font-style: italic;">Built-in (Read-only)</span>`;

          row.innerHTML = `
              <td data-label="Name">${escapeHtml(skill.name)}</td>
              <td data-label="Description">${escapeHtml(skill.description)}</td>
              <td data-label="Source">${escapeHtml(skill.source)}</td>
              <td data-label="Actions">${actions}</td>
            `;
          tableBody.appendChild(row);
        });
      }

      // Add edit/delete handlers
      document.querySelectorAll('.edit-skill-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const skillName = e.target.dataset.name;
          const skill = custom.find((s) => s.name === skillName);
          if (skill) {
            document.getElementById('skillName').value = skill.name;
            document.getElementById('skillName').disabled = true; // Cannot change ID of existing skill

            if (typeof skill.skillMd !== 'string') {
              showStatus(`Skill '${skillName}' is not in canonical SKILL.md format.`, true);
              return;
            }

            const parsed = parseSkillMarkdown(skill.skillMd);
            if (!parsed.valid) {
              showStatus(`Skill '${skillName}' could not be parsed: ${parsed.error}`, true);
              return;
            }

            document.getElementById('skillDescription').value = parsed.metadata.description;
            document.getElementById('skillContent').value = parsed.instructions;

            const licenseInput = document.getElementById('skillLicense');
            const compatibilityInput = document.getElementById('skillCompatibility');
            const allowedToolsInput = document.getElementById('skillAllowedTools');
            const metadataInput = document.getElementById('skillMetadata');

            if (licenseInput) licenseInput.value = parsed.metadata.license || '';
            if (compatibilityInput) compatibilityInput.value = parsed.metadata.compatibility || '';
            if (allowedToolsInput) allowedToolsInput.value = parsed.metadata['allowed-tools'] || '';
            if (metadataInput) {
              metadataInput.value = parsed.metadata.metadata
                ? JSON.stringify(parsed.metadata.metadata, null, 2)
                : '';
            }
          }
        });
      });

      document.querySelectorAll('.delete-skill-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const skillName = e.target.dataset.name;
          if (confirm(`Delete skill '${skillName}'?`)) {
            chrome.storage.local.get(['customSkills'], (result) => {
              let customSkills = result.customSkills || [];
              customSkills = customSkills.filter((s) => s.name !== skillName);
              chrome.storage.local.set({ customSkills }, () => {
                showStatus('Skill deleted.');
                loadSkills();
                clearSkillForm();
              });
            });
          }
        });
      });
    });
  }

  // Save skill handler - generates canonical SKILL.md format
  if (saveSkillBtn) {
    saveSkillBtn.addEventListener('click', () => {
      const nameInput = document.getElementById('skillName');
      const name = nameInput.value.trim();
      const description = document.getElementById('skillDescription').value.trim();
      const content = document.getElementById('skillContent').value.trim();

      // Optional fields (Agent Skills spec)
      const licenseInput = document.getElementById('skillLicense');
      const compatibilityInput = document.getElementById('skillCompatibility');
      const allowedToolsInput = document.getElementById('skillAllowedTools');
      const userInvocableInput = document.getElementById('skillUserInvocable');
      const disableModelInvocationInput = document.getElementById('skillDisableModelInvocation');

      const license = licenseInput ? licenseInput.value.trim() : '';
      const compatibility = compatibilityInput ? compatibilityInput.value.trim() : '';
      const allowedTools = allowedToolsInput ? allowedToolsInput.value.trim() : '';
      const userInvocable = userInvocableInput ? userInvocableInput.checked : true;
      const disableModelInvocation = disableModelInvocationInput
        ? disableModelInvocationInput.checked
        : false;

      let customMetadata = null;
      const metadataInput = document.getElementById('skillMetadata');
      if (metadataInput && metadataInput.value.trim()) {
        if (metadataInput.value.length > MAX_SKILL_METADATA_CHARS) {
          showStatus(`Metadata must be ${MAX_SKILL_METADATA_CHARS} characters or less.`, true);
          return;
        }
        if (!isValidJson(metadataInput.value.trim())) {
          showStatus('Metadata must be valid JSON object.', true);
          return;
        }

        const parsedMetadata = JSON.parse(metadataInput.value.trim());
        if (
          !parsedMetadata ||
          typeof parsedMetadata !== 'object' ||
          Array.isArray(parsedMetadata)
        ) {
          showStatus('Metadata must be a JSON object.', true);
          return;
        }
        customMetadata = parsedMetadata;
      }

      if (!name || !description || !content) {
        showStatus('All fields are required.', true);
        return;
      }
      if (
        name.length > 64 ||
        description.length > 1_024 ||
        content.length > MAX_SKILL_MARKDOWN_CHARS
      ) {
        showStatus(
          `Skill name, description, or content exceeds the supported size limit (${MAX_SKILL_MARKDOWN_CHARS} characters for content).`,
          true
        );
        return;
      }

      const validation = validateMetadata({
        name,
        description,
        ...(license ? { license } : {}),
        ...(compatibility ? { compatibility } : {}),
        ...(allowedTools ? { 'allowed-tools': allowedTools } : {}),
        ...(customMetadata ? { metadata: customMetadata } : {}),
        'user-invocable': userInvocable,
        'disable-model-invocation': disableModelInvocation,
      });

      if (!validation.valid) {
        showStatus(validation.error, true);
        return;
      }

      // Generate canonical SKILL.md content
      const skillMd = generateSkillMarkdown({
        name,
        description,
        instructions: content,
        options: {
          ...(license ? { license } : {}),
          ...(compatibility ? { compatibility } : {}),
          ...(allowedTools ? { 'allowed-tools': allowedTools } : {}),
          ...(customMetadata ? { metadata: customMetadata } : {}),
          userInvocable,
          disableModelInvocation,
        },
      });
      if (skillMd.length > MAX_SKILL_MARKDOWN_CHARS) {
        showStatus(`Generated SKILL.md exceeds ${MAX_SKILL_MARKDOWN_CHARS} characters.`, true);
        return;
      }

      chrome.storage.local.get(['customSkills'], (result) => {
        let customSkills = (Array.isArray(result.customSkills) ? result.customSkills : [])
          .map(normalizeStoredSkill)
          .filter(Boolean)
          .slice(0, MAX_IMPORTED_RECORDS);
        // Check if updating
        const existingIndex = customSkills.findIndex((s) => s.name === name);

        // Store in canonical format with skillMd field
        const newSkill = {
          name,
          skillMd,
          lastUpdated: new Date().toISOString(),
        };

        const isUpdate = existingIndex > -1;
        if (isUpdate) {
          customSkills[existingIndex] = newSkill;
        } else {
          customSkills.push(newSkill);
        }

        setChromeStorage(chrome.storage.local, {
          customSkills: customSkills.slice(0, MAX_IMPORTED_RECORDS),
        })
          .then(() => {
            showStatus(isUpdate ? 'Skill updated.' : 'Skill added.');
            loadSkills();
            clearSkillForm();
          })
          .catch((error) => {
            showStatus(
              `Skill could not be saved: ${error.message}. Your draft is preserved.`,
              true
            );
          });
      });
    });
  }

  // Clear skill form handler
  if (clearSkillFormBtn) {
    clearSkillFormBtn.addEventListener('click', clearSkillForm);
  }

  function clearSkillForm() {
    const nameInput = document.getElementById('skillName');
    if (nameInput) {
      nameInput.value = '';
      nameInput.disabled = false;
    }
    const descInput = document.getElementById('skillDescription');
    if (descInput) descInput.value = '';
    const contentInput = document.getElementById('skillContent');
    if (contentInput) contentInput.value = '';

    const optionalInputs = [
      'skillLicense',
      'skillCompatibility',
      'skillAllowedTools',
      'skillMetadata',
    ];
    optionalInputs.forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });

    // Reset checkbox fields
    const userInvocableInput = document.getElementById('skillUserInvocable');
    if (userInvocableInput) userInvocableInput.checked = true;

    const disableModelInvocationInput = document.getElementById('skillDisableModelInvocation');
    if (disableModelInvocationInput) disableModelInvocationInput.checked = false;

    showStatus('Skill form cleared.');
  }

  // Export skills handler - v2 format with canonical SKILL.md
  const exportBtn = document.getElementById('exportSkills');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      chrome.storage.local.get(['customSkills'], (result) => {
        const customSkills = result.customSkills || [];
        // v2 format with spec version
        const exportData = {
          version: '2.0',
          spec: 'agentskills.io',
          exportedAt: new Date().toISOString(),
          skills: customSkills,
        };
        const dataStr =
          'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute('href', dataStr);
        downloadAnchorNode.setAttribute('download', 'prompt_paul_skills.json');
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
      });
    });
  }

  // Import canonical Agent Skills export format.
  const importBtn = document.getElementById('importSkills');
  if (importBtn) {
    importBtn.addEventListener('click', () => {
      document.getElementById('importSkillsFile').click();
    });
  }

  const importFile = document.getElementById('importSkillsFile');
  if (importFile) {
    importFile.addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        showStatus('Skill import file is too large.', true);
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target.result);
          let skillsToImport = [];

          if (imported.version !== '2.0' || !Array.isArray(imported.skills)) {
            showStatus('Invalid skill file format. Expected a v2 skills export.', true);
            return;
          }
          if (imported.skills.length > MAX_IMPORTED_RECORDS) {
            showStatus(`Import contains more than ${MAX_IMPORTED_RECORDS} skills.`, true);
            return;
          }
          skillsToImport = imported.skills;

          chrome.storage.local.get(['customSkills'], (result) => {
            let customSkills = (Array.isArray(result.customSkills) ? result.customSkills : [])
              .map(normalizeStoredSkill)
              .filter(Boolean)
              .slice(0, MAX_IMPORTED_RECORDS);
            let importCount = 0;
            let invalidCount = 0;

            skillsToImport.forEach((newSkill) => {
              if (typeof newSkill.skillMd !== 'string' || newSkill.skillMd.trim() === '') {
                invalidCount++;
                return;
              }
              const canonicalMarkdown = newSkill.skillMd;

              const parsed = parseSkillMarkdown(canonicalMarkdown);
              if (!parsed.valid) {
                invalidCount++;
                return;
              }

              const skillToSave = {
                name: parsed.metadata.name,
                skillMd: canonicalMarkdown,
                lastUpdated:
                  typeof newSkill.lastUpdated === 'string'
                    ? newSkill.lastUpdated.trim().slice(0, 128)
                    : new Date().toISOString(),
              };

              const idx = customSkills.findIndex((s) => s.name === skillToSave.name);
              if (idx > -1) {
                customSkills[idx] = skillToSave;
              } else {
                customSkills.push(skillToSave);
              }
              importCount++;
            });

            customSkills = customSkills.slice(0, MAX_IMPORTED_RECORDS);
            chrome.storage.local.set({ customSkills }, () => {
              const invalidMsg = invalidCount > 0 ? ` (${invalidCount} skipped as invalid)` : '';
              showStatus(`Imported ${importCount} skills${invalidMsg}.`);
              loadSkills();
            });
          });
        } catch (err) {
          console.error(err);
          showStatus('Error parsing skill file.', true);
        }
      };
      reader.readAsText(file);
    });
  }

  // Skills.sh Import Handler
  function setupSkillsShImport() {
    const urlInput = document.getElementById('skillsShUrl');
    const importBtn = document.getElementById('importSkillsShBtn');
    const findBtn = document.getElementById('findSkillsShBtn');
    const statusEl = document.getElementById('skillsShStatus');

    if (!urlInput || !importBtn || !findBtn || !statusEl) {
      return;
    }

    async function readSkillMarkdown(response) {
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_SKILL_MARKDOWN_CHARS) {
        return null;
      }
      const skillMd = await readBoundedResponseText(response, MAX_SKILL_MARKDOWN_CHARS);
      return skillMd.endsWith(' [truncated]') ? null : skillMd;
    }

    // Helper function to fetch skill from GitHub with multiple path/branch fallback
    async function fetchSkillFromGitHub(owner, repo, skillName) {
      const branches = ['main', 'master'];
      const pathPatterns = [`skills/${skillName}/SKILL.md`, `${skillName}/SKILL.md`];

      // Try common paths first
      for (const branch of branches) {
        for (const path of pathPatterns) {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
          try {
            const response = await fetch(rawUrl);
            if (response.ok) {
              const skillMd = await readSkillMarkdown(response);
              if (skillMd && skillMd.trim().length > 0) {
                console.log(`[Skills Import] Found skill at: ${rawUrl}`);
                return { skillMd, url: rawUrl };
              }
            }
          } catch {
            // Continue to next path
          }
        }
      }

      // Fallback: Use GitHub API to search for skill by name
      console.log('[Skills Import] Falling back to GitHub API search...');
      return await searchSkillViaGitHubAPI(owner, repo, skillName);
    }

    // Search for skill by name using GitHub API
    async function searchSkillViaGitHubAPI(owner, repo, skillName) {
      try {
        // Fetch repository tree (recursive)
        const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
        const treeResponse = await fetch(treeUrl);

        if (!treeResponse.ok) {
          // Try master branch if main fails
          const masterTreeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`;
          const masterResponse = await fetch(masterTreeUrl);
          if (!masterResponse.ok) return null;
          const masterTree = JSON.parse(
            await readBoundedResponseText(masterResponse, MAX_IMPORT_FILE_BYTES)
          );
          return await findSkillInTree(owner, repo, masterTree, skillName, 'master');
        }

        const tree = JSON.parse(await readBoundedResponseText(treeResponse, MAX_IMPORT_FILE_BYTES));
        return await findSkillInTree(owner, repo, tree, skillName, 'main');
      } catch (e) {
        console.error('[Skills Import] API search failed:', e);
        return null;
      }
    }

    // Find skill in GitHub tree by parsing SKILL.md files
    async function findSkillInTree(owner, repo, tree, skillName, branch) {
      const skillMdFiles = tree.tree.filter((item) => item.path && item.path.endsWith('SKILL.md'));

      for (const file of skillMdFiles) {
        try {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
          const response = await fetch(rawUrl);
          if (!response.ok) continue;

          const content = await readSkillMarkdown(response);
          if (!content) continue;

          // Parse frontmatter to get skill name
          const nameMatch = content.match(/^---\s*\n[\s\S]*?name:\s*(.+?)\s*\n/);
          if (nameMatch) {
            const foundName = nameMatch[1].trim().replace(/^["']|["']$/g, '');
            if (foundName === skillName || foundName.toLowerCase() === skillName.toLowerCase()) {
              console.log(`[Skills Import] Found skill via API: ${file.path} (name: ${foundName})`);
              return { skillMd: content, url: rawUrl };
            }
          }
        } catch {
          // Continue to next file
        }
      }

      return null;
    }

    // Find Skills button - opens skills.sh in new tab
    findBtn.addEventListener('click', () => {
      window.open('https://skills.sh', '_blank');
    });

    // Import button handler
    importBtn.addEventListener('click', async () => {
      const url = urlInput.value.trim();
      if (!url) {
        statusEl.textContent = 'Please enter a skills.sh URL';
        return;
      }

      // Parse skills.sh URL: https://skills.sh/{owner}/{repo}/{skill-name}
      // Also support: https://skills.sh/{owner}/{repo}/{skill-name}/
      const urlMatch = url.match(/^https?:\/\/skills\.sh\/([^/]+)\/([^/]+)\/([^/]+)\/?$/);
      if (!urlMatch) {
        statusEl.textContent = 'Invalid URL format. Use: https://skills.sh/owner/repo/skill-name';
        return;
      }

      const [, owner, repo, skillName] = urlMatch;

      // Show loading state
      importBtn.disabled = true;
      importBtn.innerHTML =
        '<span class="material-symbols-outlined sync-spin">sync</span> Importing...';
      statusEl.textContent = 'Fetching skill from GitHub...';

      try {
        // Fetch skill with multiple path/branch fallback strategies
        const fetchResult = await fetchSkillFromGitHub(owner, repo, skillName);

        if (!fetchResult) {
          throw new Error(
            `Skill "${skillName}" not found in ${owner}/${repo}. The skill may be in a different location or use a different name.`
          );
        }

        const { skillMd } = fetchResult;

        statusEl.textContent = 'Found skill, saving...';

        // Parse the skill markdown
        const parsed = parseSkillMarkdown(skillMd);
        if (!parsed.valid) {
          throw new Error(`Invalid SKILL.md: ${parsed.error}`);
        }

        // Check for duplicate
        const customSkillsResult = await new Promise((resolve) => {
          chrome.storage.local.get(['customSkills'], resolve);
        });
        const existingCustomSkills = (
          Array.isArray(customSkillsResult.customSkills) ? customSkillsResult.customSkills : []
        )
          .map(normalizeStoredSkill)
          .filter(Boolean)
          .slice(0, MAX_IMPORTED_RECORDS);
        const existingIndex = existingCustomSkills.findIndex(
          (s) => s.name === parsed.metadata.name
        );

        if (existingIndex > -1) {
          const overwrite = confirm(`Skill '${parsed.metadata.name}' already exists. Overwrite?`);
          if (!overwrite) {
            resetButton();
            return;
          }
        }

        // Save the skill
        const newSkill = {
          name: parsed.metadata.name,
          skillMd: skillMd,
          lastUpdated: new Date().toISOString(),
        };

        if (existingIndex > -1) {
          existingCustomSkills[existingIndex] = newSkill;
        } else {
          existingCustomSkills.push(newSkill);
        }

        await setChromeStorage(chrome.storage.local, {
          customSkills: existingCustomSkills.slice(0, MAX_IMPORTED_RECORDS),
        });

        statusEl.innerHTML =
          '<span class="ext-text-primary">✓ Successfully imported "' +
          escapeHtml(parsed.metadata.name) +
          '"</span>';
        urlInput.value = '';
        loadSkills(); // Reload the skills table

        setTimeout(() => {
          statusEl.textContent = '';
        }, 3000);
      } catch (error) {
        statusEl.textContent = `Error: ${error?.message || 'Could not import the skill.'}`;
      } finally {
        resetButton();
      }

      function resetButton() {
        importBtn.disabled = false;
        importBtn.innerHTML = '<span class="material-symbols-outlined">add</span> Import';
      }
    });

    // Enter key to import
    urlInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        importBtn.click();
      }
    });
  }

  // Initialize skills.sh import
  setupSkillsShImport();

  // Initial load
  loadSkills();
}
