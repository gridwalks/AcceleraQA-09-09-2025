import { UI_CONFIG, APP_CONFIG } from '../config/constants';

/**
 * Filters messages from the last 30 days
 * @param {Object[]} messages - Array of message objects
 * @returns {Object[]} - Filtered messages
 */
function getRecentMessages(messages) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - UI_CONFIG.MESSAGE_HISTORY_DAYS);
  
  return messages.filter(msg => 
    msg.timestamp && new Date(msg.timestamp) >= cutoffDate
  );
}

/**
 * Sanitizes text for CSV export by escaping commas and newlines
 * @param {string} text - Text to sanitize
 * @returns {string} - Sanitized text
 */
function sanitizeForCSV(text) {
  if (!text) return '';
  
  return text
    .replace(/,/g, ';')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .trim();
}

/**
 * Formats resources for export
 * @param {Object[]} resources - Array of resource objects
 * @returns {string} - Formatted resource string
 */
function formatResourcesForExport(resources) {
  if (!resources || resources.length === 0) return '';

  return resources
    .map(r => {
      const title = r.title || 'Untitled Resource';
      const typeLabel = r.type ? ` (${r.type})` : '';

      if (r.url) {
        return `${title}${typeLabel}: ${r.url}`;
      }

      const locationLabel = r.location ? ` - ${r.location}` : '';
      return `${title}${typeLabel}${locationLabel}`;
    })
    .join(' | ');
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';

  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function convertNewlinesToBreaks(text) {
  return escapeHtml(text).replace(/\r?\n/g, '<br/>');
}

function formatResourcesAsHtml(resources) {
  if (!resources || resources.length === 0) {
    return '<p class="resources"><em>No linked resources</em></p>';
  }

  const items = resources
    .map(resource => {
      const title = escapeHtml(resource.title || 'Untitled Resource');
      const type = resource.type ? ` <span class="resource-type">(${escapeHtml(resource.type)})</span>` : '';
      const url = resource.url ? `<div class="resource-url">${escapeHtml(resource.url)}</div>` : '';
      return `<li>${title}${type}${url}</li>`;
    })
    .join('');

  return `<div class="resources"><p><strong>Linked Resources</strong></p><ul>${items}</ul></div>`;
}

/**
 * Downloads a file with the given content
 * @param {Blob} blob - File blob
 * @param {string} filename - Name of the file to download
 */
function downloadFile(blob, filename) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Clean up the URL object
    setTimeout(() => URL.revokeObjectURL(url), 100);
  } catch (error) {
    console.error('Error downloading file:', error);
    throw new Error('Failed to download file. Please try again.');
  }
}

/**
 * Exports conversation history as CSV
 * @param {Object[]} messages - Array of message objects
 */
export function exportNotebook(messages) {
  try {
    if (!messages || messages.length === 0) {
      throw new Error('No messages to export');
    }

    const recentMessages = getRecentMessages(messages);
    
    if (recentMessages.length === 0) {
      throw new Error('No recent messages found to export');
    }

    // CSV headers
    const headers = ['Timestamp', 'Type', 'Message', 'Resources', 'Study Notes'];
    
    // Convert messages to CSV rows
    const rows = recentMessages.map(msg => [
      msg.timestamp || '',
      msg.type || '',
      sanitizeForCSV(msg.content),
      formatResourcesForExport(msg.resources),
      msg.isStudyNotes ? 'Yes' : 'No'
    ]);

    // Combine headers and rows
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${APP_CONFIG.NAME.toLowerCase()}-notebook-${timestamp}.csv`;
    
    downloadFile(blob, filename);
  } catch (error) {
    console.error('Error exporting notebook:', error);
    throw error;
  }
}

/**
 * Exports study notes as Word document
 * @param {Object} studyNotesMessage - Study notes message object
 */
export function exportToWord(studyNotesMessage) {
  try {
    if (!studyNotesMessage || !studyNotesMessage.studyNotesData) {
      throw new Error('Invalid study notes data');
    }

    const studyData = studyNotesMessage.studyNotesData;
    const resources = studyNotesMessage.resources || [];
    
    // Create Word document content
    const wordContent = createWordDocumentContent(studyData, resources);
    
    // Create blob with proper MIME type for Word documents
    const blob = new Blob([wordContent], { 
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${APP_CONFIG.NAME}-Study-Notes-${timestamp}.doc`;
    
    downloadFile(blob, filename);
  } catch (error) {
    console.error('Error exporting to Word:', error);
    throw error;
  }
}

/**
 * Creates formatted content for Word document
 * @param {Object} studyData - Study notes data
 * @param {Object[]} resources - Array of resources
 * @returns {string} - Formatted document content
 */
function createWordDocumentContent(studyData, resources) {
  const content = `
${APP_CONFIG.NAME.toUpperCase()} - PHARMACEUTICAL QUALITY & COMPLIANCE STUDY NOTES

Generated: ${studyData.generatedDate}
Topics Covered: ${studyData.selectedTopics}

${studyData.content}

ADDITIONAL LEARNING RESOURCES (${studyData.resourceCount} items):

${resources.map((resource, index) => 
  `${index + 1}. ${resource.title} (${resource.type})
   Link: ${resource.url}`
).join('\n\n')}

---
Generated by ${APP_CONFIG.NAME} - ${APP_CONFIG.DESCRIPTION}
Export Date: ${new Date().toLocaleString()}
Version: ${APP_CONFIG.VERSION}
`.trim();

  return content;
}

function getMessageTypeLabel(message) {
  const type = (message?.type || message?.role || '').toString().toLowerCase();
  if (type === 'user') return 'User';
  if (type === 'assistant' || type === 'ai') return 'AI Assistant';
  if (type === 'system') return 'System';
  return 'Message';
}

function formatTimestamp(timestamp) {
  if (!timestamp) return 'Unknown time';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString();
}

export function exportMessagesToWord(messages, { title } = {}) {
  try {
    if (!messages || messages.length === 0) {
      throw new Error('No messages to export');
    }

    const recentMessages = getRecentMessages(messages)
      .slice()
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (recentMessages.length === 0) {
      throw new Error('No recent messages found to export');
    }

    const heading = title || `${APP_CONFIG.NAME} Conversation Export`;
    const exportDate = new Date();

    const sections = recentMessages.map((msg, index) => {
      const position = index + 1;
      const typeLabel = getMessageTypeLabel(msg);
      const timestampLabel = formatTimestamp(msg.timestamp);
      const contentHtml = convertNewlinesToBreaks(msg.content || '');
      const resourcesHtml = formatResourcesAsHtml(msg.resources || []);

      return `
        <section class="message">
          <h2>${position}. ${typeLabel}</h2>
          <div class="meta">Timestamp: ${escapeHtml(timestampLabel)}</div>
          <div class="content">${contentHtml}</div>
          ${resourcesHtml}
          ${msg.isStudyNotes ? '<div class="study-note">Study Notes Entry</div>' : ''}
        </section>
      `;
    }).join('');

    const htmlDocument = `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(heading)}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; color: #111827; line-height: 1.5; }
            h1 { font-size: 22px; margin-bottom: 4px; }
            h2 { font-size: 16px; margin: 16px 0 4px; }
            .meta { font-size: 12px; color: #4b5563; margin-bottom: 8px; }
            .content { font-size: 14px; background: #f9fafb; padding: 12px; border-radius: 8px; }
            .resources { margin-top: 8px; }
            .resources ul { margin: 4px 0 0 16px; }
            .resources li { margin-bottom: 4px; }
            .study-note { margin-top: 8px; font-size: 12px; color: #1d4ed8; }
            header { margin-bottom: 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 12px; }
          </style>
        </head>
        <body>
          <header>
            <h1>${escapeHtml(heading)}</h1>
            <p><strong>Export Date:</strong> ${escapeHtml(exportDate.toLocaleString())}</p>
            <p><strong>Time Period:</strong> Last ${UI_CONFIG.MESSAGE_HISTORY_DAYS} days</p>
            <p><strong>Total Messages:</strong> ${recentMessages.length}</p>
          </header>
          ${sections}
          <footer style="margin-top:24px; font-size:12px; color:#6b7280;">
            Generated by ${escapeHtml(APP_CONFIG.NAME)} v${escapeHtml(APP_CONFIG.VERSION)}
          </footer>
        </body>
      </html>`;

    const blob = new Blob(['\ufeff', htmlDocument], {
      type: 'application/msword;charset=utf-8;'
    });

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${APP_CONFIG.NAME.toLowerCase()}-conversation-${timestamp}.doc`;

    downloadFile(blob, filename);
  } catch (error) {
    console.error('Error exporting messages to Word:', error);
    throw error;
  }
}

export function exportMessagesToExcel(messages, { title } = {}) {
  try {
    if (!messages || messages.length === 0) {
      throw new Error('No messages to export');
    }

    const recentMessages = getRecentMessages(messages)
      .slice()
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (recentMessages.length === 0) {
      throw new Error('No recent messages found to export');
    }

    const heading = title || `${APP_CONFIG.NAME} Conversation Export`;
    const rows = recentMessages.map(msg => {
      const timestampLabel = escapeHtml(formatTimestamp(msg.timestamp));
      const typeLabel = escapeHtml(getMessageTypeLabel(msg));
      const content = convertNewlinesToBreaks(msg.content || '');
      const resources = convertNewlinesToBreaks(
        (msg.resources || [])
          .map(res => {
            const title = res.title ? escapeHtml(res.title) : 'Untitled Resource';
            const type = res.type ? ` (${escapeHtml(res.type)})` : '';
            const url = res.url ? `: ${escapeHtml(res.url)}` : '';
            return `${title}${type}${url}`;
          })
          .join('\n')
      );
      const studyNotes = msg.isStudyNotes ? 'Yes' : 'No';

      return `<tr>
        <td>${timestampLabel}</td>
        <td>${typeLabel}</td>
        <td>${content}</td>
        <td>${resources}</td>
        <td>${escapeHtml(studyNotes)}</td>
      </tr>`;
    }).join('');

    const table = `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(heading)}</title>
        </head>
        <body>
          <table border="1">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Type</th>
                <th>Message</th>
                <th>Resources</th>
                <th>Study Notes</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </body>
      </html>`;

    const blob = new Blob(['\ufeff', table], {
      type: 'application/vnd.ms-excel;charset=utf-8;'
    });

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${APP_CONFIG.NAME.toLowerCase()}-conversation-${timestamp}.xls`;

    downloadFile(blob, filename);
  } catch (error) {
    console.error('Error exporting messages to Excel:', error);
    throw error;
  }
}

const EXPORT_PATTERNS = [
  /\bexport\b/,
  /\bdownload\b/,
  /\bsave\b/,
  /\bgenerate\b/,
  /\bcreate\b/,
];

const WORD_PATTERNS = [/\bword\b/, /\bdocx?\b/, /\bmicrosoft word\b/];
const EXCEL_PATTERNS = [/\bexcel\b/, /\bxls\b/, /\bxlsx\b/, /\bspreadsheet\b/, /\bmicrosoft excel\b/];

export function detectDocumentExportIntent(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const lower = text.toLowerCase();
  const hasExportKeyword = EXPORT_PATTERNS.some(pattern => pattern.test(lower));

  if (!hasExportKeyword) {
    return null;
  }

  if (WORD_PATTERNS.some(pattern => pattern.test(lower))) {
    return 'word';
  }

  if (EXCEL_PATTERNS.some(pattern => pattern.test(lower))) {
    return 'excel';
  }

  return null;
}

/**
 * Exports selected conversations as JSON
 * @param {Object[]} selectedMessages - Array of selected message objects
 */
export function exportSelectedConversations(selectedMessages) {
  try {
    if (!selectedMessages || selectedMessages.length === 0) {
      throw new Error('No conversations selected for export');
    }

    const exportData = {
      exportDate: new Date().toISOString(),
      appVersion: APP_CONFIG.VERSION,
      totalConversations: selectedMessages.length,
      conversations: selectedMessages.map(msg => ({
        id: msg.id,
        type: msg.type,
        content: msg.content,
        timestamp: msg.timestamp,
        resources: msg.resources || [],
        isStudyNotes: msg.isStudyNotes || false
      }))
    };

    const jsonContent = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${APP_CONFIG.NAME.toLowerCase()}-conversations-${timestamp}.json`;
    
    downloadFile(blob, filename);
  } catch (error) {
    console.error('Error exporting conversations:', error);
    throw error;
  }
}

/**
 * Exports conversation history as plain text
 * @param {Object[]} messages - Array of message objects
 */
export function exportAsText(messages) {
  try {
    if (!messages || messages.length === 0) {
      throw new Error('No messages to export');
    }

    const recentMessages = getRecentMessages(messages);
    
    if (recentMessages.length === 0) {
      throw new Error('No recent messages found to export');
    }

    let textContent = `${APP_CONFIG.NAME} - CONVERSATION HISTORY\n`;
    textContent += `Export Date: ${new Date().toLocaleString()}\n`;
    textContent += `Time Period: Last ${UI_CONFIG.MESSAGE_HISTORY_DAYS} days\n`;
    textContent += `Total Messages: ${recentMessages.length}\n\n`;
    textContent += '='.repeat(80) + '\n\n';

    recentMessages.forEach((msg, index) => {
      const timestamp = new Date(msg.timestamp).toLocaleString();
      const messageType = msg.type === 'user' ? 'USER' : 'AI ASSISTANT';
      
      textContent += `Message ${index + 1} - ${messageType} (${timestamp})\n`;
      textContent += '-'.repeat(50) + '\n';
      textContent += `${msg.content}\n\n`;
      
      if (msg.resources && msg.resources.length > 0) {
        textContent += 'Learning Resources:\n';
        msg.resources.forEach(resource => {
          textContent += `• ${resource.title} (${resource.type}): ${resource.url}\n`;
        });
        textContent += '\n';
      }
      
      if (msg.isStudyNotes) {
        textContent += '[Study Notes Generated]\n\n';
      }
      
      textContent += '='.repeat(80) + '\n\n';
    });

    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8;' });
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${APP_CONFIG.NAME.toLowerCase()}-conversations-${timestamp}.txt`;
    
    downloadFile(blob, filename);
  } catch (error) {
    console.error('Error exporting as text:', error);
    throw error;
  }
}

/**
 * Gets export statistics for the given messages
 * @param {Object[]} messages - Array of message objects
 * @returns {Object} - Export statistics
 */
export function getExportStats(messages) {
  const recentMessages = getRecentMessages(messages);
  const userMessages = recentMessages.filter(msg => msg.type === 'user');
  const aiMessages = recentMessages.filter(msg => msg.type === 'ai');
  const studyNotes = recentMessages.filter(msg => msg.isStudyNotes);
  const messagesWithResources = recentMessages.filter(msg => msg.resources && msg.resources.length > 0);

  return {
    totalMessages: recentMessages.length,
    userMessages: userMessages.length,
    aiMessages: aiMessages.length,
    studyNotes: studyNotes.length,
    messagesWithResources: messagesWithResources.length,
    oldestMessage: recentMessages.length > 0 ? 
      new Date(Math.min(...recentMessages.map(msg => new Date(msg.timestamp)))) : null,
    newestMessage: recentMessages.length > 0 ? 
      new Date(Math.max(...recentMessages.map(msg => new Date(msg.timestamp)))) : null
  };
}
