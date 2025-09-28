// src/services/learningSuggestionsService.js
import neonService from './neonService';
import { FEATURE_FLAGS } from '../config/featureFlags';
import { findBestResourceMatch } from '../utils/resourceGenerator';

const TOPIC_SUGGESTIONS = {
  gmp: {
    id: 'gmp_inspection_readiness',
    title: 'Strengthen GMP Inspection Readiness',
    type: 'Guideline',
    description: 'Review current FDA/EMA inspection focus areas and create an internal readiness checklist aligned with recent findings.',
    objective: 'Translate recent GMP questions into a proactive inspection preparation plan',
    difficulty: 'Intermediate'
  },
  validation: {
    id: 'process_validation_strategy',
    title: 'Modernize Process Validation Strategy',
    type: 'Workshop',
    description: 'Assess Stage 1–3 validation evidence and identify continuous verification signals for critical parameters.',
    objective: 'Turn conversation learnings into a lifecycle validation roadmap with measurable checkpoints',
    difficulty: 'Advanced'
  },
  capa: {
    id: 'capa_effectiveness_review',
    title: 'CAPA Effectiveness Deep Dive',
    type: 'Training',
    description: 'Map recurring deviations to CAPA actions and define effectiveness metrics tied to risk priority numbers.',
    objective: 'Improve root-cause depth and verify CAPA closure evidence using Neon-saved conversations',
    difficulty: 'Intermediate'
  },
  regulatory: {
    id: 'global_regulatory_landscape',
    title: 'Track Global Regulatory Updates',
    type: 'Reference',
    description: 'Consolidate FDA, EMA, and ICH updates referenced in recent conversations into a quarterly monitoring brief.',
    objective: 'Ensure teams act on the most recent regulatory expectations highlighted during support chats',
    difficulty: 'Intermediate'
  },
  quality_control: {
    id: 'qc_method_reliability',
    title: 'QC Method Reliability Checks',
    type: 'Checklist',
    description: 'Validate analytical method lifecycle control by reviewing system suitability failures discussed with the assistant.',
    objective: 'Establish data-driven triggers for method revalidation and technician coaching',
    difficulty: 'Intermediate'
  },
  sterile_processing: {
    id: 'aseptic_process_risk_review',
    title: 'Aseptic Process Risk Review',
    type: 'Workshop',
    description: 'Revisit aseptic interventions and environmental monitoring questions to refresh contamination control strategies.',
    objective: 'Prioritize mitigations for the highest contamination risks raised in chat history',
    difficulty: 'Advanced'
  },
  supply_chain: {
    id: 'supplier_qualification_refresh',
    title: 'Refresh Supplier Qualification Program',
    type: 'Program',
    description: 'Document supplier issues surfaced in conversations and align qualification tiers with business criticality.',
    objective: 'Build a multi-tier supplier monitoring plan with Neon-linked CAPA follow-up actions',
    difficulty: 'Intermediate'
  },
  risk_management: {
    id: 'qrm_playbook_update',
    title: 'Update the Quality Risk Management Playbook',
    type: 'Guideline',
    description: 'Convert risk-themed questions into refreshed FMEA templates and risk review cadences.',
    objective: 'Operationalize ICH Q9(R1) principles using conversation-derived scenarios',
    difficulty: 'Intermediate'
  },
  documentation: {
    id: 'documentation_standards_boost',
    title: 'Boost Documentation Standards',
    type: 'Training',
    description: 'Audit SOP language and change-control hygiene based on issues identified across recent support chats.',
    objective: 'Clarify authorship expectations and approval flows to close documentation gaps',
    difficulty: 'Beginner'
  },
  training: {
    id: 'targeted_training_pathways',
    title: 'Create Targeted Training Pathways',
    type: 'Program',
    description: 'Group repeated competency questions into role-based microlearning playlists.',
    objective: 'Deliver just-in-time training that reinforces weak spots highlighted by team conversations',
    difficulty: 'Beginner'
  }
};

const INDUSTRY_SUGGESTIONS = {
  biologics: {
    id: 'biologics_control_strategy',
    title: 'Biologics Control Strategy Alignment',
    type: 'Guideline',
    description: 'Map upstream/downstream risks discussed with the assistant to control points in your biologics lifecycle.',
    objective: 'Ensure critical quality attributes remain protected from cell culture through fill-finish',
    difficulty: 'Advanced'
  },
  small_molecule: {
    id: 'small_molecule_ppqs',
    title: 'Optimize Small Molecule PPQ Readiness',
    type: 'Workshop',
    description: 'Use Neon conversation exports to align process performance qualification evidence with stage-gate criteria.',
    objective: 'Strengthen validation packages before regulatory submission',
    difficulty: 'Intermediate'
  },
  medical_device: {
    id: 'device_qms_improvement',
    title: 'Medical Device QMS Improvement Sprint',
    type: 'Program',
    description: 'Translate chat questions about 21 CFR 820 into actionable QMS backlog items.',
    objective: 'Close the most critical device quality system gaps in the next 60 days',
    difficulty: 'Intermediate'
  },
  vaccines: {
    id: 'vaccine_cold_chain_assurance',
    title: 'Vaccine Cold Chain Assurance Review',
    type: 'Checklist',
    description: 'Audit cold chain excursions and contingency plans mentioned in chats against WHO guidance.',
    objective: 'Secure temperature-controlled logistics for upcoming campaigns',
    difficulty: 'Advanced'
  },
  gene_therapy: {
    id: 'gene_therapy_compliance',
    title: 'Gene Therapy Compliance Guardrails',
    type: 'Guideline',
    description: 'Aggregate regulatory and biosafety themes raised in Neon conversations into a compliance readiness matrix.',
    objective: 'Demonstrate robust oversight for complex, high-risk modalities',
    difficulty: 'Advanced'
  }
};

const COMPLEXITY_SUGGESTIONS = {
  basic: {
    id: 'quality_basics_foundation',
    title: 'Reinforce Quality System Foundations',
    type: 'Learning Path',
    description: 'Turn introductory-level conversations into a structured refresher across deviation handling, change control, and CAPA basics.',
    objective: 'Build confidence in core pharmaceutical quality responsibilities',
    difficulty: 'Beginner'
  },
  intermediate: {
    id: 'scale_quality_leadership',
    title: 'Scale Quality Leadership Skills',
    type: 'Workshop',
    description: 'Advance from tactical question handling to leading cross-functional risk reviews and data-driven decisions.',
    objective: 'Translate daily problem-solving into repeatable governance rituals',
    difficulty: 'Intermediate'
  },
  advanced: {
    id: 'enterprise_quality_strategy',
    title: 'Drive Enterprise Quality Strategy',
    type: 'Program',
    description: 'Package complex, high-volume questions into an executive quality roadmap with measurable OKRs.',
    objective: 'Elevate insights from Neon chats into portfolio-level decisions',
    difficulty: 'Advanced'
  }
};

class LearningSuggestionsService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes cache
  }

  attachResourceLink(suggestion) {
    if (!suggestion) {
      return suggestion;
    }

    const textToMatch = `${suggestion.title || ''} ${suggestion.description || ''} ${suggestion.objective || ''}`.trim();
    const matchedResource = findBestResourceMatch(textToMatch, suggestion.type);

    if (matchedResource?.url) {
      return {
        ...suggestion,
        url: suggestion.url || matchedResource.url,
        linkedResourceTitle: matchedResource.title,
        linkedResourceType: matchedResource.type
      };
    }

    return {
      ...suggestion,
      url: suggestion.url || this.generateFallbackUrl(suggestion.title)
    };
  }

  generateFallbackUrl(title) {
    const baseQuery = title && title.trim()
      ? `${title} pharmaceutical quality`
      : 'pharmaceutical quality learning resource';
    return `https://www.google.com/search?q=${encodeURIComponent(baseQuery)}`;
  }

  /**
   * Gets learning suggestions based on user's recent conversations
   * @param {string} userId - User identifier
   * @returns {Promise<Object[]>} - Array of learning suggestions
   */
  async getLearningSuggestions(userId) {
    if (!FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS) {
      return [];
    }
    try {
      console.log('Getting learning suggestions for user:', userId);

      // Check cache first
      const cacheKey = `suggestions_${userId}`;
      const cached = this.cache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        console.log('Returning cached learning suggestions');
        return cached.suggestions;
      }

        // Get user's recent conversations from the Neon backend
      const recentConversations = await this.getRecentConversations();

      if (!recentConversations || recentConversations.length === 0) {
        console.log('No recent conversations found, returning default suggestions');
        return this.getDefaultSuggestions();
      }

      // Analyze conversations and generate suggestions
      const suggestions = await this.generateSuggestionsFromConversations(
        recentConversations.slice(0, 5) // Use last 5 as specified
      );

      // Cache the results
      this.cache.set(cacheKey, {
        suggestions,
        timestamp: Date.now()
      });

      return suggestions;

    } catch (error) {
      console.error('Error getting learning suggestions:', error);
      return this.getDefaultSuggestions();
    }
  }

  /**
   * Fetches last 10 conversations from the conversation service
   * @returns {Promise<Object[]>} - Recent conversations
   */
  async getRecentConversations() {
    if (!FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS) {
      return [];
    }
    try {
      const conversations = await neonService.loadConversations();
      return conversations.slice(-10).reverse();
    } catch (error) {
      console.error('Error fetching recent conversations:', error);
      throw error;
    }
  }

  /**
   * Generates learning suggestions using Neon conversation data
   * @param {Object[]} conversations - Recent conversations
   * @returns {Promise<Object[]>} - Generated suggestions
   */
  async generateSuggestionsFromConversations(conversations) {
    if (!FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS) {
      return [];
    }
    try {
      // Extract and analyze conversation topics
      const conversationSummary = this.analyzeConversationTopics(conversations);

      const suggestions = this.buildSuggestionsFromSummary(
        conversationSummary,
        conversations
      );

      if (!suggestions.length) {
        return this.getDefaultSuggestions();
      }

      return suggestions;

    } catch (error) {
      console.error('Error generating suggestions from conversations:', error);
      return this.getDefaultSuggestions();
    }
  }

  /**
   * Analyzes conversation topics and patterns
   * @param {Object[]} conversations - Conversations to analyze
   * @returns {Object} - Analysis summary
   */
  analyzeConversationTopics(conversations) {
    const analysis = {
      topics: new Set(),
      questionTypes: new Set(),
      complexity: 'basic',
      industries: new Set(),
      totalMessages: 0,
      timeframe: null
    };

    conversations.forEach(conv => {
      if (conv.messages && Array.isArray(conv.messages)) {
        analysis.totalMessages += conv.messages.length;
        
        conv.messages.forEach(msg => {
          if (msg.type === 'user' && msg.content) {
            // Extract pharmaceutical topics
            this.extractPharmaceuticalTopics(msg.content, analysis.topics);
            
            // Determine question complexity
            this.analyzeQuestionComplexity(msg.content, analysis);
            
            // Extract industry context
            this.extractIndustryContext(msg.content, analysis.industries);
          }
        });
      }
    });

    // Determine overall complexity level
    if (analysis.totalMessages > 20) {
      analysis.complexity = 'advanced';
    } else if (analysis.totalMessages > 10) {
      analysis.complexity = 'intermediate';
    }

    return {
      ...analysis,
      topics: Array.from(analysis.topics),
      questionTypes: Array.from(analysis.questionTypes),
      industries: Array.from(analysis.industries)
    };
  }

  /**
   * Extracts pharmaceutical topics from conversation content
   * @param {string} content - Message content
   * @param {Set} topics - Topics set to update
   */
  extractPharmaceuticalTopics(content, topics) {
    const lowerContent = content.toLowerCase();
    
    const topicMap = {
      'gmp': ['gmp', 'cgmp', 'good manufacturing practice'],
      'validation': ['validation', 'qualify', 'qualification', 'iq', 'oq', 'pq'],
      'capa': ['capa', 'corrective', 'preventive', 'root cause'],
      'regulatory': ['fda', 'ema', 'ich', 'regulatory', 'compliance'],
      'quality_control': ['qc', 'quality control', 'testing', 'analytical'],
      'sterile_processing': ['sterile', 'aseptic', 'contamination'],
      'supply_chain': ['supply chain', 'vendor', 'supplier', 'logistics'],
      'risk_management': ['risk', 'qrm', 'fmea', 'risk assessment'],
      'documentation': ['documentation', 'sop', 'procedure', 'protocol'],
      'training': ['training', 'competency', 'qualification']
    };

    Object.entries(topicMap).forEach(([topic, keywords]) => {
      if (keywords.some(keyword => lowerContent.includes(keyword))) {
        topics.add(topic);
      }
    });
  }

  /**
   * Analyzes question complexity
   * @param {string} content - Message content
   * @param {Object} analysis - Analysis object to update
   */
  analyzeQuestionComplexity(content, analysis) {
    const lowerContent = content.toLowerCase();
    
    // Complexity indicators
    const complexityIndicators = {
      basic: ['what is', 'how to', 'explain', 'define'],
      intermediate: ['why does', 'how would', 'compare', 'analyze'],
      advanced: ['optimize', 'implement', 'strategy', 'framework', 'methodology']
    };

    Object.entries(complexityIndicators).forEach(([level, indicators]) => {
      if (indicators.some(indicator => lowerContent.includes(indicator))) {
        analysis.questionTypes.add(level);
      }
    });
  }

  /**
   * Extracts industry context
   * @param {string} content - Message content
   * @param {Set} industries - Industries set to update
   */
  extractIndustryContext(content, industries) {
    const lowerContent = content.toLowerCase();
    
    const industryKeywords = {
      'biologics': ['biologics', 'biosimilar', 'monoclonal', 'antibody'],
      'small_molecule': ['tablet', 'capsule', 'api', 'synthesis'],
      'medical_device': ['device', 'diagnostic', 'medical device'],
      'vaccines': ['vaccine', 'immunization', 'adjuvant'],
      'gene_therapy': ['gene therapy', 'cell therapy', 'car-t']
    };

    Object.entries(industryKeywords).forEach(([industry, keywords]) => {
      if (keywords.some(keyword => lowerContent.includes(keyword))) {
        industries.add(industry);
      }
    });
  }

  buildSuggestionsFromSummary(analysis, conversations) {
    if (!FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS) {
      return [];
    }

    const personalized = [];
    const seenTitles = new Set();

    const addSuggestion = (template, context = {}) => {
      if (!template || seenTitles.has(template.title)) {
        return;
      }

      const suggestion = this.attachResourceLink({
        id: `${template.id}_${Math.random().toString(36).slice(2, 8)}`,
        title: template.title,
        type: template.type,
        description: template.description,
        objective: template.objective,
        difficulty: template.difficulty || this.mapComplexityToDifficulty(analysis.complexity),
        relevanceScore: context.relevanceScore || this.estimateRelevanceScore(analysis),
        source: 'neon_conversation_analysis',
        isPersonalized: true,
        metadata: {
          topics: analysis.topics,
          industries: analysis.industries,
          complexity: analysis.complexity,
          totalMessages: analysis.totalMessages,
          ...context
        }
      });

      seenTitles.add(template.title);
      personalized.push(suggestion);
    };

    analysis.topics.forEach(topic => {
      addSuggestion(TOPIC_SUGGESTIONS[topic], { focus: topic, relevanceScore: 9 });
    });

    analysis.industries.forEach(industry => {
      addSuggestion(INDUSTRY_SUGGESTIONS[industry], { focus: industry, relevanceScore: 8 });
    });

    if (personalized.length < 4) {
      addSuggestion(COMPLEXITY_SUGGESTIONS[analysis.complexity], { relevanceScore: 7 });
    }

    if (personalized.length < 5) {
      const engagementTemplate = this.buildEngagementSuggestion(analysis, conversations);
      addSuggestion(engagementTemplate, { relevanceScore: 6 });
    }

    return personalized.slice(0, 6);
  }

  mapComplexityToDifficulty(complexity) {
    switch (complexity) {
      case 'advanced':
        return 'Advanced';
      case 'intermediate':
        return 'Intermediate';
      default:
        return 'Beginner';
    }
  }

  estimateRelevanceScore(analysis) {
    const base = Math.min(10, Math.max(5, Math.floor(analysis.totalMessages / 5) + 6));
    const topicBoost = Math.min(2, analysis.topics.length);
    const industryBoost = analysis.industries.length ? 1 : 0;
    return Math.min(10, base + topicBoost + industryBoost);
  }

  buildEngagementSuggestion(analysis, conversations) {
    const mostRecentConversation = conversations[0];
    const lastUpdated = mostRecentConversation?.updated_at || mostRecentConversation?.timestamp;
    const timeframeDescription = lastUpdated
      ? `from ${new Date(lastUpdated).toLocaleDateString()}`
      : 'captured this month';

    return {
      id: 'neon_knowledge_base',
      title: 'Turn Neon Conversations into a Knowledge Base',
      type: 'Playbook',
      description: `Export recent Neon conversations ${timeframeDescription} and tag recurring decision points so future chats start with documented context.`,
      objective: 'Operationalize captured Q&A threads into a reusable playbook for your quality team',
      difficulty: this.mapComplexityToDifficulty(analysis.complexity)
    };
  }

  /**
   * Returns default learning suggestions when no conversations available
   * @returns {Object[]} - Default suggestions
   */
  getDefaultSuggestions() {
    if (!FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS) {
      return [];
    }
    return [
      {
        id: 'default_gmp_fundamentals',
        title: 'GMP Fundamentals for New Professionals',
        type: 'Training',
        description: 'Essential Good Manufacturing Practice principles every pharmaceutical professional should master.',
        objective: 'Build foundational knowledge of GMP requirements and implementation',
        difficulty: 'Beginner',
        relevanceScore: 9,
        source: 'default',
        isPersonalized: false,
        url: 'https://www.fda.gov/drugs/pharmaceutical-quality-resources/current-good-manufacturing-practice-cgmp-regulations'
      },
      {
        id: 'default_validation_lifecycle',
        title: 'Process Validation Lifecycle Approach',
        type: 'Guideline',
        description: 'FDA guidance on modern process validation methodology and continuous verification.',
        objective: 'Understand the three-stage validation approach and implementation strategies',
        difficulty: 'Intermediate',
        relevanceScore: 8,
        source: 'default',
        isPersonalized: false,
        url: 'https://www.fda.gov/regulatory-information/search-fda-guidance-documents/process-validation-general-principles-and-practices'
      },
      {
        id: 'default_capa_effectiveness',
        title: 'CAPA System Effectiveness Metrics',
        type: 'Reference',
        description: 'Key performance indicators and best practices for measuring CAPA system success.',
        objective: 'Learn to evaluate and improve CAPA system performance',
        difficulty: 'Intermediate',
        relevanceScore: 7,
        source: 'default',
        isPersonalized: false,
        url: 'https://www.fda.gov/regulatory-information/search-fda-guidance-documents/quality-systems-approach-pharmaceutical-cgmp-regulations'
      },
      {
        id: 'default_risk_management',
        title: 'ICH Q9 Quality Risk Management Implementation',
        type: 'Guideline',
        description: 'Practical application of risk management principles in pharmaceutical operations.',
        objective: 'Apply systematic risk assessment and control strategies',
        difficulty: 'Advanced',
        relevanceScore: 8,
        source: 'default',
        isPersonalized: false,
        url: 'https://database.ich.org/sites/default/files/Q9%20Guideline.pdf'
      }
    ].map(suggestion => this.attachResourceLink(suggestion));
  }

  /**
   * Clears the suggestion cache for a user
   * @param {string} userId - User identifier
   */
  clearCache(userId) {
    if (!FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS) {
      return;
    }
    const cacheKey = `suggestions_${userId}`;
    this.cache.delete(cacheKey);
  }

  /**
   * Forces refresh of suggestions by clearing cache
   * @param {string} userId - User identifier
   * @returns {Promise<Object[]>} - Fresh suggestions
   */
  async refreshSuggestions(userId) {
    if (!FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS) {
      return [];
    }
    this.clearCache(userId);
    return await this.getLearningSuggestions(userId);
  }
}

// Create singleton instance
const learningSuggestionsService = new LearningSuggestionsService();

export default learningSuggestionsService;

// Export convenience functions
export const getLearningSuggestions = (userId) =>
  FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS
    ? learningSuggestionsService.getLearningSuggestions(userId)
    : [];

export const refreshSuggestions = (userId) =>
  FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS
    ? learningSuggestionsService.refreshSuggestions(userId)
    : [];

export const clearSuggestionCache = (userId) =>
  FEATURE_FLAGS.ENABLE_AI_SUGGESTIONS
    ? learningSuggestionsService.clearCache(userId)
    : undefined;
