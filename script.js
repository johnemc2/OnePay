document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const selectBtn = document.getElementById('select-btn');
    const fileInfo = document.getElementById('file-info');
    const fileNameDisplay = document.getElementById('file-name');
    const resetBtn = document.getElementById('reset-btn');
    const loadingIndicator = document.getElementById('loading-indicator');
    const searchSection = document.getElementById('search-section');
    const resultsSection = document.getElementById('results-section');
    const resultsBody = document.getElementById('results-body');
    const searchInput = document.getElementById('search-input');
    const matchCount = document.getElementById('match-count');
    const accountSelect = document.getElementById('account-select');
    const exportBtn = document.getElementById('export-btn');

    let allLines = []; // Raw lines for debugging/fallback
    let accounts = new Set();
    let currentAccount = 'Unknown';
    
    // Sorting State
    let currentSort = {
        column: null,
        direction: 'asc' // or 'desc'
    };

    // Drag & Drop Handlers
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            handleFiles(e.dataTransfer.files);
        }
    });

    selectBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleFiles(e.target.files);
        }
    });

    resetBtn.addEventListener('click', () => {
        transactions = [];
        allLines = [];
        accounts.clear();
        currentAccount = 'Unknown';
        
        fileInput.value = '';
        dropZone.classList.remove('hidden');
        fileInfo.classList.add('hidden');
        searchSection.classList.add('hidden');
        resultsSection.classList.add('hidden');
        resultsBody.innerHTML = '';
        searchInput.value = '';
        
        // Reset Account Select
        accountSelect.innerHTML = '<option value="all">All Accounts</option>';
        accountSelect.classList.add('hidden');
        
        // Remove dynamic summary sections
        const summarySection = document.getElementById('summary-section');
        if (summarySection) summarySection.remove();

        const filteredSummary = document.getElementById('filtered-summary');
        if (filteredSummary) filteredSummary.remove();
    });

    searchInput.addEventListener('input', (e) => {
        renderResults();
    });

    accountSelect.addEventListener('change', () => {
        renderResults();
        updateSummary(); 
    });

    exportBtn.addEventListener('click', exportCSV);

    // Sorting Event Listeners
    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.sort;
            if (currentSort.column === column) {
                // Toggle direction
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                // New column, default to asc
                currentSort.column = column;
                currentSort.direction = 'asc';
            }
            renderResults();
        });
    });

    async function handleFiles(files) {
        // UI Updates
        fileNameDisplay.textContent = files.length === 1 ? files[0].name : `${files.length} files selected`;
        dropZone.classList.add('hidden');
        fileInfo.classList.remove('hidden');
        loadingIndicator.classList.remove('hidden');
        resultsSection.classList.add('hidden');
        searchSection.classList.add('hidden');

        transactions = [];
        allLines = [];
        accounts = new Set();
        currentAccount = 'Unknown';

        try {
            // Process all files in parallel
            const filePromises = Array.from(files).map(file => processSinglePDF(file));
            const results = await Promise.all(filePromises);

            // Aggregate results
            results.forEach(result => {
                transactions.push(...result.transactions);
                result.accounts.forEach(acc => accounts.add(acc));
            });

            // Populate Account Dropdown
            accountSelect.innerHTML = '<option value="all">All Accounts</option>';
            if (accounts.size > 0) {
                const sortedAccounts = Array.from(accounts).sort();
                sortedAccounts.forEach(acc => {
                    const option = document.createElement('option');
                    option.value = acc;
                    option.textContent = acc;
                    accountSelect.appendChild(option);
                });
                accountSelect.classList.remove('hidden');
            } else {
                accountSelect.classList.add('hidden');
            }

            loadingIndicator.classList.add('hidden');
            searchSection.classList.remove('hidden');
            resultsSection.classList.remove('hidden');
            
            renderResults();
            updateSummary(); 

        } catch (error) {
            console.error(error);
            alert('Error processing PDF(s): ' + error.message);
            loadingIndicator.classList.add('hidden');
            dropZone.classList.remove('hidden');
            fileInfo.classList.add('hidden');
        }
    }

    // --- CONFIGURATION & CONSTANTS ---
    const CONFIG = {
        dateRegex: /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{1,2}/i,
        amountRegex: /([+\-]\$[\d,]+\.\d{2})/,
        accountHeaderRegex: /^(.*)\s+x\d+$/i,
        ignoredPrefixes: [
            'total', 'debit x', 'savings x', 'direct inquiries to', 'los angeles, ca', 'member fdic',
            'onepay cash banking', 'one finance, inc.', 'transaction history', 'account summary',
            'activity summary', 'beginning balance', 'beg. balance', 'incoming transactions',
            'outgoing transactions', 'ending balance', 'in case of errors or questions'
        ],
        ignoredSubstrings: ['date', 'description', 'amount', 'page', 'of']
    };

    // --- HELPER FUNCTIONS ---

    function isIgnoredLine(lineText) {
        const lt = lineText.toLowerCase();
        
        // Check exact prefixes
        if (CONFIG.ignoredPrefixes.some(prefix => lt.startsWith(prefix))) return true;

        // Check combined substring conditions
        if (lt.includes('date') && lt.includes('description') && lt.includes('amount')) return true;
        if (lt.includes('page') && lt.includes('of')) return true;
        
        return false;
    }

    async function extractPageLines(pdf, pageNum) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const lineMap = new Map();

        textContent.items.forEach(item => {
            const y = Math.round(item.transform[5]);
            
            // Filter out footer content (observed at y=34 and y=43 in statement_template.pdf)
            if (y < 50) return;

            if (!lineMap.has(y)) lineMap.set(y, []);
            lineMap.get(y).push({
                text: item.str,
                x: item.transform[4],
                width: item.width
            });
        });

        // Convert Map to sorted array of lines
        const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a); // Top to Bottom
        let lines = [];
        let typeColumnX = 340; // Default

        // First pass: Detect Column Header
        for (const y of sortedY) {
            const items = lineMap.get(y).sort((a, b) => a.x - b.x);
            const lineText = items.map(i => i.text).join(' ').trim();
            if (lineText.toLowerCase().includes('transaction type')) {
                const typeItem = items.find(it => it.text.toLowerCase().includes('transaction type'));
                if (typeItem) typeColumnX = typeItem.x;
            }
        }

        // Second pass: Create Line Objects
        for (const y of sortedY) {
            const items = lineMap.get(y).sort((a, b) => a.x - b.x);
            const lineText = items.map(i => i.text).join(' ').trim();
            if (lineText.length === 0) continue;

            lines.push({
                y: y,
                items: items,
                text: lineText,
                lowerText: lineText.toLowerCase(),
                page: pageNum,
                typeColumnX: typeColumnX
            });
        }
        return lines;
    }

    function clusterOrphans(anchors, orphans, globalLastAnchor) {
        orphans.forEach(orphan => {
            // Case A: No anchors on this page at all?
            if (anchors.length === 0) {
                if (globalLastAnchor && globalLastAnchor.account === orphan.account) {
                    globalLastAnchor.subLines.push(orphan);
                }
                return;
            }

            // Find nearest anchor on the SAME PAGE and SAME ACCOUNT
            let anchorAbove = null; 
            let anchorBelow = null; 

            // Anchors are sorted Descending (Top-Down)
            for (let k = 0; k < anchors.length; k++) {
                const a = anchors[k];
                if (a.account !== orphan.account) continue;

                if (a.y > orphan.y) {
                    anchorAbove = a;
                } else {
                    anchorBelow = a;
                    break; 
                }
            }

            const distAbove = anchorAbove ? (anchorAbove.y - orphan.y) : Infinity;
            const distBelow = anchorBelow ? (orphan.y - anchorBelow.y) : Infinity;
            let bestMatch = null;

            if (!anchorAbove) {
                // Top of Page Logic
                if (globalLastAnchor && globalLastAnchor.account === orphan.account) {
                    if (distBelow < 25) {
                        bestMatch = anchorBelow;
                    } else {
                        bestMatch = globalLastAnchor;
                    }
                } else {
                    bestMatch = anchorBelow;
                }
            } else if (!anchorBelow) {
                bestMatch = anchorAbove;
            } else {
                bestMatch = (distAbove <= distBelow) ? anchorAbove : anchorBelow;
            }

            if (bestMatch && bestMatch.account === orphan.account) {
                 bestMatch.subLines.push(orphan);
            }
        });
    }

    async function processSinglePDF(file) {
        if (file.type !== 'application/pdf') {
            throw new Error(`File ${file.name} is not a valid PDF.`);
        }

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        let localTransactions = [];
        let localAccounts = new Set();
        let globalLastAnchor = null;
        let allAnchors = [];

        // Iterate all pages
        for (let i = 1; i <= pdf.numPages; i++) {
            const parsedLines = await extractPageLines(pdf, i);
            
            // Identify Context (Account) & Transaction Anchors
            let activeAccount = 'Unknown';
            let anchors = [];
            let orphans = [];

            parsedLines.forEach(line => {
                if (CONFIG.accountHeaderRegex.test(line.text)) {
                    activeAccount = line.text;
                    localAccounts.add(activeAccount);
                    return;
                }

                if (isIgnoredLine(line.text)) return;

                const dateMatch = line.text.match(CONFIG.dateRegex);
                const amountMatch = line.text.match(CONFIG.amountRegex);

                if (dateMatch) {
                    anchors.push({
                        ...line,
                        account: activeAccount,
                        date: dateMatch[0],
                        amountStr: amountMatch ? amountMatch[1] : null,
                        subLines: [] 
                    });
                } else {
                    orphans.push({ ...line, account: activeAccount });
                }
            });

            // Cluster Orphans
            clusterOrphans(anchors, orphans, globalLastAnchor);

            // Update Global Tracker
            if (anchors.length > 0) {
                globalLastAnchor = anchors[anchors.length - 1];
                allAnchors.push(...anchors);
            }
        } 
        
        // Construct Final Transactions
        allAnchors.forEach(anchor => {
            const allLines = [anchor, ...anchor.subLines].sort((a, b) => b.y - a.y);
            let fullDesc = '';
            let fullType = '';
            
            if (!anchor.amountStr) {
                for (const line of allLines) {
                    const am = line.text.match(CONFIG.amountRegex);
                    if (am) {
                        anchor.amountStr = am[1];
                        break;
                    }
                }
            }

            allLines.forEach(line => {
                const parsed = parseLineByGaps(line.items, line.date, line.amountStr, line.typeColumnX);
                if (parsed.description) fullDesc += (fullDesc ? ' ' : '') + parsed.description;
                if (parsed.type) fullType += (fullType ? ' ' : '') + parsed.type;
            });

            const amountStr = anchor.amountStr || '$0.00';
            const isNegative = amountStr.startsWith('-');
            const cleanAmount = parseFloat(amountStr.replace(/[^\d.]/g, ''));
            
            localTransactions.push({
                date: anchor.date,
                description: fullDesc,
                type: fullType,
                amount: isNegative ? -cleanAmount : cleanAmount,
                amountStr: amountStr,
                page: anchor.page,
                account: anchor.account,
                raw: anchor.text 
            });
        });
        
        return { transactions: localTransactions, accounts: localAccounts };
    }

    // GAP ANALYSIS HELPER
    function parseLineByGaps(items, dateStr, amountStr, typeColumnX) {
        // Sort by X primarily, then Y descending (Top-to-Bottom) for vertical stacking in same column
        items.sort((a, b) => {
            const xDiff = a.x - b.x;
            if (Math.abs(xDiff) > 2) return xDiff; // Significant X difference
            return b.y - a.y; // Secondary: Higher Y first (Top of page is Higher Y in PDF usually, check transform)
            // Note: If PDF.js transform[5] is standard PDF coords, Y=0 is bottom. So b.y - a.y puts Higher Y first.
        });

        // 1. Identify Date and Amount items to exclude
        let contentItems = [];
        
        items.forEach(item => {
            const txt = item.text.trim();
            if (!txt) return;
            
            // If it matches Date or Amount EXACTLY or IS CONTAINED in them
            if (dateStr && (txt === dateStr || dateStr.includes(txt))) return;
            if (amountStr && (txt === amountStr || amountStr.includes(txt))) return;
            
            // Exclude parts of date/amount if they are split (simple heuristic)
            if (dateStr && item.x < 100 && dateStr.startsWith(txt)) return; // Left side
            if (amountStr && item.x > 500 && amountStr.endsWith(txt)) return; // Right side

            contentItems.push(item);
        });

        if (contentItems.length === 0) {
            return { description: '', type: '' };
        }

        let description = '';
        let type = '';
        
        // Define Split Threshold based on Detected Column
        // Use a safety buffer (e.g., 50px left of the header start)
        const splitThreshold = (typeColumnX || 340) - 50;

        // 2. Split by Column Boundary
        let descItems = [];
        let typeItems = [];

        contentItems.forEach(it => {
            // If item starts AFTER the threshold, it belongs to Type
            if (it.x >= splitThreshold) {
                typeItems.push(it);
            } else {
                descItems.push(it);
            }
        });
        
        // Edge Case: If everything ended up in Type but it looks like a Description (e.g. very long line that started late?)
        // Unlikely with PDF.js items.
        
        // Edge Case: If everything ended up in Description, but we have a large gap?
        // Fallback to Gap Analysis if NO Type items found but multiple Description items exist with a large gap
        if (typeItems.length === 0 && descItems.length > 1) {
             let maxGap = 0;
             let splitIndex = -1;

             for (let i = 0; i < descItems.length - 1; i++) {
                 const current = descItems[i];
                 const next = descItems[i+1];
                 const gap = next.x - (current.x + current.width);
                 
                 // If gap crosses the threshold significantly? 
                 // Or just standard gap analysis
                 if (gap > 40) {
                     maxGap = gap;
                     splitIndex = i;
                 }
             }

             if (splitIndex !== -1) {
                 // Re-assign based on gap
                 typeItems = descItems.slice(splitIndex + 1);
                 descItems = descItems.slice(0, splitIndex + 1);
             }
        }

        description = descItems.map(it => it.text).join(' ').trim();
        type = typeItems.map(it => it.text).join(' ').trim();

        return { description, type };
    }

    function updateSummary() {
        const selectedAccount = accountSelect.value;
        const relevantTransactions = selectedAccount === 'all' 
            ? transactions 
            : transactions.filter(t => t.account === selectedAccount);

        const totalIncome = relevantTransactions.reduce((sum, t) => t.amount > 0 ? sum + t.amount : sum, 0);
        const totalExpense = relevantTransactions.reduce((sum, t) => t.amount < 0 ? sum + t.amount : sum, 0);
        const net = totalIncome + totalExpense;

        let summarySection = document.getElementById('summary-section');
        if (!summarySection) {
            summarySection = document.createElement('section');
            summarySection.id = 'summary-section';
            summarySection.className = 'summary-section';
            resultsSection.parentNode.insertBefore(summarySection, resultsSection);
        }

        summarySection.innerHTML = `
            <div class="summary-card income">
                <h3>Total Income</h3>
                <p>+$${totalIncome.toFixed(2)}</p>
            </div>
            <div class="summary-card expense">
                <h3>Total Expense</h3>
                <p>-$${Math.abs(totalExpense).toFixed(2)}</p>
            </div>
            <div class="summary-card net">
                <h3>Net Flow</h3>
                <p style="color: ${net >= 0 ? 'green' : 'red'}">${net >= 0 ? '+' : ''}$${net.toFixed(2)}</p>
            </div>
        `;
    }

    function renderResults() {
        const query = searchInput.value;
        const selectedAccount = accountSelect.value;
        
        resultsBody.innerHTML = '';
        const lowerQuery = query.toLowerCase().trim();
        
        const filtered = transactions.filter(t => {
            if (selectedAccount !== 'all' && t.account !== selectedAccount) return false;

            if (!lowerQuery) return true;
            return t.description.toLowerCase().includes(lowerQuery) || 
                   t.date.toLowerCase().includes(lowerQuery) ||
                   (t.type && t.type.toLowerCase().includes(lowerQuery)) ||
                   t.amountStr.includes(lowerQuery) ||
                   (t.account && t.account.toLowerCase().includes(lowerQuery));
        });

        // Apply Sorting
        if (currentSort.column) {
            filtered.sort((a, b) => {
                let valA, valB;

                switch (currentSort.column) {
                    case 'date':
                        valA = parseDate(a.date);
                        valB = parseDate(b.date);
                        break;
                    case 'amount':
                        valA = a.amount;
                        valB = b.amount;
                        break;
                    case 'account':
                        valA = (a.account || '').toLowerCase();
                        valB = (b.account || '').toLowerCase();
                        break;
                    case 'type':
                        valA = (a.type || '').toLowerCase();
                        valB = (b.type || '').toLowerCase();
                        break;
                    case 'description':
                        valA = (a.description || '').toLowerCase();
                        valB = (b.description || '').toLowerCase();
                        break;
                    default:
                        return 0;
                }

                if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
                if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        // Update Sort Icons
        document.querySelectorAll('th.sortable').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sort === currentSort.column) {
                th.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });

        let filteredSummary = document.getElementById('filtered-summary');
        
        if (lowerQuery) {
            if (!filteredSummary) {
                filteredSummary = document.createElement('div');
                filteredSummary.id = 'filtered-summary';
                filteredSummary.className = 'filtered-summary';
                searchSection.parentNode.insertBefore(filteredSummary, resultsSection);
            }
            
            const fIncome = filtered.reduce((sum, t) => t.amount > 0 ? sum + t.amount : sum, 0);
            const fExpense = filtered.reduce((sum, t) => t.amount < 0 ? sum + t.amount : sum, 0);
            const fNet = fIncome + fExpense;

            filteredSummary.innerHTML = `
                <span><strong>Filtered Results:</strong> ${filtered.length} transactions</span>
                <span class="amount-positive">Income: +$${fIncome.toFixed(2)}</span>
                <span class="amount-negative">Expense: -$${Math.abs(fExpense).toFixed(2)}</span>
                <span style="color: ${fNet >= 0 ? 'green' : 'red'}">Net: ${fNet >= 0 ? '+' : ''}$${fNet.toFixed(2)}</span>
            `;
            filteredSummary.classList.remove('hidden');
        } else {
            if (filteredSummary) filteredSummary.classList.add('hidden');
        }

        matchCount.textContent = `${filtered.length} transactions found`;

        const displayItems = filtered;

        displayItems.forEach(t => {
            const row = document.createElement('tr');
            
            const dateCell = document.createElement('td');
            dateCell.textContent = t.date;
            dateCell.style.whiteSpace = 'nowrap';
            
            const accountCell = document.createElement('td');
            accountCell.textContent = t.account || '-';
            accountCell.style.whiteSpace = 'nowrap';

            const descCell = document.createElement('td');
            if (lowerQuery) {
                const regex = new RegExp(`(${escapeRegExp(lowerQuery)})`, 'gi');
                descCell.innerHTML = escapeHtml(t.description).replace(regex, '<span class="highlight">$1</span>');
            } else {
                descCell.textContent = t.description;
            }

            const typeCell = document.createElement('td');
            if (lowerQuery && t.type) {
                const regex = new RegExp(`(${escapeRegExp(lowerQuery)})`, 'gi');
                typeCell.innerHTML = escapeHtml(t.type).replace(regex, '<span class="highlight">$1</span>');
            } else {
                typeCell.textContent = t.type || '';
            }

            const amountCell = document.createElement('td');
            amountCell.textContent = t.amountStr;
            amountCell.className = t.amount > 0 ? 'amount-positive' : 'amount-negative';
            amountCell.style.textAlign = 'right';

            row.appendChild(dateCell);
            row.appendChild(accountCell);
            row.appendChild(descCell);
            row.appendChild(typeCell);
            row.appendChild(amountCell);
            resultsBody.appendChild(row);
        });

        if (filtered.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 5; 
            cell.style.textAlign = 'center';
            cell.textContent = 'No transactions found.';
            row.appendChild(cell);
            resultsBody.appendChild(row);
        }
    }

    function parseDate(dateStr) {
        // Format: "Jan 22"
        const parts = dateStr.trim().split(/\s+/);
        if (parts.length < 2) return 0;
        
        const monthMap = {
            'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
            'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
        };
        
        const month = monthMap[parts[0].toLowerCase().slice(0, 3)] || 0;
        const day = parseInt(parts[1], 10) || 0;
        
        // Return a comparable number: Month * 100 + Day (e.g., Jan 22 -> 22, Feb 1 -> 101)
        return month * 100 + day;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function exportCSV() {
        const query = searchInput.value.toLowerCase().trim();
        const selectedAccount = accountSelect.value;

        // Re-run filtering to get current view
        const filtered = transactions.filter(t => {
            if (selectedAccount !== 'all' && t.account !== selectedAccount) return false;
            if (!query) return true;
            return t.description.toLowerCase().includes(query) || 
                   t.date.toLowerCase().includes(query) ||
                   (t.type && t.type.toLowerCase().includes(query)) ||
                   t.amountStr.includes(query) ||
                   (t.account && t.account.toLowerCase().includes(query));
        });

        if (filtered.length === 0) {
            alert('No transactions to export.');
            return;
        }

        // CSV Header
        let csvContent = "Date,Account,Description,Type,Amount\n";

        // CSV Rows
        filtered.forEach(t => {
            // Escape quotes by doubling them
            const desc = t.description.replace(/"/g, '""');
            const type = t.type ? t.type.replace(/"/g, '""') : '';
            const acc = t.account ? t.account.replace(/"/g, '""') : '';
            
            // Wrap fields in quotes
            csvContent += `"${t.date}","${acc}","${desc}","${type}","${t.amount}"\n`;
        });

        // Trigger Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `onepay_export_${new Date().toISOString().slice(0,10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
});
