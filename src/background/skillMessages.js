/**
 * @fileoverview Runtime message handling for built-in and user skills.
 * @module skillMessages
 */

/** Route skill lookup messages using the background-owned skill manager. */
export function handleSkillMessage(request, sender, dependencies) {
  const { extensionPageSender, rejectUnauthorizedMessage, sendResponse, skillManager } =
    dependencies;

  if (request.action === 'getSkills') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse);
    }
    const skillsList = skillManager.getSkillsList();
    const slashCommands = skillManager.getSlashCommands();
    sendResponse({ skills: skillsList, slashCommands });
    return true;
  }

  if (request.action === 'getSkillContent') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse);
    }
    skillManager
      .getSkillContent(request.name)
      .then((content) => {
        sendResponse({ content });
      })
      .catch((error) => {
        sendResponse({ error: error.message });
      });
    return true;
  }

  if (request.action === 'resolveSkill') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse);
    }
    const resolved = skillManager.resolveSkill(request.name);
    sendResponse({ skill: resolved });
    return true;
  }

  if (request.action === 'getSkillSnapshot') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse);
    }
    const snapshot = skillManager.getEligibleSnapshot();
    const promptText = skillManager.formatForPrompt();
    sendResponse({ snapshot, promptText });
    return true;
  }

  return null;
}
