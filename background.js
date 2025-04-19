// Add these at the top of your file
const SHARED_LINKS_API = "https://api.npoint.io/f6d8ee7ad89c35402cd2";
let userId = 'anonymous'; // Default value until we get from storage

// Ensure we're using available storage
const storage = chrome.storage.sync || chrome.storage.local;

// Ensure service worker activates properly
self.addEventListener('activate', event => {
  console.log('Service worker activated');
});

// MOVE all initialization code inside the onInstalled listener
chrome.runtime.onInstalled.addListener(() => {
  console.log("Link Library extension installed/updated");
  testApiEndpoint(); // Add this line to test API on install
  
  // Call updateCategoriesFromDefaultFile
  updateCategoriesFromDefaultFile(); // Add this line
  
  // NOW get the user ID
  storage.get(['userId'], function(result) {
    if (!result || !result.userId) {
      userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      storage.set({ userId: userId });
    } else {
      userId = result.userId;
    }
    console.log("User ID:", userId);
    
    // Initial data synchronization (only after we have userId)
    synchronizeLinks();
  });
  
  // Set up periodic sync (every 1 minute)
  if (chrome.alarms) {
    chrome.alarms.create('syncLinks', { periodInMinutes: 1 });
  }
  
  // Call loadDefaultData
  loadDefaultData();

  // Call checkStorageContents after loading data
  checkStorageContents();
});

// Listen for alarms
if (chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'syncLinks') {
      synchronizeLinks();
    }
  });
}

// Better error handling for all API calls
function safeExecute(apiCall, fallback = {}) {
  try {
    return apiCall();
  } catch (e) {
    console.error('API Error:', e);
    return fallback;
  }
}

// Update your synchronizeLinks function to handle API failures
async function synchronizeLinks() {
  try {
    console.log("Starting link synchronization...");
    
    // Try to fetch shared links
    let sharedLinks = [];
    try {
      sharedLinks = await fetchSharedLinks() || [];
      console.log("Fetched shared links:", sharedLinks.length);
    } catch (apiError) {
      console.error("API fetch error:", apiError);
      // Continue with empty shared links
    }
    
    // Check if we have any links
    if (!sharedLinks || sharedLinks.length === 0) {
      console.log("No shared links found or API not accessible");
      
      // Check if we need to load defaults
      await new Promise((resolve) => {
        storage.get(['links', 'initialized'], function(result) {
          const hasLinks = result.links && result.links.length > 0;
          
          if (!hasLinks) {
            console.log("No links in storage, loading from default_links.json");
            loadDefaultLinksFromFile().then(resolve);
          } else {
            console.log("Using existing links from storage");
            resolve();
          }
        });
      });
    } else {
      // We got links from API, save them
      await new Promise((resolve) => {
        storage.set({ 
          links: sharedLinks,
          initialized: true,
          lastSyncTime: new Date().toISOString()
        }, function() {
          console.log("Saved shared links from API");
          resolve();
        });
      });
    }
    
    // Notify any open popups
    safelyNotifyPopups({ action: 'linksUpdated' });
    
    return { success: true };
  } catch (error) {
    console.error("Synchronization error:", error);
    return { success: false, error: error.toString() };
  }
}

// Replace your fetchSharedLinks function with this one
async function fetchSharedLinks() {
  console.log("Fetching shared links from API...");
  
  try {
    // Add cache-busting parameter to prevent caching
    const response = await fetch(SHARED_LINKS_API + "?cachebust=" + Date.now());
    
    if (!response.ok) {
      throw new Error(`Error fetching shared links: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log("JSON data received:", data);
    
    // Check for both possible structures: links or adminLinks
    const links = Array.isArray(data.links) ? data.links : 
                 (Array.isArray(data.adminLinks) ? data.adminLinks : []);
    
    console.log("Found links in API response:", links.length);
    
    // Ensure all links have isShared flag
    const processedLinks = links.map(link => ({
      ...link,
      isShared: true,
      id: link.id || 'shared_' + Math.random().toString(36).substring(2, 9)
    }));
    
    console.log("Processed shared links:", processedLinks.length);
    return processedLinks;
  } catch (error) {
    console.error("Error fetching shared links:", error);
    return [];
  }
}

// Add this new function to load default links from file
async function loadDefaultLinksFromFile() {
  try {
    // Try to load default_links.json
    const response = await fetch(chrome.runtime.getURL('default_links.json'));
    const defaultData = await response.json();
    
    const adminLinks = defaultData.adminLinks || [];
    const categories = defaultData.categories || [
      '2D', '3D', 'Maps', 'Vision', 'Logs review & Stereo', 
      'Automation', 'PDA', 'Down selection', 'Other'
    ];
    
    console.log("Loaded default data:", {
      links: adminLinks.length,
      categories: categories.length
    });
    
    // Save to storage
    await new Promise((resolve) => {
      storage.set({
        links: adminLinks,
        categories: categories,
        initialized: true,
        lastUpdate: new Date().toISOString()
      }, function() {
        console.log("Default data saved to storage");
        resolve();
      });
    });
    
    return { success: true };
  } catch (error) {
    console.error("Error loading default links:", error);
    return { success: false, error: error.toString() };
  }
}

// Add this new function to handle sharing a link
async function shareUserLink(link) {
  try {
    console.log("Sharing link:", link);
    
    // Prepare link object for sharing
    const sharedLink = {
      id: 'shared_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
      title: link.title || '',
      url: link.url || '',
      category: link.category || 'Other',
      tags: Array.isArray(link.tags) ? link.tags : [],
      description: link.description || '',
      sharedBy: userId || 'anonymous',
      sharedAt: new Date().toISOString()
    };
    
    // Fetch current shared links
    const response = await fetch(SHARED_LINKS_API);
    if (!response.ok) {
      throw new Error(`Failed to fetch shared links: ${response.status}`);
    }
    
    const data = await response.json();
    const currentLinks = Array.isArray(data.links) ? data.links : [];
    
    // Add new link
    const updatedLinks = [...currentLinks, sharedLink];
    
    // Save back to API
    const updateResponse = await fetch(SHARED_LINKS_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ links: updatedLinks })
    });
    
    if (!updateResponse.ok) {
      throw new Error(`Failed to update shared links: ${updateResponse.status}`);
    }
    
    // Force a sync to update our local data
    await synchronizeLinks();
    
    return { success: true, message: "Link shared successfully" };
  } catch (error) {
    console.error("Error sharing link:", error);
    return { success: false, error: error.toString() };
  }
}

// Update the onMessage listener to handle shareUserLink
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  console.log("Background received message:", request.action);
  
  if (request.action === "shareLink") {
    shareUserLink(request.link)
      .then(response => {
        sendResponse(response);
      })
      .catch(error => {
        sendResponse({ success: false, error: error.toString() });
      });
    return true; // Async response
  }
  
  if (request.action === "forceSync") {
    console.log("Force sync requested");
    synchronizeLinks()
      .then(response => {
        console.log("Sync complete:", response);
        sendResponse(response);
      })
      .catch(error => {
        console.error("Sync error:", error);
        sendResponse({ 
          success: false, 
          error: error.toString() 
        });
      });
    return true; // Async response
  }
  
  if (request.action === "getCurrentTab") {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0]) {
        sendResponse({
          url: tabs[0].url,
          title: tabs[0].title
        });
      }
    });
    return true; // Required for async sendResponse
  }
  
  if (request.action === "resetToDefaults") {
    // Get categories from default_links.json first
    fetch(chrome.runtime.getURL('default_links.json'))
      .then(response => response.json())
      .then(data => {
        const defaultCategories = data.categories || ['2D', '3D', 'Maps', 'Vision', 'Logs review & Stereo', 'Automation', 'PDA', 'Down selection', 'Other'];
        const defaultLinks = data.adminLinks || [];
        
        // Update with ALL categories and links
        storage.set({
          links: defaultLinks,
          categories: defaultCategories, // Use ALL categories
          initialized: true,
          lastUpdate: new Date().toISOString()
        }, function() {
          console.log("Reset to defaults completed with categories:", defaultCategories);
          sendResponse({success: true});
          
          // Notify any open popups
          safelyNotifyPopups({ action: 'linksUpdated' });
        });
      })
      .catch(error => {
        console.error("Error resetting to defaults:", error);
        sendResponse({success: false, error: error.toString()});
      });
    
    return true; // Keep message channel open for async response
  }

  if (request.action === 'manualSync') {
    synchronizeLinks()
      .then(result => {
        console.log("Manual sync result:", result);
        sendResponse(result);
      })
      .catch(error => {
        console.error("Manual sync error:", error);
        sendResponse({success: false, error: error.toString()});
      });
    return true; // Keep message channel open for async response
  }

  if (request.action === 'getApiUrl') {
    sendResponse({ apiUrl: SHARED_LINKS_API });
    return true;
  }
  
  return false;
});

// Replace your current loadDefaultData function with this improved version
function loadDefaultData() {
  console.log("Loading default data...");
  
  storage.get(['initialized', 'links'], function(result) {
    const isInitialized = result && result.initialized;
    const hasLinks = result.links && result.links.length > 0;
    
    console.log("Initialization check:", {initialized: isInitialized, hasLinks: hasLinks});
    
    // Always load default data if no links are present
    if (!isInitialized || !hasLinks) {
      console.log("Loading default links from file...");
      
      // Use the fetch API to load the default_links.json file
      fetch(chrome.runtime.getURL('default_links.json'))
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to load default_links.json: ${response.status}`);
          }
          return response.json();
        })
        .then(data => {
          console.log("Default links loaded:", data);
          
          if (!data || !data.adminLinks || !Array.isArray(data.adminLinks)) {
            throw new Error("Invalid default_links.json format");
          }
          
          // Set the default data in storage
          storage.set({
            links: data.adminLinks || [],
            categories: data.categories || ['2D', '3D', 'Maps', 'Vision', 'Other'],
            initialized: true,
            lastUpdate: new Date().toISOString()
          }, function() {
            console.log("Default data saved to storage:", {
              links: data.adminLinks.length,
              categories: data.categories ? data.categories.length : 0
            });
            
            // Force a UI refresh if popup is open
            safelyNotifyPopups({ action: 'linksUpdated' });
          });
        })
        .catch(error => {
          console.error("Error loading default data:", error);
          
          // Fallback to hardcoded defaults if file load fails
          const defaultLinks = [
            {
              id: "admin_1",
              title: "MDN Web Documentation",
              url: "https://developer.mozilla.org",
              category: "2D",
              tags: ["documentation", "web", "javascript"],
              description: "Comprehensive web development documentation"
            },
            {
              id: "admin_2",
              title: "GitHub",
              url: "https://github.com",
              category: "Other",
              tags: ["code", "repository", "git"],
              description: "Host and review code, manage projects"
            }
          ];
          
          storage.set({
            links: defaultLinks,
            categories: ['2D', '3D', 'Maps', 'Vision', 'Other'],
            initialized: true,
            lastUpdate: new Date().toISOString()
          }, function() {
            console.log("Fallback data saved to storage");
          });
        });
    }
  });
}

// Add this to your background.js for a one-time check
(function validateDefaultLinks() {
  fetch(chrome.runtime.getURL('default_links.json'))
    .then(response => response.text())
    .then(text => {
      try {
        const data = JSON.parse(text);
        console.log("default_links.json is valid JSON");
        console.log("Contains:", {
          adminLinks: data.adminLinks ? data.adminLinks.length : 0,
          categories: data.categories ? data.categories.length : 0
        });
      } catch (e) {
        console.error("default_links.json is NOT valid JSON:", e);
        console.error("First 100 characters:", text.substring(0, 100));
      }
    })
    .catch(e => console.error("Could not load default_links.json:", e));
})();

console.log("Background script loaded");

// Create a link element with proper event handlers
function createLinkElement(link, searchTerm = '') {
    const linkElement = document.createElement('div');
    linkElement.className = 'link-item';
    linkElement.dataset.id = link.id; // Store ID in the element
    
    // Apply special styling based on link type
    if (link.adminId) {
        linkElement.classList.add('admin-link');
    }
    
    if (link.isShared) {
        linkElement.classList.add('shared-link');
    }
    
    // Create the clickable link
    const linkAnchor = document.createElement('a');
    linkAnchor.href = link.url;
    linkAnchor.className = 'link-title';
    linkAnchor.target = '_blank';
    linkAnchor.textContent = link.title || link.url;
    
    // Create the actions container
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'link-actions';
    
    // For shared links or admin links, show a badge and copy button
    if (link.isShared || link.adminId) {
        // Add visual indicator
        const badge = document.createElement('span');
        badge.className = link.isShared ? 'shared-badge' : 'admin-badge';
        badge.textContent = link.isShared ? 'Shared' : 'Admin';
        
        const copyButton = document.createElement('button');
        copyButton.className = 'copy-link';
        copyButton.textContent = 'Copy';
        copyButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            navigator.clipboard.writeText(link.url).then(() => {
                showNotification('Link copied to clipboard!', 'success');
            });
        });
        
        actionsDiv.appendChild(badge);
        actionsDiv.appendChild(copyButton);
    } else {
        // For user links, show edit and delete buttons
        const editButton = document.createElement('button');
        editButton.className = 'edit-link';
        editButton.textContent = 'Edit';
        editButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            editLink(link.id); // Call editLink with ID
        });
        
        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-link';
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            deleteLink(link.id); // Call deleteLink with ID
        });
        
        actionsDiv.appendChild(editButton);
        actionsDiv.appendChild(deleteButton);
    }
    
    // Append link and actions to the link element
    linkElement.appendChild(linkAnchor);
    linkElement.appendChild(actionsDiv);
    
    // Add description if available
    if (link.description) {
        const descriptionDiv = document.createElement('div');
        descriptionDiv.className = 'link-description';
        descriptionDiv.textContent = link.description;
        linkElement.appendChild(descriptionDiv);
    }
    
    // Add tags if any
    if (link.tags && link.tags.length > 0) {
        const tagsDiv = document.createElement('div');
        tagsDiv.className = 'link-tags';
        
        link.tags.forEach(tag => {
            const tagSpan = document.createElement('span');
            tagSpan.className = 'tag';
            tagSpan.textContent = tag;
            tagsDiv.appendChild(tagSpan);
        });
        
        linkElement.appendChild(tagsDiv);
    }
    
    // Highlight search term if provided
    if (searchTerm && searchTerm.length > 0) {
        // Your existing highlighting code
    }
    
    return linkElement;
}

// Edit a link
function editLink(linkId) {
    console.log("Editing link:", linkId);
    
    if (!linkId) {
        showNotification("Cannot edit: Invalid link ID", "error");
        return;
    }
    
    // Get the link data from storage
    storage.get(['userLinks'], function(result) {
        const userLinks = result.userLinks || [];
        const linkIndex = userLinks.findIndex(link => link.id === linkId);
        
        if (linkIndex === -1) {
            showNotification("Link not found", "error");
            return;
        }
        
        const link = userLinks[linkIndex];
        console.log("Found link to edit:", link);
        
        // Fill form with link data
        document.getElementById('link-title').value = link.title || '';
        document.getElementById('link-url').value = link.url || '';
        document.getElementById('link-category').value = link.category || '';
        document.getElementById('link-description').value = link.description || '';
        document.getElementById('link-tags').value = link.tags ? link.tags.join(', ') : '';
        document.getElementById('link-id').value = link.id; // Store ID in hidden field
        
        // Switch to add tab
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-tab="add-tab"]').classList.add('active');
        document.getElementById('add-tab').classList.add('active');
        
        // Change button text
        document.getElementById('save-link').textContent = 'Update Link';
        
        // Focus on title field
        document.getElementById('link-title').focus();
    });
}

// Delete a link
function deleteLink(linkId) {
    console.log("Deleting link:", linkId);
    
    if (!linkId) {
        showNotification("Cannot delete: Invalid link ID", "error");
        return;
    }
    
    if (!confirm('Are you sure you want to delete this link?')) {
        return;
    }
    
    // Get the links from storage
    storage.get(['userLinks'], function(result) {
        const userLinks = result.userLinks || [];
        const linkIndex = userLinks.findIndex(link => link.id === linkId);
        
        if (linkIndex === -1) {
            showNotification("Link not found", "error");
            return;
        }
        
        // Remove the link
        userLinks.splice(linkIndex, 1);
        
        // Save updated links
        storage.set({ userLinks: userLinks }, function() {
            showNotification("Link deleted successfully", "success");
            loadLinks(); // Refresh the display
        });
    });
}

// Add this function to help debug API issues
function testApiEndpoint() {
  console.log("Testing API endpoint:", SHARED_LINKS_API);
  
  fetch(SHARED_LINKS_API + "?test=" + Date.now())
    .then(response => {
      console.log("API Response Status:", response.status);
      return response.text();
    })
    .then(text => {
      console.log("API Raw Response:", text.substring(0, 200) + (text.length > 200 ? "..." : ""));
      try {
        const data = JSON.parse(text);
        console.log("API Parsed Data:", data);
      } catch (e) {
        console.error("API Response is not valid JSON:", e);
      }
    })
    .catch(error => {
      console.error("API Fetch Error:", error);
    });
}

// Add this function to check what's actually in storage
function checkStorageContents() {
  storage.get(null, function(items) {
    console.log("STORAGE CONTENTS:");
    console.log("Links:", items.links ? items.links.length : 0);
    console.log("Categories:", items.categories);
    console.log("Sample links:", items.links ? items.links.slice(0, 2) : "none");
  });
}

// Add this function to specifically update categories
function updateCategoriesFromDefaultFile() {
  fetch(chrome.runtime.getURL('default_links.json'))
    .then(response => response.json())
    .then(data => {
      if (data && Array.isArray(data.categories) && data.categories.length > 0) {
        console.log("Found categories in default_links.json:", data.categories);
        
        // Update categories in storage
        storage.set({ categories: data.categories }, function() {
          console.log("Updated categories in storage:", data.categories);
          
          // Try to notify any open popups
          safelyNotifyPopups({ action: 'categoriesUpdated' });
        });
      } else {
        console.log("No valid categories found in default_links.json");
      }
    })
    .catch(error => {
      console.error("Error updating categories:", error);
    });
}

// Update how you send messages to handle this error
function safelyNotifyPopups(message) {
  try {
    chrome.runtime.sendMessage(message).catch(() => {
      // This is expected if popup is not open - ignore the error
    });
  } catch (e) {
    // Ignore the error
  }
}
