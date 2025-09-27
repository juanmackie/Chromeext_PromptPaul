// ===== Comprehensive Test File for Chrome Extension Issues =====

// This test file will verify all the issues mentioned:
// 1. Dark theme toggle functionality
// 2. Missing API key handling
// 3. Model name configuration
// 4. Other functionality issues

console.log('=== Starting Comprehensive Extension Test ===');

// Test 1: Dark Theme Toggle
async function testDarkThemeToggle() {
    console.log('\n--- Test 1: Dark Theme Toggle ---');
    
    try {
        // Check if themeUtils.js is properly loaded
        if (typeof setupThemeToggle !== 'function') {
            console.error('❌ setupThemeToggle function not found');
            return false;
        }
        
        // Check if dark theme toggle element exists
        const darkThemeToggle = document.getElementById('darkThemeToggle');
        if (!darkThemeToggle) {
            console.error('❌ Dark theme toggle element not found');
            return false;
        }
        
        // Test theme application
        const isDark = darkThemeToggle.checked;
        
        // Check if CSS variables are properly applied
        const root = document.documentElement;
        const currentTheme = root.getAttribute('data-theme');
        
        console.log(`✅ Current theme: ${currentTheme}`);
        console.log(`✅ Toggle state: ${isDark}`);
        
        // Test theme icon
        const icon = document.getElementById('darkThemeIcon');
        if (icon) {
            console.log(`✅ Theme icon found: ${icon.textContent}`);
        }
        
        return true;
    } catch (error) {
        console.error('❌ Dark theme toggle test failed:', error);
        return false;
    }
}

// Test 2: API Key Configuration
async function testApiKeyConfiguration() {
    console.log('\n--- Test 2: API Key Configuration ---');
    
    try {
        // Check if API key input exists
        const apiKeyInput = document.getElementById('apiKey');
        if (!apiKeyInput) {
            console.error('❌ API key input element not found');
            return false;
        }
        
        // Check if API key is stored
        const result = await new Promise(resolve => {
            chrome.storage.local.get(['profiles'], resolve);
        });
        
        const profiles = result.profiles || [];
        const defaultProfile = profiles.find(p => p.id === 'default');
        
        if (!defaultProfile) {
            console.error('❌ Default profile not found');
            return false;
        }
        
        const apiKey = defaultProfile.apiKey;
        if (!apiKey) {
            console.error('❌ API key not configured in default profile');
            return false;
        }
        
        console.log(`✅ API key found: ${apiKey.substring(0, 8)}...`);
        console.log(`✅ API key input value: ${apiKeyInput.value ? 'Set' : 'Empty'}`);
        
        // Check if current API key display is working
        const currentApiKey = document.getElementById('currentApiKey');
        if (currentApiKey) {
            console.log(`✅ Current API key display: ${currentApiKey.textContent}`);
        }
        
        return true;
    } catch (error) {
        console.error('❌ API key configuration test failed:', error);
        return false;
    }
}

// Test 3: Model Name Configuration
async function testModelNameConfiguration() {
    console.log('\n--- Test 3: Model Name Configuration ---');
    
    try {
        // Check if model name input exists
        const modelNameInput = document.getElementById('modelName');
        if (!modelNameInput) {
            console.error('❌ Model name input element not found');
            return false;
        }
        
        // Check if model name is stored
        const result = await new Promise(resolve => {
            chrome.storage.local.get(['profiles'], resolve);
        });
        
        const profiles = result.profiles || [];
        const defaultProfile = profiles.find(p => p.id === 'default');
        
        if (!defaultProfile) {
            console.error('❌ Default profile not found');
            return false;
        }
        
        const modelName = defaultProfile.modelName;
        if (!modelName) {
            console.error('❌ Model name not configured in default profile');
            return false;
        }
        
        console.log(`✅ Model name found: ${modelName}`);
        console.log(`✅ Model name input value: ${modelNameInput.value}`);
        
        // Check if current model name display is working
        const currentModelName = document.getElementById('currentModelName');
        if (currentModelName) {
            console.log(`✅ Current model name display: ${currentModelName.textContent}`);
        }
        
        return true;
    } catch (error) {
        console.error('❌ Model name configuration test failed:', error);
        return false;
    }
}

// Test 4: API Endpoint Configuration
async function testApiEndpointConfiguration() {
    console.log('\n--- Test 4: API Endpoint Configuration ---');
    
    try {
        // Check if endpoint input exists
        const endpointInput = document.getElementById('llmEndpoint');
        if (!endpointInput) {
            console.error('❌ API endpoint input element not found');
            return false;
        }
        
        // Check if endpoint is stored
        const result = await new Promise(resolve => {
            chrome.storage.local.get(['profiles'], resolve);
        });
        
        const profiles = result.profiles || [];
        const defaultProfile = profiles.find(p => p.id === 'default');
        
        if (!defaultProfile) {
            console.error('❌ Default profile not found');
            return false;
        }
        
        const endpoint = defaultProfile.llmEndpoint;
        if (!endpoint) {
            console.error('❌ API endpoint not configured in default profile');
            return false;
        }
        
        console.log(`✅ API endpoint found: ${endpoint}`);
        console.log(`✅ API endpoint input value: ${endpointInput.value}`);
        
        // Check if current endpoint display is working
        const currentEndpoint = document.getElementById('currentEndpoint');
        if (currentEndpoint) {
            console.log(`✅ Current endpoint display: ${currentEndpoint.textContent}`);
        }
        
        return true;
    } catch (error) {
        console.error('❌ API endpoint configuration test failed:', error);
        return false;
    }
}

// Test 5: Profile Management
async function testProfileManagement() {
    console.log('\n--- Test 5: Profile Management ---');
    
    try {
        // Check if profile dropdown exists
        const profileSelect = document.getElementById('profileSelect');
        if (!profileSelect) {
            console.error('❌ Profile dropdown element not found');
            return false;
        }
        
        // Check if profiles are stored
        const result = await new Promise(resolve => {
            chrome.storage.local.get(['profiles', 'lastSelectedProfileId'], resolve);
        });
        
        const profiles = result.profiles || [];
        const lastSelectedProfileId = result.lastSelectedProfileId || 'default';
        
        console.log(`✅ Found ${profiles.length} profiles`);
        console.log(`✅ Last selected profile: ${lastSelectedProfileId}`);
        
        // Check if default profile exists
        const defaultProfile = profiles.find(p => p.id === 'default');
        if (!defaultProfile) {
            console.error('❌ Default profile not found');
            return false;
        }
        
        console.log(`✅ Default profile found: ${defaultProfile.name}`);
        
        return true;
    } catch (error) {
        console.error('❌ Profile management test failed:', error);
        return false;
    }
}

// Test 6: Storage Functionality
async function testStorageFunctionality() {
    console.log('\n--- Test 6: Storage Functionality ---');
    
    try {
        // Test storage sync
        const testKey = 'test_comprehensive_key';
        const testValue = 'test_value_' + Date.now();
        
        // Save test data
        await new Promise(resolve => {
            chrome.storage.sync.set({ [testKey]: testValue }, resolve);
        });
        
        // Retrieve test data
        const result = await new Promise(resolve => {
            chrome.storage.sync.get([testKey], resolve);
        });
        
        if (result[testKey] !== testValue) {
            console.error('❌ Storage sync test failed');
            return false;
        }
        
        console.log(`✅ Storage sync test passed: ${result[testKey]}`);
        
        // Test storage local
        await new Promise(resolve => {
            chrome.storage.local.set({ [testKey]: testValue }, resolve);
        });
        
        const localResult = await new Promise(resolve => {
            chrome.storage.local.get([testKey], resolve);
        });
        
        if (localResult[testKey] !== testValue) {
            console.error('❌ Storage local test failed');
            return false;
        }
        
        console.log(`✅ Storage local test passed: ${localResult[testKey]}`);
        
        // Clean up
        await new Promise(resolve => {
            chrome.storage.sync.remove([testKey], resolve);
        });
        
        await new Promise(resolve => {
            chrome.storage.local.remove([testKey], resolve);
        });
        
        return true;
    } catch (error) {
        console.error('❌ Storage functionality test failed:', error);
        return false;
    }
}

// Test 7: Instructions Management
async function testInstructionsManagement() {
    console.log('\n--- Test 7: Instructions Management ---');
    
    try {
        // Check if instructions are stored
        const result = await new Promise(resolve => {
            chrome.storage.local.get(['instructions'], resolve);
        });
        
        const instructions = result.instructions || [];
        console.log(`✅ Found ${instructions.length} instructions`);
        
        // Check if instruction form elements exist
        const instructionName = document.getElementById('instructionName');
        const instructionContent = document.getElementById('instructionContent');
        
        if (!instructionName || !instructionContent) {
            console.error('❌ Instruction form elements not found');
            return false;
        }
        
        console.log(`✅ Instruction form elements found`);
        
        return true;
    } catch (error) {
        console.error('❌ Instructions management test failed:', error);
        return false;
    }
}

// Test 8: Tools Management
async function testToolsManagement() {
    console.log('\n--- Test 8: Tools Management ---');
    
    try {
        // Check if tools are stored
        const result = await new Promise(resolve => {
            chrome.storage.local.get(['promptPaulTools'], resolve);
        });
        
        const tools = result.promptPaulTools || [];
        console.log(`✅ Found ${tools.length} tools`);
        
        // Check if tool form elements exist
        const toolName = document.getElementById('toolName');
        const toolDescription = document.getElementById('toolDescription');
        
        if (!toolName || !toolDescription) {
            console.error('❌ Tool form elements not found');
            return false;
        }
        
        console.log(`✅ Tool form elements found`);
        
        return true;
    } catch (error) {
        console.error('❌ Tools management test failed:', error);
        return false;
    }
}

// Test 9: MCP Integration
async function testMcpIntegration() {
    console.log('\n--- Test 9: MCP Integration ---');
    
    try {
        // Check if MCP system is available
        if (typeof createMcpSystem !== 'function') {
            console.error('❌ createMcpSystem function not found');
            return false;
        }
        
        // Check if MCP servers are stored
        const result = await new Promise(resolve => {
            chrome.storage.local.get(['mcpServers'], resolve);
        });
        
        const mcpServers = result.mcpServers || {};
        const serverCount = Object.keys(mcpServers).length;
        
        console.log(`✅ Found ${serverCount} MCP servers`);
        
        // Check if MCP UI elements exist
        const mcpServersTable = document.getElementById('mcpServersTable');
        const mcpAddServerBtn = document.getElementById('mcpAddServerBtn');
        
        if (!mcpServersTable || !mcpAddServerBtn) {
            console.error('❌ MCP UI elements not found');
            return false;
        }
        
        console.log(`✅ MCP UI elements found`);
        
        return true;
    } catch (error) {
        console.error('❌ MCP integration test failed:', error);
        return false;
    }
}

// Test 10: Analytics Configuration
async function testAnalyticsConfiguration() {
    console.log('\n--- Test 10: Analytics Configuration ---');
    
    try {
        // Check if analytics toggle exists
        const analyticsToggle = document.getElementById('analyticsConsentToggle');
        if (!analyticsToggle) {
            console.error('❌ Analytics toggle element not found');
            return false;
        }
        
        // Check if analytics consent is stored
        const result = await new Promise(resolve => {
            chrome.storage.local.get(['analyticsConsent'], resolve);
        });
        
        const consent = result.analyticsConsent !== false; // Default to true
        console.log(`✅ Analytics consent: ${consent}`);
        console.log(`✅ Analytics toggle state: ${analyticsToggle.checked}`);
        
        return true;
    } catch (error) {
        console.error('❌ Analytics configuration test failed:', error);
        return false;
    }
}

// Main test runner
async function runAllTests() {
    console.log('\n=== Running All Tests ===');
    
    const tests = [
        testDarkThemeToggle,
        testApiKeyConfiguration,
        testModelNameConfiguration,
        testApiEndpointConfiguration,
        testProfileManagement,
        testStorageFunctionality,
        testInstructionsManagement,
        testToolsManagement,
        testMcpIntegration,
        testAnalyticsConfiguration
    ];
    
    let passed = 0;
    let failed = 0;
    
    for (const test of tests) {
        try {
            const result = await test();
            if (result) {
                passed++;
            } else {
                failed++;
            }
        } catch (error) {
            console.error(`❌ Test failed with exception:`, error);
            failed++;
        }
    }
    
    console.log('\n=== Test Results Summary ===');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Success Rate: ${((passed / tests.length) * 100).toFixed(1)}%`);
    
    return { passed, failed, total: tests.length };
}

// Run tests if this file is loaded directly
if (typeof window !== 'undefined') {
    window.runComprehensiveTests = runAllTests;
    console.log('🧪 Comprehensive test suite loaded. Call runComprehensiveTests() to run all tests.');
}

export { runAllTests };
