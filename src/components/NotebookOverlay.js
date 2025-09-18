import React, { useState } from 'react';
import { X, Search } from 'lucide-react';
import NotebookView from './NotebookView';

const NOTEBOOK_TABS = [
  { id: 'conversations', label: 'Conversations' },
  { id: 'resources', label: 'Learning Resources' }
];

const NotebookOverlay = ({
  messages,
  thirtyDayMessages,
  selectedMessages,
  setSelectedMessages,
  generateStudyNotes,
  isGeneratingNotes,
  storedMessageCount,
  isServerAvailable,
  onDeleteConversation,
  onDeleteResource,
  onClose
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('desc');
  const [activeTab, setActiveTab] = useState('conversations');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Notebook</h2>
              <nav
                className="mt-4 flex flex-wrap items-center gap-2"
                role="tablist"
                aria-label="Notebook sections"
              >
                {NOTEBOOK_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    id={`notebook-tab-${tab.id}`}
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    aria-controls={`notebook-panel-${tab.id}`}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-3 py-2 text-sm font-medium rounded-md border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 ${
                      activeTab === tab.id
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-600 border-gray-200 hover:text-gray-900 hover:border-gray-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>

            <div className="flex flex-wrap items-center gap-2 justify-end">
              {activeTab === 'conversations' && (
                <>
                  <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search conversations"
                      className="pl-9 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500 text-sm w-48"
                      aria-label="Search notebook conversations"
                    />
                  </div>
                  <select
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value)}
                    className="text-sm border border-gray-300 rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-gray-500"
                    aria-label="Sort conversations"
                  >
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </select>
                </>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Close notebook"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
          </div>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
          <NotebookView
            messages={messages}
            thirtyDayMessages={thirtyDayMessages}
            selectedMessages={selectedMessages}
            setSelectedMessages={setSelectedMessages}
            generateStudyNotes={generateStudyNotes}
            isGeneratingNotes={isGeneratingNotes}
            storedMessageCount={storedMessageCount}
            isServerAvailable={isServerAvailable}
            searchTerm={searchTerm}
            sortOrder={sortOrder}
            activeTab={activeTab}
            onDeleteConversation={onDeleteConversation}
            onDeleteResource={onDeleteResource}
          />
        </div>
      </div>
    </div>
  );
};

export default NotebookOverlay;
