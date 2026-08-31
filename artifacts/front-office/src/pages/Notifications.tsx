import React, { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListNotifications,
  useMarkNotificationRead,
  useGetNotificationPreferences,
  getListNotificationsQueryKey,
  getGetNotificationPreferencesQueryKey,
  useUpdateNotificationPreferences,
  Notification,
} from '@workspace/api-client-react';
import Header from '@/components/Header';

export default function Notifications() {
  const queryClient = useQueryClient();
  const [showUnreadOnly, setShowUnreadOnly] = useState(true);

  const { data: notificationsData, isLoading: isLoadingNotifications } = useListNotifications({ 
    unread_only: showUnreadOnly ? true : undefined 
  });
  
  const markRead = useMarkNotificationRead();

  const { data: preferencesData, isLoading: isLoadingPreferences } = useGetNotificationPreferences();
  const updatePreferences = useUpdateNotificationPreferences();
  const [prefSaveSuccess, setPrefSaveSuccess] = useState(false);

  const notifications = notificationsData?.data || [];
  const preferences = preferencesData?.data || [];

  const handleMarkRead = (id: string) => {
    markRead.mutate({ notificationId: id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
      }
    });
  };

  const handleTogglePref = (eventType: string, field: 'in_app' | 'email' | 'daily_digest') => {
    // Optimistically update the UI state, or send immediately.
    // The schema says `NotificationPreferenceInput` expects `preferences: NotificationPreference[]`.
    
    // Build the new list
    let updated = [...preferences];
    const existingIdx = updated.findIndex(p => p.event_type === eventType);
    
    if (existingIdx >= 0) {
      const nextValue = !updated[existingIdx][field];
      updated[existingIdx] = {
        ...updated[existingIdx],
        [field]: nextValue,
        ...(field === 'email' && !nextValue ? { daily_digest: false } : {}),
        ...(field === 'daily_digest' && nextValue ? { email: true } : {}),
      };
    } else {
      updated.push({
        event_type: eventType,
        in_app: field === 'in_app',
        email: field === 'email' || field === 'daily_digest',
        daily_digest: field === 'daily_digest'
      });
    }

    updatePreferences.mutate({ data: { preferences: updated } }, {
      onSuccess: () => {
        setPrefSaveSuccess(true);
        setTimeout(() => setPrefSaveSuccess(false), 2000);
        queryClient.invalidateQueries({ queryKey: getGetNotificationPreferencesQueryKey() });
      }
    });
  };

  // Known event types we want to expose preferences for
  const PREF_TYPES = [
    { type: 'commissioner.announcement', label: 'Announcements' },
    { type: 'result.reported', label: 'Result Reported' },
    { type: 'result.confirmed', label: 'Result Confirmed' },
    { type: 'result.disputed', label: 'Result Disputed' },
    { type: 'schedule.generated', label: 'Schedule Published' },
    { type: 'schedule.window_shifted', label: 'Game Window Changed' },
    { type: 'schedule.game_postponed', label: 'Game Postponed' },
    { type: 'schedule.game_resolved', label: 'Game Force-Resolved' }
  ];

  return (
    <>
      <Header />
      <div className="slab">
        <div className="wrap" style={{ padding: '30px 20px', display: 'block' }}>
          <div className="eyebrow">Operations</div>
          <h1 style={{ fontSize: '42px', marginTop: '5px' }}>Inbox</h1>
        </div>
      </div>
      
      <div className="wrap" style={{ paddingTop: '20px', paddingBottom: '60px' }}>
        <div className="notification-center-grid">
          
          {/* Main Inbox View */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontFamily: 'var(--display)', fontSize: '20px', textTransform: 'uppercase', margin: 0 }}>Recent Messages</h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', textTransform: 'uppercase' }}>Show:</span>
                <button 
                  onClick={() => setShowUnreadOnly(false)} 
                  data-testid="button-show-all-notifications"
                  className={`btn ${showUnreadOnly ? 'ghost' : ''}`} 
                  style={{ fontSize: '10px', padding: '4px 8px' }}
                >
                  All
                </button>
                <button 
                  onClick={() => setShowUnreadOnly(true)} 
                  data-testid="button-show-unread-notifications"
                  className={`btn ${!showUnreadOnly ? 'ghost' : ''}`} 
                  style={{ fontSize: '10px', padding: '4px 8px' }}
                >
                  Unread
                </button>
              </div>
            </div>

            {isLoadingNotifications ? (
              <div className="panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>Loading...</div>
            ) : notificationsData == null ? (
              <div className="notification-error" data-testid="status-notifications-error">
                Notifications could not be loaded. Refresh the page to try again.
              </div>
            ) : notifications.length === 0 ? (
              <div className="empty-state" style={{ marginTop: 0 }}>
                <h2>All Caught Up</h2>
                <p style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px', marginTop: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                  No {showUnreadOnly ? 'unread ' : ''}notifications.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {notifications.map((notif: Notification) => (
                  <div key={notif.id} data-testid={`notification-${notif.id}`} className="panel" style={{ marginBottom: 0, borderLeft: !notif.read_at ? '4px solid var(--crease)' : '1px solid var(--rule)' }}>
                    <div style={{ padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div>
                          <div style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '4px' }}>
                            {new Date(notif.created_at).toLocaleDateString()} · {notif.event_type}
                          </div>
                          <div style={{ fontWeight: 600, fontSize: '15px' }}>{notif.title}</div>
                        </div>
                        {!notif.read_at && (
                          <button 
                            className="btn ghost" 
                            onClick={() => handleMarkRead(notif.id)} 
                            disabled={markRead.isPending}
                            data-testid={`button-mark-read-${notif.id}`}
                            style={{ fontSize: '10px', padding: '4px 8px' }}
                          >
                            Mark Read
                          </button>
                        )}
                      </div>
                      <div style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--slab)', whiteSpace: 'pre-wrap' }}>
                        {notif.body}
                      </div>
                      
                      {notif.data && Object.keys(notif.data).length > 0 && (
                        <div style={{ marginTop: '12px', padding: '8px 12px', background: '#f8f9fa', borderRadius: '4px', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)' }}>
                          {JSON.stringify(notif.data)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Preferences Sidebar */}
          <div>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: '20px', textTransform: 'uppercase', marginBottom: '16px' }}>Delivery Settings</h2>
            <div className="panel">
              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {isLoadingPreferences ? (
                  <div style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px', textAlign: 'center' }}>Loading preferences...</div>
                ) : (
                  <>
                    <div style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', lineHeight: 1.5 }}>
                      Choose how you want to be notified for different events. In-app notifications appear in your inbox.
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {PREF_TYPES.map(pt => {
                        const pref = preferences.find(p => p.event_type === pt.type) || { event_type: pt.type, in_app: true, email: false, daily_digest: false };
                        return (
                          <div key={pt.type} style={{ border: '1px solid var(--rule)', borderRadius: '4px', padding: '12px' }}>
                            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>{pt.label}</div>
                            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', opacity: updatePreferences.isPending ? 0.6 : 1 }}>
                                <input 
                                  type="checkbox" 
                                  checked={pref.in_app} 
                                  onChange={() => handleTogglePref(pt.type, 'in_app')} 
                                  disabled={updatePreferences.isPending}
                                  data-testid={`checkbox-pref-inapp-${pt.type}`}
                                  style={{ accentColor: 'var(--crease)' }} 
                                />
                                In-App
                              </label>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', opacity: updatePreferences.isPending ? 0.6 : 1 }}>
                                <input 
                                  type="checkbox" 
                                  checked={pref.email} 
                                  onChange={() => handleTogglePref(pt.type, 'email')} 
                                  disabled={updatePreferences.isPending}
                                  data-testid={`checkbox-pref-email-${pt.type}`}
                                  style={{ accentColor: 'var(--crease)' }} 
                                />
                                Email
                              </label>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', opacity: updatePreferences.isPending ? 0.6 : 1 }}>
                                <input 
                                  type="checkbox" 
                                  checked={pref.daily_digest} 
                                  onChange={() => handleTogglePref(pt.type, 'daily_digest')} 
                                  disabled={updatePreferences.isPending}
                                  data-testid={`checkbox-pref-digest-${pt.type}`}
                                  style={{ accentColor: 'var(--crease)' }} 
                                />
                                Digest
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {prefSaveSuccess && (
                      <div style={{ background: '#F0FAF5', border: '1px solid #A3D9BC', borderRadius: '3px', padding: '10px 14px', fontFamily: 'var(--data)', fontSize: '11px', color: '#1F7A4C', textAlign: 'center' }}>
                        Preferences saved
                      </div>
                    )}
                    {updatePreferences.isError && (
                      <div className="notification-error" data-testid="status-preferences-error">
                        Preferences could not be saved. Check your connection and try again.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          
        </div>
      </div>
    </>
  );
}
