document.addEventListener('DOMContentLoaded', function() {
    // Initialize data structure if not exists
    chrome.storage.local.get(['links', 'categories'], function(result) {
        if (!result.links) {
            chrome.storage.local.set({links: []});
        }
        if (!result.categories) {
            // Initialize with all needed categories
            const defaultCategories = ['Automation', 'Down selection', 'Logs review & Stereo', 'Maps', 'Other', 'Vision', '2D', '3D'];
            chrome.storage.local.set({categories: defaultCategories});
        }
        
        // Load all categories first, then links
        loadAllCategories();
    });
    
    // Debug storage on load
    debugStorage();
    
    // Set up event listeners
    setupTabNavigation();
    setupThemeToggle();
    setupHelp();
    
    // Set up button click handlers - CHECK IF ELEMENTS EXIST FIRST
    const elements = {
        'add-link': addLink,
        'add-category': addCategory,
        'export-data': exportData,
        'import-data': importData,
        'sync-browser': syncBrowser,
        'cloud-backup': cloudBackup,
        'debug-storage': function() { debugStorage(); },
        'refresh-links': function() {
            this.disabled = true;
            this.textContent = "Refreshing...";
            
            // Clear existing API links to force re-fetch
            chrome.storage.local.get(['adminLinks', 'links'], function(data) {
                // Keep track of whether we had any links before
                const hadLinks = (data.adminLinks?.length > 0 || data.links?.length > 0);
                
                // Clear API links but keep user links
                chrome.storage.local.set({
                    adminLinks: [],
                    links: []
                }, function() {
                    // If we had links before, force API fetch
                    if (hadLinks) {
                        fetchApiLinks();
                    } else {
                        // Otherwise use background sync
                        chrome.runtime.sendMessage({action: 'manualSync'}, function(response) {
                            if (response && response.success) {
                                showNotification('Links refreshed successfully', 'success');
                                setTimeout(loadLinks, 500);
                            } else {
                                showNotification('Failed to refresh links', 'error');
                                // Try direct API fetch as fallback
                                fetchApiLinks();
                            }
                        });
                    }
                    
                    // Re-enable the button after a short delay
                    setTimeout(function() {
                        const refreshBtn = document.getElementById('refresh-links');
                        if (refreshBtn) {
                            refreshBtn.disabled = false;
                            refreshBtn.textContent = "Refresh Links";
                        }
                    }, 1000);
                });
            });
        },
        'reset-data': function() {
            if (confirm('Are you sure you want to reset to default links? This will remove any custom links.')) {
                chrome.runtime.sendMessage({action: 'resetToDefaults'}, function(response) {
                    if (response && response.success) {
                        showNotification('Reset to default links successfully!', 'success');
                        loadLinks();
                    } else {
                        showNotification('Failed to reset data', 'error');
                    }
                });
            }
        }
    };
    
    // Attach event listeners only to elements that exist
    Object.keys(elements).forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('click', elements[id]);
        } else {
            console.warn(`Element with id "${id}" not found`);
        }
    });
    
    // Set up search functionality - check if element exists
    const searchInput = document.getElementById('search');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(performInstantSearch, 150));
    }
    
    const filterCategory = document.getElementById('filter-category');
    if (filterCategory) {
        filterCategory.addEventListener('change', performInstantSearch);
    }
    
    // Listen for link updates from background
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.action === 'linksUpdated') {
            console.log('Links updated, refreshing view');
            loadLinks();
        }
    });

    // Add this handler for the check-links button
    const checkLinksBtn = document.getElementById('check-links');
    if (checkLinksBtn) {
        checkLinksBtn.addEventListener('click', function() {
            chrome.storage.local.get(null, function(data) {
                console.log("ALL STORAGE DATA:", data);
                
                const linksCount = data.links ? data.links.length : 0;
                const userLinksCount = data.userLinks ? data.userLinks.length : 0;
                
                alert(`Found ${linksCount} shared links and ${userLinksCount} user links`);
                showNotification(`Found ${linksCount} shared links and ${userLinksCount} user links`, "info");
            });
        });
    }
});

// Setup help functionality
function setupHelp() {
    const helpButton = document.getElementById('help-button');
    
    if (helpButton) {
        helpButton.addEventListener('click', function() {
            // Option 1: Open full tutorial page
            chrome.tabs.create({ url: 'tutorial.html' });
            
            // Option 2: Show quick help panel (uncomment to use this instead)
            // toggleQuickHelp();
        });
    }
    
    // Set up quick help panel (optional feature - implement if you want both options)
    setupQuickHelp();
}

// Set up quick help panel with rotating tips
function setupQuickHelp() {
    // Create quick help panel element if it doesn't exist
    if (!document.querySelector('.quick-help-panel')) {
        const quickHelpPanel = document.createElement('div');
        quickHelpPanel.className = 'quick-help-panel';
        quickHelpPanel.innerHTML = `
            <h4>
                <span>Quick Tip</span>
                <span class="close-help">×</span>
            </h4>
            <p class="help-tip-text">Loading tip...</p>
            <a class="open-full-help">View full guide</a>
        `;
        document.body.appendChild(quickHelpPanel);
        
        // Set up event listeners
        const closeHelp = quickHelpPanel.querySelector('.close-help');
        const openFullHelp = quickHelpPanel.querySelector('.open-full-help');
        
        if (closeHelp) {
            closeHelp.addEventListener('click', function() {
                quickHelpPanel.classList.remove('visible');
            });
        }
        
        if (openFullHelp) {
            openFullHelp.addEventListener('click', function() {
                chrome.tabs.create({ url: 'tutorial.html' });
            });
        }
    }
}

// Toggle quick help visibility with a random tip
function toggleQuickHelp() {
    const quickHelpPanel = document.querySelector('.quick-help-panel');
    const tipText = quickHelpPanel.querySelector('.help-tip-text');
    
    // Array of helpful tips
    const tips = [
        "Use descriptive titles for your links to make them easier to find.",
        "Add 3-5 relevant tags to improve search results.",
        "Organize similar links into the same category for better organization.",
        "Export your data regularly to create backups.",
        "Click on a category header to expand all links in that category.",
        "Use the search bar to quickly find links by title, URL, or tags.",
        "Add descriptions to your links to remember what they contain."
    ];
    
    // Show a random tip
    tipText.textContent = tips[Math.floor(Math.random() * tips.length)];
    
    // Toggle visibility
    quickHelpPanel.classList.toggle('visible');
}

// Debounce function to improve search performance
function debounce(func, delay) {
    let timeout;
    return function() {
        const context = this;
        const args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

// Tab navigation
function setupTabNavigation() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.getAttribute('data-tab');
            
            // Update active tab button
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Show selected tab content
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === `${tabName}-tab`) {
                    content.classList.add('active');
                }
            });
        });
    });
}

// Theme toggle
function setupThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle');
    const html = document.documentElement;
    
    // Check if theme toggle exists before using it
    if (!themeToggle) {
        console.warn("Theme switch element not found, skipping theme setup");
        return; // Exit the function gracefully
    }
    
    // Load saved theme preference
    chrome.storage.local.get(['darkMode'], function(result) {
        if (result.darkMode) {
            html.setAttribute('data-theme', 'dark');
            themeToggle.checked = true;
            document.querySelectorAll('.mode-text').forEach(el => {
                el.textContent = 'Light Mode';
            });
        }
    });
    
    // Toggle theme when the switch is clicked
    themeToggle.addEventListener('change', function() {
        if (this.checked) {
            html.setAttribute('data-theme', 'dark');
            chrome.storage.local.set({darkMode: true});
            document.querySelectorAll('.mode-text').forEach(el => {
                el.textContent = 'Light Mode';
            });
        } else {
            html.setAttribute('data-theme', 'light');
            chrome.storage.local.set({darkMode: false});
            document.querySelectorAll('.mode-text').forEach(el => {
                el.textContent = 'Dark Mode';
            });
        }
    });
}

// Update your addLink function to handle edits
function addLink() {
    const title = document.getElementById('link-title').value.trim();
    const url = document.getElementById('link-url').value.trim();
    const category = document.getElementById('category').value;
    const tags = document.getElementById('tags').value.trim()
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag !== '');
    
    if (!title || !url) {
        showNotification('Please enter both title and URL', 'error');
        return;
    }
    
    // Add http if not present
    let formattedUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        formattedUrl = 'https://' + url;
    }
    
    // Check if we're editing an existing link
    const addButton = document.getElementById('add-link');
    const isEditMode = addButton.dataset.editId;
    
    if (isEditMode) {
        // Update existing link
        chrome.storage.local.get(['links', 'userLinks'], function(result) {
            const links = result.links || [];
            const userLinks = result.userLinks || [];
            
            // First try to update in links array
            let linkUpdated = false;
            for (let i = 0; i < links.length; i++) {
                if (links[i].id == addButton.dataset.editId) {
                    links[i].title = title;
                    links[i].url = formattedUrl;
                    links[i].category = category;
                    links[i].tags = tags;
                    links[i].lastUpdated = new Date().toISOString();
                    linkUpdated = true;
                    break;
                }
            }
            
            // If not found in links, try userLinks
            if (!linkUpdated) {
                for (let i = 0; i < userLinks.length; i++) {
                    if (userLinks[i].id == addButton.dataset.editId) {
                        userLinks[i].title = title;
                        userLinks[i].url = formattedUrl;
                        userLinks[i].category = category;
                        userLinks[i].tags = tags;
                        userLinks[i].lastUpdated = new Date().toISOString();
                        linkUpdated = true;
                        break;
                    }
                }
            }
            
            // Save changes
            chrome.storage.local.set({
                links: links,
                userLinks: userLinks
            }, function() {
                clearForm();
                loadLinks();
                showNotification('Link updated successfully!', 'success');
                
                // Switch back to browse tab
                document.querySelectorAll('.tab-btn').forEach(btn => {
                    if (btn.getAttribute('data-tab') === 'browse') {
                        btn.click();
                    }
                });
            });
        });
    } else {
        // Add new link
        const newLink = {
            id: 'user_' + Date.now(),
            title: title,
            url: formattedUrl,
            category: category,
            tags: tags,
            dateAdded: new Date().toISOString()
        };
        
        // Get existing links and add new one
        chrome.storage.local.get(['userLinks'], function(result) {
            const userLinks = result.userLinks || [];
            userLinks.push(newLink);
            chrome.storage.local.set({userLinks: userLinks}, function() {
                clearForm();
                loadLinks();
                showNotification('Link added successfully!', 'success');
                
                // Switch back to browse tab
                document.querySelectorAll('.tab-btn').forEach(btn => {
                    if (btn.getAttribute('data-tab') === 'browse') {
                        btn.click();
                    }
                });
            });
        });
    }
}

// Add new category
function addCategory() {
    const newCategory = document.getElementById('new-category').value.trim();
    
    if (!newCategory) {
        showNotification('Please enter a category name', 'error');
        return;
    }
    
    chrome.storage.local.get(['categories'], function(result) {
        const categories = result.categories || [];
        
        // Check if category already exists
        if (categories.includes(newCategory)) {
            showNotification('Category already exists', 'error');
            return;
        }
        
        categories.push(newCategory);
        chrome.storage.local.set({categories: categories}, function() {
            document.getElementById('new-category').value = '';
            updateCategoryDropdowns(categories);
            showNotification('Category added!', 'success');
        });
    });
}

// Update category dropdowns
function updateCategoryDropdowns(categories) {
    const categorySelect = document.getElementById('category');
    const filterCategorySelect = document.getElementById('filter-category');
    
    // Save current selections
    const selectedCategory = categorySelect.value;
    const selectedFilter = filterCategorySelect.value;
    
    // Clear options except "All Categories" for filter
    while (categorySelect.options.length > 0) {
        categorySelect.remove(0);
    }
    
    while (filterCategorySelect.options.length > 1) {
        filterCategorySelect.remove(1);
    }
    
    // Add categories to both dropdowns
    categories.forEach(category => {
        categorySelect.add(new Option(category, category));
        filterCategorySelect.add(new Option(category, category));
    });
    
    // Restore selections if possible
    if (categories.includes(selectedCategory)) {
        categorySelect.value = selectedCategory;
    }
    
    if (selectedFilter === 'all' || categories.includes(selectedFilter)) {
        filterCategorySelect.value = selectedFilter;
    }
}

// NEW: Load only categories without displaying links
function loadCategoriesOnly() {
    chrome.storage.local.get(['links', 'categories'], function(result) {
        const links = result.links || [];
        const categories = result.categories || [];
        
        // Update category dropdowns
        updateCategoryDropdowns(categories);
        
        // Display only category headers without links
        displayCategoriesOnly(links, categories);
    });
}

// NEW: Display only category headers without links
function displayCategoriesOnly(links, categories) {
    const container = document.getElementById('categories-container');
    container.innerHTML = '';
    
    // Group links by category to get counts
    const linksByCategory = {};
    categories.forEach(category => {
        linksByCategory[category] = [];
    });
    
    // Add "Other" category if not exists
    if (!linksByCategory['Other']) {
        linksByCategory['Other'] = [];
    }
    
    // Group links by their categories
    links.forEach(link => {
        if (linksByCategory[link.category]) {
            linksByCategory[link.category].push(link);
        } else {
            // If category doesn't exist anymore, move to Other
            linksByCategory['Other'].push(link);
        }
    });
    
    // Create category sections
    Object.keys(linksByCategory).forEach(category => {
        const categoryLinks = linksByCategory[category];
        
        // Skip empty categories
        if (categoryLinks.length === 0) return;
        
        const categorySection = document.createElement('div');
        categorySection.className = 'category-section';
        categorySection.dataset.category = category;
        
        // Create category header
        const categoryHeader = document.createElement('div');
        categoryHeader.className = 'category-header';
        categoryHeader.innerHTML = `
            <span>${category}</span>
            <span class="link-count">${categoryLinks.length}</span>
        `;
        
        // Create links container but keep it empty initially
        const linksContainer = document.createElement('div');
        linksContainer.className = 'category-links';
        linksContainer.dataset.loaded = 'false';
        
        // Add empty message to prompt user to search
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'search-prompt';
        emptyMessage.textContent = 'Type in search box to find links';
        linksContainer.appendChild(emptyMessage);
        
        // Store link data for later search operations
        categorySection.dataset.links = JSON.stringify(categoryLinks);
        
        // Append elements to category section
        categorySection.appendChild(categoryHeader);
        categorySection.appendChild(linksContainer);
        
        // Add to main container
        container.appendChild(categorySection);
    });
    
    // Show message if no links
    if (links.length === 0) {
        container.innerHTML = '<p class="no-links">No links added yet. Add your first link!</p>';
    } else {
        // Add search prompt
        const searchPrompt = document.createElement('div');
        searchPrompt.className = 'search-instruction';
        searchPrompt.innerHTML = '<p>Start typing to search through your links</p>';
        container.prepend(searchPrompt);
    }
}

// MODIFIED: Instant Search functionality
function performInstantSearch() {
    const searchInput = document.getElementById('search');
    const filterCategory = document.getElementById('filter-category');
    
    if (!searchInput) {
        console.error('Search input not found');
        return;
    }
    
    const searchTerm = searchInput.value.toLowerCase().trim();
    const categoryFilter = filterCategory ? filterCategory.value : 'all';
    
    console.log("Performing search:", {term: searchTerm, category: categoryFilter});
    
    // Get storage
    const storage = chrome.storage.sync || chrome.storage.local;
    
    storage.get(['links', 'userLinks', 'categories'], function(result) {
        const sharedLinks = result.links || [];
        const userLinks = result.userLinks || [];
        const categories = result.categories || [];
        
        // Choose which links to display
        const allLinks = [...sharedLinks, ...userLinks];
        
        // If no search term and no category filter (or "all" selected), show normal view
        if (!searchTerm && (categoryFilter === 'all')) {
            loadLinks(); // Reset to normal view
            return;
        }
        
        // Group links by category for display
        const linksByCategory = {};
        
        // Initialize all categories
        categories.forEach(category => {
            linksByCategory[category] = [];
        });
        
        // Ensure "Other" category exists
        if (!linksByCategory['Other']) {
            linksByCategory['Other'] = [];
        }
        
        // Apply category filter and search term
        let totalMatches = 0;
        
        allLinks.forEach(link => {
            // Skip if we're filtering by category and this link doesn't match
            if (categoryFilter !== 'all' && link.category !== categoryFilter) {
                return;
            }
            
            // If we're just filtering by category with no search term, include the link
            if (!searchTerm && categoryFilter !== 'all') {
                linksByCategory[link.category].push(link);
                totalMatches++;
                return;
            }
            
            // Otherwise, check if the link matches the search term
            const matches = 
                (link.title && link.title.toLowerCase().includes(searchTerm)) || 
                (link.url && link.url.toLowerCase().includes(searchTerm)) || 
                (link.description && link.description.toLowerCase().includes(searchTerm)) ||
                (link.tags && Array.isArray(link.tags) && link.tags.some(tag => 
                    tag.toLowerCase().includes(searchTerm)
                ));
                
            if (matches) {
                const category = link.category || 'Other';
                linksByCategory[category].push(link);
                totalMatches++;
            }
        });
        
        // Display search results
        displaySearchResults(categories, linksByCategory, searchTerm, totalMatches, categoryFilter);
    });
}

// Function to display search results
function displaySearchResults(categories, linksByCategory, searchTerm, totalMatches, categoryFilter) {
    const container = document.getElementById('categories-container');
    if (!container) return;
    
    container.innerHTML = ''; // Clear everything
    
    // Add search header
    const searchHeader = document.createElement('div');
    searchHeader.className = 'search-header';
    
    // Add category info if filtering by category
    const categoryInfo = categoryFilter !== 'all' ? `in category "${categoryFilter}" ` : '';
    
    searchHeader.innerHTML = `
        <h3>${searchTerm ? `Search results for "${searchTerm}" ${categoryInfo}` : `Category: ${categoryFilter}`}</h3>
        <div class="search-stats">${totalMatches} ${totalMatches === 1 ? 'result' : 'results'} found</div>
        <button id="clear-search" class="secondary-btn">Clear</button>
    `;
    container.appendChild(searchHeader);
    
    // Add clear search button handler
    document.getElementById('clear-search').addEventListener('click', function() {
        const searchInput = document.getElementById('search');
        if (searchInput) {
            searchInput.value = '';
        }
        
        const filterCategory = document.getElementById('filter-category');
        if (filterCategory) {
            filterCategory.value = 'all';
        }
        
        loadLinks(); // Reset to normal view
    });
    
    // If no results found
    if (totalMatches === 0) {
        const noResults = document.createElement('div');
        noResults.className = 'no-results';
        noResults.innerHTML = `
            <p>No matching links found.</p>
            <p>Try using different keywords or clearing your search filters.</p>
        `;
        container.appendChild(noResults);
        return;
    }
    
    // Show categories with matches
    Object.keys(linksByCategory).sort().forEach(category => {
        const categoryLinks = linksByCategory[category];
        
        // Skip empty categories
        if (categoryLinks.length === 0) return;
        
        const categorySection = document.createElement('div');
        categorySection.className = 'category-section';
        categorySection.dataset.category = category;
        
        // Create category header
        const categoryHeader = document.createElement('div');
        categoryHeader.className = 'category-header expanded'; // Always expanded in search
        categoryHeader.innerHTML = `
            <span>${category}</span>
            <span class="link-count">${categoryLinks.length}</span>
        `;
        
        // Create links container
        const linksContainer = document.createElement('div');
        linksContainer.className = 'category-links expanded'; // Always expanded in search
        
        // Add links to this category
        categoryLinks.forEach(link => {
            const linkElement = createLinkElement(link, searchTerm);
            linksContainer.appendChild(linkElement);
        });
        
        // Append elements to category section
        categorySection.appendChild(categoryHeader);
        categorySection.appendChild(linksContainer);
        
        // Add to main container
        container.appendChild(categorySection);
    });
}

// Helper function to highlight search terms in text
function highlightSearchTerm(text, searchTerm) {
    if (!searchTerm || !text) return text;
    
    const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<span class="search-highlight">$1</span>');
}

// Update button visibility in createLinkElement function
function createLinkElement(link, searchTerm = '') {
    const linkItem = document.createElement('div');
    linkItem.className = 'link-item';
    linkItem.dataset.id = link.id || Date.now(); // Ensure there's always an ID
    
    // Link URL with title
    const linkTitle = document.createElement('a');
    linkTitle.href = link.url;
    linkTitle.className = 'link-title';
    linkTitle.setAttribute('target', '_blank');
    linkTitle.innerHTML = searchTerm ? 
        highlightSearchTerm(link.title || link.url, searchTerm) : 
        (link.title || link.url);
    
    // Add favicon if available
    const favicon = document.createElement('img');
    favicon.className = 'link-favicon';
    
    try {
        const hostname = new URL(link.url).hostname;
        favicon.src = `https://www.google.com/s2/favicons?domain=${hostname}`;
    } catch (e) {
        favicon.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTMuODI4NCAxMy44Mjg0QzEzLjI5MzEgMTQuMzYzNyAxMi41OTg3IDE0LjY2MDcgMTEuODc1IDE0LjY2MDdDMTEuMTUxMyAxNC42NjA3IDEwLjQ1NjkgMTQuMzYzNyA5LjkyMTYgMTMuODI4NEM5LjM4NjMgMTMuMjkzMSA5LjA4OTMgMTIuNTk4NyA5LjA4OTMgMTEuODc1QzkuMDg5MyAxMS4xNTEzIDkuMzg2MyAxMC40NTY5IDkuOTIxNiA5LjkyMTZDMTAuNDU2OSA5LjM4NjMgMTEuMTUxMyA5LjA4OTMgMTEuODc1IDkuMDg5M0MxMi41OTg3IDkuMDg5MyAxMy4yOTMxIDkuMzg2MyAxMy44Mjg0IDkuOTIxNkMxNC4zNjM3IDEwLjQ1NjkgMTQuNjYwNyAxMS4xNTEzIDE0LjY2MDcgMTEuODc1QzE0LjY2MDcgMTIuNTk4NyAxNC4zNjM3IDEzLjI5MzEgMTMuODI4NCAxMy44Mjg0WiIgZmlsbD0iIzI0MjQyNCIvPjxwYXRoIGQ9Ik00IDExLjg3NUM0IDE0Ljk0MDYgNS4wMTkxIDE3Ljg3OSA2Ljg1MSAyMC4xNkg2Ljg1MkwxMS44NzUgMjRMMTYuODk4IDIwLjE2QzE4LjczMSAxNy44NzkgMTkuNzUgMTQuOTQwNiAxOS43NSAxMS44NzVWNC45NDgzQzE5Ljc0OCA0LjQxOTQgMTkuNTM3IDMuOTEyMiAxOS4xNjE3IDMuNTM1N0MxOC43ODYyIDMuMTU5MiAxOC4yNzkzIDIuOTQ3MiAxNy43NSAyLjk0NDRIMTcuNzQ5TDYgMi45NDVDNi4wMDExMyAyLjk0NSA2LjAwMTEzIDIuOTQ1NiA2LjAwMSAyLjk0NTZDNi4wMDA4NyAyLjk0NTYgNi4wMDA4NyAyLjk0NSA2IDIuOTQ1QzUuNDcwOTcgMi45NDY2IDQuOTY0MDYgMy4xNTg3IDQuNTg4NDMgMy41MzUyQzQuMjEyODEgMy45MTE3IDQuMDAxNTYgNC40MTg5IDQgNC45Mjc4VjExLjg3NVoiIHN0cm9rZT0iI0NDQyIgc3Ryb2tlLXdpZHRoPSIyIi8+PC9zdmc+';
    }
    
    favicon.onerror = function() {
        this.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTMuODI4NCAxMy44Mjg0QzEzLjI5MzEgMTQuMzYzNyAxMi41OTg3IDE0LjY2MDcgMTEuODc1IDE0LjY2MDdDMTEuMTUxMyAxNC42NjA3IDEwLjQ1NjkgMTQuMzYzNyA5LjkyMTYgMTMuODI4NEM5LjM4NjMgMTMuMjkzMSA5LjA4OTMgMTIuNTk4NyA5LjA4OTMgMTEuODc1QzkuMDg5MyAxMS4xNTEzIDkuMzg2MyAxMC40NTY5IDkuOTIxNiA5LjkyMTZDMTAuNDU2OSA5LjM4NjMgMTEuMTUxMyA5LjA4OTMgMTEuODc1IDkuMDg5M0MxMi41OTg3IDkuMDg5MyAxMy4yOTMxIDkuMzg2MyAxMy44Mjg0IDkuOTIxNkMxNC4zNjM3IDEwLjQ1NjkgMTQuNjYwNyAxMS4xNTEzIDE0LjY2MDcgMTEuODc1QzE0LjY2MDcgMTIuNTk4NyAxNC4zNjM3IDEzLjI5MzEgMTMuODI4NCAxMy44Mjg0WiIgZmlsbD0iIzI0MjQyNCIvPjxwYXRoIGQ9Ik00IDExLjg3NUM0IDE0Ljk0MDYgNS4wMTkxIDE3Ljg3OSA2Ljg1MSAyMC4xNkg2Ljg1MkwxMS44NzUgMjRMMTYuODk4IDIwLjE2QzE4LjczMSAxNy44NzkgMTkuNzUgMTQuOTQwNiAxOS43NSAxMS44NzVWNC45NDgzQzE5Ljc0OCA0LjQxOTQgMTkuNTM3IDMuOTEyMiAxOS4xNjE3IDMuNTM1N0MxOC43ODYyIDMuMTU5MiAxOC4yNzkzIDIuOTQ3MiAxNy43NSAyLjk0NDRIMTcuNzQ5TDYgMi45NDVDNi4wMDExMyAyLjk0NSA2LjAwMTEzIDIuOTQ1NiA2LjAwMSAyLjk0NTZDNi4wMDA4NyAyLjk0NTYgNi4wMDA4NyAyLjk0NSA2IDIuOTQ1QzUuNDcwOTcgMi45NDY2IDQuOTY0MDYgMy4xNTg3IDQuNTg4NDMgMy41MzUyQzQuMjEyODEgMy45MTE3IDQuMDAxNTYgNC40MTg5IDQgNC45Mjc4VjExLjg3NVoiIHN0cm9rZT0iI0NDQyIgc3Ryb2tlLXdpZHRoPSIyIi8+PC9zdmc+';
    };
    
    // Actions container
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'link-actions';
    
    // Copy button - always show
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.className = 'copy-link';
    copyBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(link.url)
            .then(() => showNotification('Link copied to clipboard!', 'success'))
            .catch(err => showNotification('Failed to copy link', 'error'));
    });
    actionsDiv.appendChild(copyBtn);
    
    // Share button - always show
    const shareBtn = document.createElement('button');
    shareBtn.textContent = 'Share';
    shareBtn.className = 'share-link';
    shareBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        shareLink(link.id);
    });
    actionsDiv.appendChild(shareBtn);
    
    // For admin links, show badge
    if (link.adminId) {
        const adminBadge = document.createElement('span');
        adminBadge.className = 'shared-badge';
        adminBadge.textContent = 'Admin';
        actionsDiv.appendChild(adminBadge);
    }
    else {
        // User links get edit and delete buttons
        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.className = 'edit-link';
        editBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            editLink(link.id);
        });
        
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.className = 'delete-link';
        deleteBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            deleteLink(link.id);
        });
        
        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(deleteBtn);
    }
    
    // Build the link item
    linkItem.appendChild(favicon);
    linkItem.appendChild(linkTitle);
    linkItem.appendChild(actionsDiv);
    
    // Description if available
    if (link.description) {
        const descriptionDiv = document.createElement('div');
        descriptionDiv.className = 'link-description';
        descriptionDiv.innerHTML = searchTerm ? 
            highlightSearchTerm(link.description, searchTerm) : 
            link.description;
        linkItem.appendChild(descriptionDiv);
    }
    
    // Tags if available
    if (link.tags && link.tags.length > 0) {
        const tagsDiv = document.createElement('div');
        tagsDiv.className = 'link-tags';
        
        link.tags.forEach(tag => {
            const tagSpan = document.createElement('span');
            tagSpan.className = 'tag';
            
            // Highlight tag if it matches search term
            if (searchTerm && tag.toLowerCase().includes(searchTerm.toLowerCase())) {
                tagSpan.classList.add('matching-tag');
            }
            
            tagSpan.innerHTML = searchTerm ? 
                highlightSearchTerm(tag, searchTerm) : 
                tag;
            tagsDiv.appendChild(tagSpan);
        });
        
        linkItem.appendChild(tagsDiv);
    }
    
    return linkItem;
}

// Add this function to load all categories first
function loadAllCategories() {
    chrome.storage.local.get(['categories'], function(result) {
        let categories = result.categories || ['Automation', 'Down selection', 'Logs review & Stereo', 'Maps', 'Other', 'Vision'];
        
        // Ensure we have all the expected categories
        const expectedCategories = ['Automation', 'Down selection', 'Logs review & Stereo', 'Maps', 'Other', 'Vision'];
        expectedCategories.forEach(category => {
            if (!categories.includes(category)) {
                categories.push(category);
            }
        });
        
        // Save back if we added any
        if (categories.length > (result.categories || []).length) {
            chrome.storage.local.set({categories: categories});
        }
        
        // Now load links
        loadLinks();
    });
}

// Update loadLinks function for better category handling
function loadLinks() {
    console.log("Loading links...");
    
    // Try to get all data from storage
    try {
        chrome.storage.local.get(null, function(data) {
            if (chrome.runtime.lastError) {
                console.error("Storage error:", chrome.runtime.lastError);
                // If we can't access storage, use fallback
                useFallbackWithAllCategories();
                return;
            }
            
            // Look for links in all possible storage locations
            const adminLinks = data.adminLinks || [];
            const defaultLinks = data.links || [];
            const userLinks = data.userLinks || [];
            
            // Get categories from storage or use comprehensive defaults
            let categories = data.categories || [];
            if (categories.length === 0) {
                categories = getAllPossibleCategories();
                
                // Save these categories for future use
                chrome.storage.local.set({categories: categories});
            }
            
            console.log(`Found links - admin: ${adminLinks.length}, default: ${defaultLinks.length}, user: ${userLinks.length}`);
            console.log(`Categories: ${categories.join(', ')}`);
            
            // If no links found at all, try to fetch them
            if (adminLinks.length === 0 && defaultLinks.length === 0 && userLinks.length === 0) {
                console.log("No links found in storage, attempting API fetch...");
                fetchApiLinks();
                return;
            }
            
            // Display all found links with all categories
            displayLinks(categories, adminLinks.length > 0 ? adminLinks : defaultLinks, userLinks);
        });
    } catch (e) {
        console.error("Critical error accessing storage:", e);
        useFallbackWithAllCategories();
    }
}

// Add this helper function for extreme failure cases
function showFallbackUI() {
    const container = document.getElementById('categories-container');
    if (container) {
        container.innerHTML = `
            <div class="fallback-message">
                <h3>Connection Issue</h3>
                <p>Unable to load links. This could be due to:</p>
                <ul>
                    <li>Network connection problem</li>
                    <li>Browser storage access issue</li>
                    <li>API service unavailable</li>
                </ul>
                <button id="retry-load" class="primary-btn">Retry</button>
            </div>
        `;
        
        // Add retry button handler
        const retryButton = document.getElementById('retry-load');
        if (retryButton) {
            retryButton.addEventListener('click', function() {
                // Clear any problematic data
                chrome.storage.local.remove(['links', 'adminLinks'], function() {
                    // Force fresh fetch
                    fetchApiLinks();
                });
            });
        }
    }
}

// Add this helper function to check if storage is working properly
function debugStorage() {
    const storage = chrome.storage.sync || chrome.storage.local;
    
    storage.get(null, function(data) {
        console.log("STORAGE DEBUG:");
        console.log("All keys:", Object.keys(data));
        console.log("Links:", data.links ? data.links.length : 0);
        console.log("Sample link:", data.links && data.links.length > 0 ? data.links[0] : "none");
        console.log("Categories:", data.categories);
    });
}

// Fix displayLinks to show ALL categories, even if empty
function displayLinks(categories, sharedLinks, userLinks) {
    const container = document.getElementById('categories-container');
    if (!container) {
        console.error('Categories container not found');
        return;
    }
    
    container.innerHTML = '';
    
    // Combine all links
    const allLinks = [...(userLinks || []), ...(sharedLinks || [])];
    
    // If no links at all, show message
    if (allLinks.length === 0) {
        container.innerHTML = '<p class="no-links">No links found. Please check your connection or try refreshing.</p>';
        return;
    }
    
    // Group links by category
    const linksByCategory = {};
    
    // Initialize ALL categories from the categories array
    categories.forEach(category => {
        linksByCategory[category] = [];
    });
    
    // Add "Other" category if not exists
    if (!linksByCategory['Other']) {
        linksByCategory['Other'] = [];
    }
    
    // Group links by their categories
    allLinks.forEach(link => {
        if (link.category && linksByCategory[link.category]) {
            linksByCategory[link.category].push(link);
        } else {
            // If category doesn't exist, move to Other
            linksByCategory['Other'].push(link);
        }
    });
    
    // Create sections for ALL categories, even empty ones
    Object.keys(linksByCategory).sort().forEach(category => {
        const categoryLinks = linksByCategory[category] || [];
        
        // Create category section
        const categorySection = document.createElement('div');
        categorySection.className = 'category-section';
        categorySection.dataset.category = category;
        
        // Create category header
        const categoryHeader = document.createElement('div');
        categoryHeader.className = 'category-header';
        categoryHeader.innerHTML = `
            <span>${category}</span>
            <span class="link-count">${categoryLinks.length}</span>
        `;
        
        // Create links container
        const linksContainer = document.createElement('div');
        linksContainer.className = 'category-links';
        
        if (categoryLinks.length > 0) {
            // Add first link
            const firstLink = createLinkElement(categoryLinks[0]);
            linksContainer.appendChild(firstLink);
            
            // If there are more links, add a container for them
            if (categoryLinks.length > 1) {
                // Add show more button
                const showMoreBtn = document.createElement('button');
                showMoreBtn.className = 'show-more-btn';
                showMoreBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    linksContainer.classList.toggle('expanded');
                });
                
                linksContainer.appendChild(showMoreBtn);
                
                // Create container for additional links
                const moreLinksContainer = document.createElement('div');
                moreLinksContainer.className = 'more-links';
                
                // Add remaining links
                for (let i = 1; i < categoryLinks.length; i++) {
                    const linkEl = createLinkElement(categoryLinks[i]);
                    moreLinksContainer.appendChild(linkEl);
                }
                
                linksContainer.appendChild(moreLinksContainer);
            }
        } else {
            // Empty category message
            const emptyMsg = document.createElement('p');
            emptyMsg.textContent = 'No links in this category yet';
            emptyMsg.className = 'empty-category';
            linksContainer.appendChild(emptyMsg);
        }
        
        // Make header toggleable
        categoryHeader.addEventListener('click', function() {
            linksContainer.classList.toggle('expanded');
            this.classList.toggle('expanded');
        });
        
        // Append elements to category section
        categorySection.appendChild(categoryHeader);
        categorySection.appendChild(linksContainer);
        
        // Add to main container
        container.appendChild(categorySection);
    });
}

// Update the export function to include userLinks
function exportData() {
    chrome.storage.local.get(['links', 'userLinks', 'categories'], function(result) {
        const data = {
            links: result.links || [],
            userLinks: result.userLinks || [],
            categories: result.categories || [],
            exportDate: new Date().toISOString()
        };
        
        const dataStr = JSON.stringify(data, null, 2);
        const dataBlob = new Blob([dataStr], {type: 'application/json'});
        const url = URL.createObjectURL(dataBlob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'link-library-export.json';
        a.click();
        
        setTimeout(() => URL.revokeObjectURL(url), 100);
        
        showNotification('Data exported successfully', 'success');
    });
}

// Import data
function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = e => {
        const file = e.target.files[0];
        
        if (!file) {
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const data = JSON.parse(event.target.result);
                
                if (!data.links || !data.categories) {
                    throw new Error('Invalid data format');
                }
                
                chrome.storage.local.set({
                    links: data.links,
                    categories: data.categories
                }, function() {
                    loadLinks();
                    showNotification('Data imported successfully', 'success');
                });
                
            } catch (error) {
                showNotification('Error importing data: ' + error.message, 'error');
            }
        };
        
        reader.readAsText(file);
    };
    
    input.click();
}

// Clear all links
function clearLinks() {
    if (confirm('Are you sure you want to delete ALL links? This cannot be undone.')) {
        chrome.storage.local.set({links: []}, function() {
            loadLinks();
            showNotification('All links cleared', 'success');
        });
    }
}

// Sync with browser bookmarks - placeholder functionality
function syncBrowser() {
    showNotification('Syncing with browser bookmarks...', 'success');
    // Implement actual bookmark sync functionality here
}

// Cloud backup - placeholder functionality
function cloudBackup() {
    showNotification('Cloud backup feature coming soon!', 'success');
    // Implement actual cloud backup functionality here
}

// Clear form fields
function clearForm() {
    document.getElementById('link-title').value = '';
    document.getElementById('link-url').value = '';
    document.getElementById('tags').value = '';
    
    // Reset add button if in edit mode
    const addButton = document.getElementById('add-link');
    if (addButton.dataset.editId) {
        delete addButton.dataset.editId;
        addButton.textContent = 'Add Link';
        
        // Remove cancel button if exists
        const cancelButton = document.getElementById('cancel-edit');
        if (cancelButton) {
            cancelButton.remove();
        }
    }
}

// Show notification
function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Add show class after a small delay (for animation)
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // Remove notification after 3 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

// Edit a link
function editLink(linkId) {
    console.log("Editing link with ID:", linkId);
    
    chrome.storage.local.get(['links', 'userLinks'], function(result) {
        const allLinks = [...(result.links || []), ...(result.userLinks || [])];
        const linkToEdit = allLinks.find(link => link.id == linkId);
        
        if (!linkToEdit) {
            showNotification("Link not found", "error");
            return;
        }
        
        // Fill form with link data
        document.getElementById('link-title').value = linkToEdit.title || '';
        document.getElementById('link-url').value = linkToEdit.url || '';
        document.getElementById('category').value = linkToEdit.category || '';
        document.getElementById('tags').value = Array.isArray(linkToEdit.tags) ? linkToEdit.tags.join(', ') : '';
        
        // Set edit mode
        const addButton = document.getElementById('add-link');
        addButton.dataset.editId = linkId;
        addButton.textContent = 'Update Link';
        
        // Add cancel button if not exists
        if (!document.getElementById('cancel-edit')) {
            const cancelButton = document.createElement('button');
            cancelButton.id = 'cancel-edit';
            cancelButton.className = 'secondary-btn';
            cancelButton.textContent = 'Cancel';
            cancelButton.addEventListener('click', clearForm);
            
            addButton.parentNode.insertBefore(cancelButton, addButton.nextSibling);
        }
        
        // Switch to add tab
        document.querySelectorAll('.tab-btn').forEach(btn => {
            if (btn.getAttribute('data-tab') === 'add') {
                btn.click();
            }
        });
    });
}

// Delete a link
function deleteLink(linkId) {
    if (confirm('Are you sure you want to delete this link?')) {
        chrome.storage.local.get(['links', 'userLinks'], function(result) {
            let links = result.links || [];
            let userLinks = result.userLinks || [];
            
            // Filter out the link from both arrays
            const newLinks = links.filter(link => link.id != linkId);
            const newUserLinks = userLinks.filter(link => link.id != linkId);
            
            // Save back to storage
            chrome.storage.local.set({
                links: newLinks,
                userLinks: newUserLinks
            }, function() {
                loadLinks();
                showNotification('Link deleted successfully', 'success');
            });
        });
    }
}

// Add this function to handle sharing links
function shareLink(linkId) {
    console.log("Sharing link:", linkId);
    
    chrome.storage.local.get(['links', 'userLinks'], function(result) {
        const allLinks = [...(result.links || []), ...(result.userLinks || [])];
        const linkToShare = allLinks.find(link => link.id == linkId);
        
        if (!linkToShare) {
            showNotification("Link not found", "error");
            return;
        }
        
        // Show sharing dialog
        const shareDialog = document.createElement('div');
        shareDialog.className = 'share-dialog';
        shareDialog.innerHTML = `
            <div class="share-dialog-content">
                <h3>Share "${linkToShare.title}"</h3>
                <p>Choose how you want to share this link:</p>
                
                <div class="share-options">
                    <button id="share-copy" class="primary-btn">Copy Link</button>
                    <button id="share-email" class="primary-btn">Email Link</button>
                </div>
                
                <p>Or share directly to:</p>
                <div class="social-share">
                    <button class="social-btn" data-platform="twitter">Twitter</button>
                    <button class="social-btn" data-platform="linkedin">LinkedIn</button>
                    <button class="social-btn" data-platform="facebook">Facebook</button>
                </div>
                
                <button id="share-close" class="secondary-btn">Close</button>
            </div>
        `;
        
        document.body.appendChild(shareDialog);
        
        // Animation to show dialog
        setTimeout(() => {
            shareDialog.classList.add('visible');
        }, 10);
        
        // Set up event listeners
        document.getElementById('share-copy').addEventListener('click', function() {
            navigator.clipboard.writeText(linkToShare.url)
                .then(() => {
                    showNotification("Link copied to clipboard!", "success");
                    closeShareDialog();
                })
                .catch(err => showNotification("Failed to copy link", "error"));
        });
        
        document.getElementById('share-email').addEventListener('click', function() {
            const subject = encodeURIComponent(`Check out this link: ${linkToShare.title}`);
            const body = encodeURIComponent(`I thought you might find this interesting:\n\n${linkToShare.title}\n${linkToShare.url}`);
            window.open(`mailto:?subject=${subject}&body=${body}`);
            closeShareDialog();
        });
        
        document.querySelectorAll('.social-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const platform = this.dataset.platform;
                let url;
                
                switch(platform) {
                    case 'twitter':
                        url = `https://twitter.com/intent/tweet?url=${encodeURIComponent(linkToShare.url)}&text=${encodeURIComponent(linkToShare.title)}`;
                        break;
                    case 'linkedin':
                        url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(linkToShare.url)}`;
                        break;
                    case 'facebook':
                        url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(linkToShare.url)}`;
                        break;
                }
                
                if (url) {
                    window.open(url, '_blank', 'width=600,height=400');
                }
                
                closeShareDialog();
            });
        });
        
        document.getElementById('share-close').addEventListener('click', closeShareDialog);
        
        function closeShareDialog() {
            shareDialog.classList.remove('visible');
            setTimeout(() => {
                shareDialog.remove();
            }, 300);
        }
    });
}

// Modify fetchApiLinks for more robust cross-browser support
function fetchApiLinks() {
    console.log("Popup directly fetching API links...");
    
    // Show loading indicator
    const container = document.getElementById('categories-container');
    if (container) {
        container.innerHTML = '<div class="loading-indicator">Loading links from API...</div>';
    }
    
    // Try multiple API endpoints if the primary one fails
    const API_URLS = [
        "https://apimocha.com/linklib/links",
        "https://api.npoint.io/43644ec4fa049e8995fe", // Backup API
        "https://api.jsonbin.io/b/60f7b8a5a917050205c8a76d" // Second backup
    ];
    
    // Try each API endpoint in succession
    tryNextApi(0);
    
    function tryNextApi(index) {
        if (index >= API_URLS.length) {
            // All APIs failed, use fallback
            console.log("All API endpoints failed, using fallback");
            useFallbackWithAllCategories();
            return;
        }
        
        const apiUrl = API_URLS[index];
        console.log(`Trying API endpoint ${index + 1}/${API_URLS.length}: ${apiUrl}`);
        
        // Use XMLHttpRequest instead of fetch for better compatibility
        const xhr = new XMLHttpRequest();
        const timeoutId = setTimeout(() => {
            xhr.abort();
            console.log(`API request to ${apiUrl} timed out`);
            tryNextApi(index + 1);
        }, 5000);
        
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                clearTimeout(timeoutId);
                
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        handleApiSuccess(data);
                    } catch (e) {
                        console.error("Error parsing API response:", e);
                        tryNextApi(index + 1);
                    }
                } else {
                    console.log(`API request failed with status ${xhr.status}`);
                    tryNextApi(index + 1);
                }
            }
        };
        
        xhr.onerror = function() {
            clearTimeout(timeoutId);
            console.log(`Network error when connecting to ${apiUrl}`);
            tryNextApi(index + 1);
        };
        
        try {
            xhr.open('GET', `${apiUrl}?cachebust=${Date.now()}`, true);
            xhr.send();
        } catch (e) {
            clearTimeout(timeoutId);
            console.error("Error making XHR request:", e);
            tryNextApi(index + 1);
        }
    }
    
    function handleApiSuccess(data) {
        console.log("API data received:", data);
        
        // Extract links from response
        const links = Array.isArray(data.links) ? data.links : 
                     (Array.isArray(data.adminLinks) ? data.adminLinks : []);
                     
        // Extract categories from response (this is key!)
        const categories = Array.isArray(data.categories) ? data.categories : [];
        
        console.log(`Found ${links.length} links and ${categories.length} categories in API response`);
        
        // Save both links AND categories to storage
        chrome.storage.local.set({
            adminLinks: links,
            links: links,
            categories: categories.length > 0 ? categories : getAllPossibleCategories(),
            lastApiSuccess: Date.now()
        }, function() {
            if (chrome.runtime.lastError) {
                console.error("Error saving API data:", chrome.runtime.lastError);
            }
            loadLinks();
        });
    }
}

// Replace useFallbackWithAllCategories function
function useFallbackWithAllCategories() {
    console.log("Using fallback with complete category list");
    
    // Get ALL possible categories
    const allCategories = getAllPossibleCategories();
    
    // Create demo links covering ALL categories
    const demoLinks = [
        {
            id: 'demo_1',
            title: 'GitHub',
            url: 'https://github.com',
            category: 'Other',
            adminId: 'demo',
            tags: ['code', 'repository', 'git'],
            description: 'Host and review code, manage projects',
            dateAdded: new Date().toISOString()
        },
        {
            id: 'demo_2',
            title: 'OpenCV Documentation',
            url: 'https://docs.opencv.org',
            category: 'Vision',
            adminId: 'demo',
            tags: ['computer vision', 'image processing'],
            description: 'Open source computer vision library',
            dateAdded: new Date().toISOString()
        },
        {
            id: 'demo_3',
            title: 'Mapbox GL JS',
            url: 'https://docs.mapbox.com/mapbox-gl-js',
            category: 'Maps',
            adminId: 'demo',
            tags: ['maps', 'javascript', 'geospatial'],
            description: 'Interactive, customizable maps',
            dateAdded: new Date().toISOString()
        },
        {
            id: 'demo_4',
            title: 'TensorFlow',
            url: 'https://tensorflow.org',
            category: 'AI',
            adminId: 'demo',
            tags: ['machine learning', 'deep learning'],
            description: 'Open source machine learning platform',
            dateAdded: new Date().toISOString()
        },
        {
            id: 'demo_5',
            title: 'Jenkins',
            url: 'https://jenkins.io',
            category: 'Automation',
            adminId: 'demo',
            tags: ['CI/CD', 'pipeline'],
            description: 'Automation server for building and testing',
            dateAdded: new Date().toISOString()
        },
        {
            id: 'demo_6',
            title: 'Point Cloud Library',
            url: 'https://pointclouds.org',
            category: '3D',
            adminId: 'demo',
            tags: ['point cloud', '3D processing'],
            description: '3D point cloud processing library',
            dateAdded: new Date().toISOString()
        },
        {
            id: 'demo_7',
            title: 'Matplotlib',
            url: 'https://matplotlib.org',
            category: '2D',
            adminId: 'demo',
            tags: ['plotting', 'visualization'],
            description: 'Python plotting library',
            dateAdded: new Date().toISOString()
        },
        {
            id: 'demo_8',
            title: 'ROS Documentation',
            url: 'https://docs.ros.org',
            category: 'Navigation',
            adminId: 'demo',
            tags: ['robotics', 'navigation'],
            description: 'Robot Operating System documentation',
            dateAdded: new Date().toISOString()
        },
        {
            id: 'demo_9',
            title: 'Sensor Fusion',
            url: 'https://en.wikipedia.org/wiki/Sensor_fusion',
            category: 'Sensors',
            adminId: 'demo',
            tags: ['fusion', 'filtering'],
            description: 'Combining sensory data from multiple sources',
            dateAdded: new Date().toISOString()
        },
        {
            id: 'demo_10',
            title: 'VSCode',
            url: 'https://code.visualstudio.com',
            category: 'Tools',
            adminId: 'demo',
            tags: ['editor', 'development'],
            description: 'Free source-code editor from Microsoft',
            dateAdded: new Date().toISOString()
        },
        {
            id: 'demo_11',
            title: 'LiDAR Processing',
            url: 'https://en.wikipedia.org/wiki/Lidar',
            category: 'Logs review & Stereo',
            adminId: 'demo',
            tags: ['lidar', 'point cloud'],
            description: 'Light Detection and Ranging processing techniques',
            dateAdded: new Date().toISOString()
        },
        {
            id: 'demo_12',
            title: 'Feature Selection',
            url: 'https://en.wikipedia.org/wiki/Feature_selection',
            category: 'Down selection',
            adminId: 'demo',
            tags: ['features', 'selection'],
            description: 'Process of selecting relevant features for model building',
            dateAdded: new Date().toISOString()
        }
    ];
    
    // Save all categories and demo links to storage
    chrome.storage.local.set({
        adminLinks: demoLinks,
        links: demoLinks,
        categories: allCategories,
        lastApiSuccess: 0 // Mark as fallback data
    }, function() {
        if (chrome.runtime.lastError) {
            console.error("Error saving fallback data:", chrome.runtime.lastError);
            showNotification("Error loading content. Please reload the extension.", "error");
        } else {
            showNotification("Using offline demo links - couldn't connect to server", "warning");
            loadLinks();
        }
    });
}

// Add this function to ensure we always have ALL categories
function getAllPossibleCategories() {
    return [
        'Automation', 
        'Down selection', 
        'Logs review & Stereo',
        'Maps', 
        'Other', 
        'Vision', 
        '2D', 
        '3D',
        'AI',
        'Tools',
        'Navigation',
        'Sensors'
    ];
}