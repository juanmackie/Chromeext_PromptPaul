/**
 * @fileoverview Runtime message handling for provider accounts and connections.
 * @module providerMessages
 */

/** Route provider account messages using injected platform and credential dependencies. */
export function handleProviderMessage(request, sender, dependencies) {
  const {
    chrome,
    codexAuthManager,
    extensionPageSender,
    fetchAvailableModels,
    getHermesCredential,
    getHermesEndpoint,
    hermesSessionResetLock,
    hermesTransport,
    removeHermesCredential,
    removeProfileHermesState,
    rejectUnauthorizedMessage,
    runOrchestrator,
    sendResponse,
    setHermesCredential,
    supportsHermesClientTools,
    validateHermesKey,
  } = dependencies;

  if (request.action === 'codexAuthStatus') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse);
    }
    codexAuthManager
      .getAuthStatus(request.profileId)
      .then((status) => sendResponse({ success: true, status }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'getAvailableModels') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse);
    }
    chrome.storage.local.get(['profiles'], (result) => {
      const profile = (result.profiles || []).find((entry) => entry.id === request.profileId);
      if (!profile) {
        sendResponse({ success: false, error: 'The selected profile was not found.' });
        return;
      }
      const authPromise =
        profile.provider === 'codex'
          ? codexAuthManager.getValidAuth(profile.id)
          : Promise.resolve(null);
      authPromise
        .then((auth) =>
          fetchAvailableModels({
            profile,
            auth,
            clientVersion: chrome.runtime.getManifest()?.version || '0.0.0',
          })
        )
        .then((models) => sendResponse({ success: true, models }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
    });
    return true;
  }

  if (request.action === 'codexLoginStart') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse);
    }
    codexAuthManager
      .startLogin(request.profileId)
      .then((login) => sendResponse({ success: true, login }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'codexLoginPoll') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse);
    }
    codexAuthManager
      .pollLogin(request.profileId)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'codexLogout') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse);
    }
    codexAuthManager
      .logout(request.profileId)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'testHermesConnection') {
    if (!extensionPageSender) {
      sendResponse({
        success: false,
        error: 'Hermes connection tests must come from Prompt Paul.',
      });
      return true;
    }
    chrome.storage.local
      .get(['profiles'])
      .then(async ({ profiles = [] }) => {
        const profile = profiles.find((entry) => entry.id === request.profileId);
        if (!profile || profile.provider !== 'hermes') {
          throw new Error('Save the selected profile as Hermes before testing the connection.');
        }
        const result = await hermesTransport.checkConnection({
          ...profile,
          hermesEndpoint: getHermesEndpoint(profile),
        });
        sendResponse({
          success: true,
          result: {
            healthy: true,
            healthWarning: result?.healthWarning || null,
            capabilityCount:
              result?.capabilities && typeof result.capabilities === 'object'
                ? Object.keys(result.capabilities).length
                : 0,
            clientToolsAvailable: supportsHermesClientTools(result?.capabilities),
          },
        });
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'hermesKeyStatus') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse);
    }
    const profileId = typeof request.profileId === 'string' ? request.profileId : '';
    getHermesCredential(profileId)
      .then((key) => sendResponse({ success: true, configured: Boolean(key) }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'hermesKeySet') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse);
    }
    const profileId = typeof request.profileId === 'string' ? request.profileId : '';
    if (!profileId) {
      sendResponse({ success: false, error: 'A Hermes profile is required.' });
      return true;
    }
    const validation = validateHermesKey(request.value);
    if (!validation.ok) {
      sendResponse({ success: false, error: validation.error });
      return true;
    }
    setHermesCredential(profileId, validation.value)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'hermesKeyRemove') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse);
    }
    const profileId = typeof request.profileId === 'string' ? request.profileId : '';
    if (!profileId) {
      sendResponse({ success: false, error: 'A Hermes profile is required.' });
      return true;
    }
    removeHermesCredential(profileId)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'hermesProfileDeleted') {
    if (!extensionPageSender) {
      return rejectUnauthorizedMessage(sendResponse);
    }
    const profileId = typeof request.profileId === 'string' ? request.profileId : '';
    if (!profileId) {
      sendResponse({ success: false, error: 'A Hermes profile is required.' });
      return true;
    }
    removeProfileHermesState(profileId, chrome)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'endHermesConversation') {
    if (!extensionPageSender) {
      sendResponse({ success: false, error: 'Hermes chat resets must come from Prompt Paul.' });
      return true;
    }

    const profileId = typeof request.profileId === 'string' ? request.profileId : '';
    if (!profileId) {
      sendResponse({ success: false, error: 'A Hermes profile is required.' });
      return true;
    }

    const resetPromise = hermesSessionResetLock.tryRun(profileId, async () => {
      const { profiles = [] } = await chrome.storage.local.get(['profiles']);
      const profile = profiles.find((entry) => entry.id === profileId);
      if (!profile || profile.provider !== 'hermes') {
        throw new Error('The selected Hermes profile was not found.');
      }

      const activeHermesRun = [...runOrchestrator.activeRuns.values()].some(
        (run) => run.config?.provider === 'hermes' && run.config?.profileId === profileId
      );
      if (activeHermesRun) {
        throw new Error('Stop the active Hermes response before starting a new chat.');
      }

      const sessionId = await hermesTransport.getStoredSession(profileId);
      if (sessionId) {
        await hermesTransport.endSession(
          {
            ...profile,
            hermesEndpoint: getHermesEndpoint(profile),
          },
          sessionId
        );
      }
      await hermesTransport.clearStoredSession(profileId);
      return { endedSession: Boolean(sessionId) };
    });
    if (!resetPromise) {
      sendResponse({ success: false, error: 'A Hermes chat reset is already in progress.' });
      return true;
    }
    resetPromise
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  return null;
}
