// HTML Templates for generating UI components
window.HTMLTemplates = class HTMLTemplates {
  static generateSimpleUI(channelName) {
    // Get icon URL safely
    const iconUrl = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
      ? chrome.runtime.getURL('icons/icon128.png')
      : '';

    return `
      <div class="tvm-container tvm-simple">
        <div class="tvm-simple-header">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="tvm-simple-icon">${iconUrl ? `<img src="${iconUrl}" alt="TVM" style="width: 48px; height: 48px;">` : '📊'}</div>
            <div>
              <div class="tvm-simple-title">Viewer Metrics</div>
              <div class="tvm-simple-subtitle">Track and analyze viewers for ${channelName}</div>
            </div>
          </div>
          <button id="tvm-start-tracking" class="tvm-btn tvm-btn-primary">
            Start Tracking
          </button>
        </div>
      </div>
    `;
  }

  static generateLoadingPopup(username) {
    return `
      <div class="tvm-user-popup-content">
        <div class="tvm-user-popup-header">
          <h3>Loading ${username}...</h3>
          <button class="tvm-user-popup-close">&times;</button>
        </div>
        <div class="tvm-user-popup-body">
          <div style="text-align: center; padding: 40px;">
            <div class="tvm-loading-spinner"></div>
            <p>Loading user data...</p>
          </div>
        </div>
      </div>
    `;
  }

  static generateFullUserPopup(viewer, userInfo, following) {
    const capitalizedUsername = FormatUtils.capitalizeUsername(viewer.username);
    const profileImage = userInfo?.profileImageURL || 'https://static-cdn.jtvnw.net/user-default-pictures-uv/41780b5a-def8-11e9-94d9-784f43822e80-profile_image-300x300.png';
    const description = viewer.description || 'No description available';

    // Format dates
    const createdDate = FormatUtils.formatCreatedDate(viewer.createdAt);
    const firstSeen = FormatUtils.formatDateTime(viewer.firstSeen);
    const lastSeen = FormatUtils.formatDateTime(viewer.lastSeen);

    // Calculate timeInStream manually since it's a computed property
    const now = Date.now();
    const calculatedTimeInStream = viewer.firstSeen ? now - viewer.firstSeen : 0;
    const timeInStream = FormatUtils.formatDuration(calculatedTimeInStream);

    // Following data
    const followingCount = following?.totalCount || 0;
    const followingList = following?.follows || [];
    const followingError = following?.error;

    return `
      <div class="tvm-user-popup-content">
        <div class="tvm-user-popup-header">
          <h3>${capitalizedUsername}</h3>
          <button class="tvm-user-popup-close">&times;</button>
        </div>
        <div class="tvm-user-popup-body">
          <div class="tvm-user-profile">
            <img src="${profileImage}" alt="${capitalizedUsername}" class="tvm-user-avatar">
            <div class="tvm-user-details">
              <div class="tvm-user-info">
                <strong>ID:</strong> ${viewer.id || 'Unknown'}<br>
                <strong>Created:</strong> ${createdDate}<br>
                <strong>Accounts Same Day:</strong> ${viewer.accountsOnSameDay}<br>
                ${viewer.followingCount !== undefined ? `<strong>Following Count:</strong> ${viewer.followingCount}<br>` : ''}
                ${viewer.isFollower !== undefined ? `<strong>Follows Channel:</strong> ${viewer.isFollower ? '✅ Yes' : '❌ No'}<br>` : ''}
              </div>
              <div class="tvm-user-stream-info">
                <strong>First Seen:</strong> ${firstSeen}<br>
                <strong>Last Seen:</strong> ${lastSeen}<br>
                <strong>Time in Stream:</strong> ${timeInStream}
              </div>
            </div>
          </div>
          
          ${description !== 'No description available' ? `
            <div class="tvm-user-description">
              <strong>Description:</strong><br>
              <div class="tvm-description-text">${description}</div>
            </div>
          ` : ''}

          <div class="tvm-user-following">
            <div class="tvm-following-header">
              <h4>Following (${followingCount} total)</h4>
              ${followingList.length > 0 ? `
                <div class="tvm-following-controls">
                  <input type="text" id="tvm-following-search" placeholder="Search follows..." class="tvm-search-input">
                  <select id="tvm-following-sort" class="tvm-sort-select">
                    <option value="followedAt">Sort by Follow Date</option>
                    <option value="login">Sort by Username</option>
                  </select>
                  ${followingCount > 50 ? `
                    <button id="tvm-load-full-following" class="tvm-btn tvm-btn-small" style="margin-left: 8px;">
                      Load Full List
                    </button>
                  ` : ''}
                </div>
              ` : ''}
            </div>
            <div class="tvm-following-list" id="tvm-following-list">
              ${this.generateFollowingList(followingList, followingError, followingCount > 50)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  static generateFollowingList(followingList, error, isPartialList = false) {
    if (error) {
      return `<div class="tvm-error">Error loading following data: ${error}</div>`;
    }

    if (followingList.length === 0) {
      return '<div class="tvm-empty">No following data available</div>';
    }

    let html = '<div class="tvm-following-grid">';

    for (const follow of followingList) {
      const followDateTime = new Date(follow.followedAt);
      const followDate = followDateTime.toLocaleDateString() + ' ' +
        followDateTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      const avatarUrl = follow.user.profileImageURL || 'https://static-cdn.jtvnw.net/user-default-pictures-uv/41780b5a-def8-11e9-94d9-784f43822e80-profile_image-300x300.png';

      const createdDate = follow.user.createdAt ?
        new Date(follow.user.createdAt).toLocaleDateString() :
        '';

      html += `
        <div class="tvm-following-item" data-login="${follow.user.login}" data-followed="${follow.followedAt}">
          <div class="tvm-following-avatar">
            <img src="${avatarUrl}" alt="${follow.user.displayName}" class="tvm-following-user-avatar">
          </div>
          <div class="tvm-following-info">
            <div class="tvm-following-name">${follow.user.displayName}</div>
            <div class="tvm-following-date">${followDate}</div>
            ${createdDate ? `<div class="tvm-following-created">Created: ${createdDate}</div>` : ''}
          </div>
        </div>
      `;
    }

    html += '</div>';

    // Add notice if this is partial data
    if (isPartialList) {
      html += '<div style="text-align: center; margin-top: 10px; padding: 8px; background: rgba(145, 71, 255, 0.1); border-radius: 4px; font-size: 12px; color: #adadb8;">Showing first 50 follows. Click "Load Full List" to see all.</div>';
    }

    return html;
  }
}