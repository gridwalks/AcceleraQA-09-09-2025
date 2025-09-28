// netlify/functions/conversations-blob.js - Fixed with ES modules
import { getStore } from '@netlify/blobs';

// Get blob store for conversations
const getConversationStore = () => getStore('conversations');
const getUserStore = () => getStore('user-data');

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

export const handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'CORS preflight' }),
    };
  }

  try {
    const { httpMethod, body, path } = event;
    const { user } = context.clientContext || {};
    
    // Extract user ID from Auth0 context
    const userId = user?.sub || event.headers['x-user-id'];
    
    if (!userId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'User authentication required' }),
      };
    }

    switch (httpMethod) {
      case 'GET':
        if (path && path.endsWith('/stats')) {
          return await getConversationStats(userId);
        }
        return await getConversations(userId);
      
      case 'POST':
        return await saveConversation(userId, JSON.parse(body));
      
      case 'DELETE':
        return await deleteConversations(userId);
      
      default:
        return {
          statusCode: 405,
          headers,
          body: JSON.stringify({ error: 'Method not allowed' }),
        };
    }
  } catch (error) {
    console.error('Conversations Blob Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }),
    };
  }
};

const sanitizeConversationId = (id) => {
  if (!id) return null;
  const trimmed = String(id).trim();
  if (!trimmed) return null;
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
};

const sortMessagesByTimestamp = (messages = []) =>
  messages
    .slice()
    .sort((a, b) => {
      const aTime = a?.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTime = b?.timestamp ? new Date(b.timestamp).getTime() : 0;
      return aTime - bTime;
    });

/**
 * Save conversation with enhanced RAG tracking
 */
async function saveConversation(userId, conversationData = {}) {
  try {
    const conversationStore = getConversationStore();

    const { messages, metadata = {}, conversationId: payloadConversationId } = conversationData;

    // Validate required fields
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Valid messages array is required' }),
      };
    }

    const firstMessage = messages[0] || {};
    const metadataConversationId = metadata.conversationId || metadata.threadId || metadata.sessionId;
    const messageConversationId = firstMessage.conversationId || firstMessage.threadId || firstMessage.sessionId;

    const resolvedConversationId =
      sanitizeConversationId(payloadConversationId) ||
      sanitizeConversationId(metadataConversationId) ||
      sanitizeConversationId(messageConversationId);

    const conversationId =
      resolvedConversationId || `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const conversationKey = `${userId}/${conversationId}`;

    const existingData = await conversationStore.get(conversationKey);
    const existingConversation = existingData ? JSON.parse(existingData) : null;


    const timestamp = new Date().toISOString();

    const existingMessages = Array.isArray(existingConversation?.messages)
      ? existingConversation.messages
      : [];

    const messageMap = new Map();

    existingMessages.forEach(msg => {
      if (msg && msg.id) {
        messageMap.set(msg.id, msg);
      }
    });

    messages.forEach(msg => {
      if (msg && msg.id) {
        const existing = messageMap.get(msg.id) || {};
        messageMap.set(msg.id, { ...existing, ...msg });
      }
    });

    const mergedMessages = sortMessagesByTimestamp(Array.from(messageMap.values()));
    const addedMessageCount = Math.max(0, mergedMessages.length - existingMessages.length);

    const mergedRagMessages = mergedMessages.filter(msg => msg.sources && msg.sources.length > 0);
    const mergedRagDocuments = [...new Set(
      mergedRagMessages.flatMap(msg => msg.sources?.map(source => source.documentId) || [])
    )];

    const mergedMetadata = {
      ...(existingConversation?.metadata || {}),
      ...metadata,
      conversationId,
      messageCount: mergedMessages.length,
      lastActivity: timestamp,
      ragUsed: mergedRagMessages.length > 0,
      ragDocuments: mergedRagDocuments,
      ragMessageCount: mergedRagMessages.length,
    };

    const conversationRecord = {
      id: conversationId,
      userId,
      messages: mergedMessages,
      metadata: mergedMetadata,
      messageCount: mergedMessages.length,
      usedRag: mergedRagMessages.length > 0,
      ragDocuments: mergedRagDocuments,
      ragMessageCount: mergedRagMessages.length,
      createdAt: existingConversation?.createdAt || timestamp,
      updatedAt: timestamp
    };

    await conversationStore.set(conversationKey, JSON.stringify(conversationRecord));

    const statsDeltas = {};

    if (!existingConversation) {
      statsDeltas.conversations = 1;
    }

    if (addedMessageCount > 0) {
      statsDeltas.messages = addedMessageCount;
    }

    const previouslyUsedRag = existingConversation?.usedRag || false;
    const currentlyUsesRag = mergedRagMessages.length > 0;

    if (!existingConversation) {
      statsDeltas.ragConversations = currentlyUsesRag ? 1 : 0;
    } else if (previouslyUsedRag !== currentlyUsesRag) {
      statsDeltas.ragConversations = currentlyUsesRag ? 1 : -1;
    }

    if (Object.keys(statsDeltas).length > 0) {
      await updateUserConversationStats(userId, statsDeltas);
    }

    return {
      statusCode: existingConversation ? 200 : 201,
      headers,
      body: JSON.stringify({
        id: conversationId,
        created_at: conversationRecord.createdAt,
        updated_at: timestamp,
        message: existingConversation
          ? 'Conversation updated successfully'
          : 'Conversation saved successfully',
        messageCount: mergedMessages.length,
        ragUsed: currentlyUsesRag,
        ragDocuments: mergedRagDocuments.length,
        appendedMessages: addedMessageCount,
        isNewConversation: !existingConversation
      }),
    };
  } catch (error) {
    console.error('Error saving conversation:', error);
    throw error;
  }
}

/**
 * Update user conversation statistics
 */
async function updateUserConversationStats(userId, deltas) {
  try {
    const userStore = getUserStore();
    const statsKey = `${userId}/conversation_stats`;
    
    // Get current stats
    const currentStatsData = await userStore.get(statsKey);
    let stats = {
      conversations: 0,
      messages: 0,
      ragConversations: 0,
      lastUpdated: new Date().toISOString()
    };
    
    if (currentStatsData) {
      stats = { ...stats, ...JSON.parse(currentStatsData) };
    }
    
    // Update stats with deltas
    Object.keys(deltas).forEach(key => {
      stats[key] = Math.max(0, (stats[key] || 0) + deltas[key]);
    });
    
    stats.lastUpdated = new Date().toISOString();
    
    // Save updated stats
    await userStore.set(statsKey, JSON.stringify(stats));
  } catch (error) {
    console.warn('Error updating user conversation stats:', error);
  }
}

/**
 * Reset user conversation statistics
 */
async function resetUserConversationStats(userId) {
  try {
    const userStore = getUserStore();
    const statsKey = `${userId}/conversation_stats`;

    const resetStats = {
      conversations: 0,
      messages: 0,
      ragConversations: 0,
      lastUpdated: new Date().toISOString()
    };

    await userStore.set(statsKey, JSON.stringify(resetStats));
  } catch (error) {
    console.warn('Error resetting user conversation stats:', error);
  }
}

/**
 * Get conversations for user
 */
async function getConversations(userId) {
  try {
    const conversationStore = getConversationStore();
    const conversations = [];
    
    // List all conversations for the user
    const convsList = conversationStore.list(`${userId}/`);
    
    for await (const { key } of convsList) {
      try {
        const convData = await conversationStore.get(key);
        if (convData) {
          const conversation = JSON.parse(convData);
          conversations.push({
            id: conversation.id,
            messages: conversation.messages,
            metadata: conversation.metadata,
            messageCount: conversation.messageCount,
            used_rag: conversation.usedRag,
            rag_documents_referenced: conversation.ragDocuments,
            created_at: conversation.createdAt,
            updated_at: conversation.updatedAt
          });
        }
      } catch (error) {
        console.warn(`Error processing conversation ${key}:`, error);
      }
    }

    // Sort by creation date (newest first)
    conversations.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Limit to most recent 100 conversations
    const recentConversations = conversations.slice(0, 100);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        conversations: recentConversations,
        total: recentConversations.length
      }),
    };
  } catch (error) {
    console.error('Error getting conversations:', error);
    
    // Return empty result if no conversations found
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ conversations: [], total: 0 }),
    };
  }
}

/**
 * Delete all conversations for user
 */
async function deleteConversations(userId) {
  try {
    const conversationStore = getConversationStore();
    let deletedCount = 0;
    
    // List and delete all conversations for the user
    const convsList = conversationStore.list(`${userId}/`);
    const deletePromises = [];
    
    for await (const { key } of convsList) {
      deletePromises.push(conversationStore.delete(key));
      deletedCount++;
    }
    
    await Promise.all(deletePromises);

    // Reset user conversation stats
    await resetUserConversationStats(userId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: 'All conversations deleted successfully',
        deletedCount
      }),
    };
  } catch (error) {
    console.error('Error deleting conversations:', error);
    throw error;
  }
}

/**
 * Get conversation statistics
 */
async function getConversationStats(userId) {
  try {
    const conversationStore = getConversationStore();
    
    let totalConversations = 0;
    let totalMessages = 0;
    let ragConversations = 0;
    let oldestConversation = null;
    let newestConversation = null;
    
    // Analyze all conversations
    const convsList = conversationStore.list(`${userId}/`);
    
    for await (const { key } of convsList) {
      try {
        const convData = await conversationStore.get(key);
        if (convData) {
          const conversation = JSON.parse(convData);
          
          totalConversations++;
          totalMessages += conversation.messageCount || 0;
          
          if (conversation.usedRag) {
            ragConversations++;
          }
          
          const convDate = new Date(conversation.createdAt);
          if (!oldestConversation || convDate < new Date(oldestConversation)) {
            oldestConversation = conversation.createdAt;
          }
          if (!newestConversation || convDate > new Date(newestConversation)) {
            newestConversation = conversation.createdAt;
          }
        }
      } catch (error) {
        console.warn(`Error processing conversation stats for ${key}:`, error);
      }
    }

    const ragUsagePercentage = totalConversations > 0 ? 
      Math.round((ragConversations / totalConversations) * 100 * 100) / 100 : 0;
    
    const avgMessagesPerConversation = totalConversations > 0 ?
      Math.round((totalMessages / totalConversations) * 100) / 100 : 0;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        stats: {
          totalConversations,
          totalMessages,
          ragConversations,
          ragUsagePercentage,
          avgMessagesPerConversation,
          oldestConversation,
          newestConversation
        }
      }),
    };
  } catch (error) {
    console.error('Error getting conversation stats:', error);
    throw error;
  }
}
