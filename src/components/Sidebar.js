import React from 'react';
import ResourcesView from './ResourcesView';

const Sidebar = ({
  messages,
  thirtyDayMessages,
  onConversationSelect,
}) => {
  return (
    <div className="h-full flex flex-col bg-white rounded-lg shadow-sm border border-gray-200 lg:min-h-0">
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900">Resource Center</h3>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <ResourcesView
          messages={messages}
          thirtyDayMessages={thirtyDayMessages}
          onConversationSelect={onConversationSelect}
        />
      </div>
    </div>
  );
};

export default Sidebar;
